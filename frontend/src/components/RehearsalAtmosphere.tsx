import { useEffect, useRef } from "react";
import type { RehearsalAir } from "../data/rehearsalScenes";

const particleLight: Record<RehearsalAir, string> = {
  cafe: "255,244,198", daylight: "255,245,213", sky: "241,251,255", leaves: "211,184,93",
  lamplight: "255,218,142", screen: "249,247,235", water: "218,243,255",
};

export function RehearsalAtmosphere({ still, effect }: { still: boolean; effect: RehearsalAir }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const stageElement = canvas?.parentElement;
    if (!canvas || !stageElement || typeof ResizeObserver === "undefined") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0, height = 0, time = 0, last = 0, frame = 0;
    let onScreen = true;
    const backdrop = effect === "water" ? stageElement.querySelector(".rehearsal-atlas") : null;
    function drawSteam() {
      const cup = stageElement?.querySelector('[data-object="a latte"] img');
      if (!ctx || !cup || !stageElement) return;
      const stage = stageElement.getBoundingClientRect(), mug = cup.getBoundingClientRect();
      const x = mug.left - stage.left + mug.width * .46, y = mug.top - stage.top + mug.height * .14;
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1.1, width / 235);
      for (const [offset, length] of [[0, .145], [7, .105]]) {
        const reach = height * length;
        const steam = ctx.createLinearGradient(x, y - reach, x, y);
        steam.addColorStop(0, "rgba(255,248,225,0)");
        steam.addColorStop(.43, "rgba(255,250,235,.67)");
        steam.addColorStop(1, "rgba(255,248,220,.13)");
        ctx.strokeStyle = steam;
        ctx.beginPath();
        ctx.moveTo(x + offset, y);
        for (let point = 1; point <= 18; point++) {
          const u = point / 18;
          const bend = u * width * (.014 * Math.sin(time * 1.8 + u * 7 + offset) + u * .012);
          ctx.lineTo(x + offset + bend, y - u * reach);
        }
        ctx.stroke();
      }
    }

    function draw() {
      if (!ctx || !width || !height) return;
      ctx.clearRect(0, 0, width, height);
      if (effect === "cafe") drawSteam();
      if (still) return;
      if (effect === "water" && backdrop && stageElement) {
        // Keep the glints on the water even when the atlas is cropped or panned.
        const art = backdrop.getBoundingClientRect(), stage = stageElement.getBoundingClientRect();
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(.65, width * .002);
        for (let i = 0; i < 13; i++) {
          const seed = (i * .618) % 1;
          const phase = (seed + time * .27) % 1;
          const start = art.left - stage.left + art.width * (.04 + .36 * seed + .016 * Math.sin(time + i));
          const y = art.top - stage.top + art.height * (.55 + (i % 4) * .015);
          const length = art.width * (.017 + .045 * Math.sin(Math.PI * phase));
          ctx.strokeStyle = `rgba(${particleLight.water},${.68 * Math.sin(Math.PI * phase)})`;
          ctx.beginPath();
          ctx.moveTo(start, y);
          ctx.quadraticCurveTo(start + length * .58, y - 1.8, start + length, y + 1.2);
          ctx.stroke();
        }
        return;
      }

      // A slow reflection on windows and screens adds depth behind the cues.
      if (effect === "screen" || effect === "sky") {
        const x = width * (.18 + .68 * ((time * .025) % 1));
        const light = ctx.createLinearGradient(x - width * .16, 0, x + width * .16, height * .5);
        light.addColorStop(0, "transparent");
        light.addColorStop(.5, `rgba(${particleLight[effect]},.10)`);
        light.addColorStop(1, "transparent");
        ctx.fillStyle = light;
        ctx.fillRect(0, 0, width, height * .68);
      }

      const outdoors = effect === "leaves";
      const glow = effect === "lamplight";
      for (let i = 0; i < 13; i++) {
        const seed = (i * .618) % 1;
        const phase = (seed + time * (outdoors ? .095 : .04) * (1 + seed * .7)) % 1;
        const opacity = (glow ? .66 : .48) * Math.sin(Math.PI * phase);
        const x = effect === "cafe" ? .64 + .23 * seed + .024 * Math.sin(7 * phase + i)
          : .10 + .73 * seed + (outdoors ? .1 : .045) * Math.sin(6 * phase + i);
        const y = outdoors ? .06 + .54 * phase : .61 - .47 * phase;
        const size = Math.max(.7, width * (outdoors ? .005 : .0028)) * (1 + .42 * seed);
        ctx.fillStyle = `rgba(${particleLight[effect]},${opacity})`;
        ctx.beginPath();
        ctx.ellipse(width * x, height * y, size, outdoors ? size * .43 : size,
          phase * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    function tick(now: number) {
      if (!last || now - last >= 1000 / 30) {
        time += last ? Math.min((now - last) / 1000, .08) : 0;
        last = now;
        draw();
      }
      frame = requestAnimationFrame(tick);
    }
    function sync() {
      cancelAnimationFrame(frame);
      last = 0;
      if (!onScreen || document.hidden) return;
      draw();
      if (!still) frame = requestAnimationFrame(tick);
    }
    const resize = new ResizeObserver(() => {
      width = stageElement.clientWidth; height = stageElement.clientHeight;
      const scale = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      sync();
    });
    resize.observe(stageElement);
    stageElement.addEventListener("load", sync, true);
    const visibility = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting; sync();
    });
    visibility?.observe(stageElement);
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); visibility?.disconnect();
      stageElement.removeEventListener("load", sync, true);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [effect, still]);
  return <canvas ref={ref} className="rehearsal-air" data-effect={effect} aria-hidden="true" />;
}
