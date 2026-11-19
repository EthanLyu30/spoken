import { useEffect, useRef } from "react";

/** Steam is anchored to the moving cup. Motes drift only in the window light. */
export function CafeAtmosphere({ still }: { still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const counter = canvas?.parentElement;
    const latte = counter?.querySelector('[data-object="a latte"]');
    if (!canvas || !counter || !latte || typeof ResizeObserver === "undefined") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0, height = 0, time = 0, last = 0, frame = 0;
    let onScreen = true;
    function draw() {
      const cup = latte?.querySelector("img");
      if (!ctx || !cup || !counter || !width) return;
      const stage = counter.getBoundingClientRect(), mug = cup.getBoundingClientRect();
      const x = mug.left - stage.left + mug.width * .46, y = mug.top - stage.top + mug.height * .14;
      ctx.clearRect(0, 0, width, height);
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
      if (still) return;
      for (let i = 0; i < 11; i++) {
        const seed = (i * .618) % 1, phase = (seed + time * (.035 + .022 * seed)) % 1;
        ctx.fillStyle = `rgba(255,244,198,${.55 * Math.sin(Math.PI * phase)})`;
        ctx.beginPath();
        ctx.arc(width * (.64 + .23 * seed + .024 * Math.sin(7 * phase + i)), height * (.63 - .42 * phase),
          Math.max(.65, width * .0023) * (1 + .45 * seed), 0, Math.PI * 2);
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
      width = counter.clientWidth; height = counter.clientHeight;
      const scale = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      sync();
    });
    resize.observe(counter);
    counter.addEventListener("load", sync, true);
    const visibility = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting; sync();
    });
    visibility?.observe(counter);
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); visibility?.disconnect();
      counter.removeEventListener("load", sync, true);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [still]);
  return <canvas ref={ref} className="cafe-air" aria-hidden="true" />;
}
