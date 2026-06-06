import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Flag } from "lucide-react";
import { type Scenario } from "../data/scenarios";
import { scenarioIcons } from "../lib/icons";
import { themeFor } from "../lib/theme";
import { xpReward } from "../data/progress";
import { cn } from "../lib/utils";

const STEP = 152; // vertical gap between stops
const TOP = 84;
const BOTTOM = 96;

/** A winding "level map": scenarios sit as stops along a curvy trail. */
export function JourneyPath({ scenarios }: { scenarios: Scenario[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const n = scenarios.length;
  const height = TOP + (n - 1) * STEP + BOTTOM;
  const amp = width < 460 ? 0.2 : 0.3; // gentler curve on narrow screens
  const xOf = (i: number) => 0.5 + amp * Math.sin(i * 0.95 + 0.5);

  const pts = scenarios.map((_, i) => ({ x: width * xOf(i), y: TOP + i * STEP }));
  const finish = { x: width * 0.5, y: TOP + (n - 1) * STEP + 70 };
  const all = [...pts, finish];

  let d = "";
  if (width > 0) {
    d = `M ${all[0].x} ${all[0].y}`;
    for (let i = 1; i < all.length; i++) {
      const midY = (all[i - 1].y + all[i].y) / 2;
      d += ` C ${all[i - 1].x} ${midY}, ${all[i].x} ${midY}, ${all[i].x} ${all[i].y}`;
    }
  }

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="absolute left-0 top-0"
          style={{ overflow: "visible" }}
          aria-hidden
        >
          <path d={d} fill="none" stroke="#ecdcc6" strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" />
          <path d={d} fill="none" stroke="#fffaf2" strokeWidth={4} strokeLinecap="round" strokeDasharray="1 18" />
        </svg>
      )}

      {width > 0 &&
        scenarios.map((s, i) => {
          const t = themeFor(s.id);
          const Icon = scenarioIcons[s.icon];
          const p = pts[i];
          const labelRight = p.x < width / 2;
          return (
            <Link
              key={s.id}
              to={`/practice/${s.id}`}
              className="group absolute animate-rise"
              style={{
                left: p.x,
                top: p.y,
                transform: "translate(-50%, -50%)",
                animationDelay: `${i * 0.08}s`,
              }}
            >
              <span
                className="grid h-16 w-16 place-items-center rounded-full border-4 border-bg shadow-pop transition-transform group-hover:-translate-y-1 group-active:translate-y-0"
                style={{ background: t.base }}
              >
                <Icon className="h-7 w-7 text-white" strokeWidth={2.4} />
              </span>
              <span
                className="absolute -left-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-surface text-xs font-bold shadow-soft"
                style={{ color: t.deep }}
              >
                {i + 1}
              </span>
              <span
                className={cn(
                  "absolute top-1/2 w-36 -translate-y-1/2 rounded-2xl border border-border bg-surface px-3 py-2 shadow-soft",
                  labelRight ? "left-[4.5rem] text-left" : "right-[4.5rem] text-right",
                )}
              >
                <span className="block truncate font-display text-sm font-semibold text-ink">{s.titleZh}</span>
                <span className="block truncate text-[0.66rem] font-semibold text-muted">
                  {s.title} · +{xpReward(s.difficulty, s.minutes)} XP
                </span>
              </span>
            </Link>
          );
        })}

      {width > 0 && (
        <div
          className="absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center"
          style={{ left: finish.x, top: finish.y }}
        >
          <span className="grid h-12 w-12 place-items-center rounded-full border-4 border-bg bg-sunny shadow-pop">
            <Flag className="h-5 w-5 text-white" strokeWidth={2.4} />
          </span>
          <span className="mt-1 rounded-full bg-surface px-3 py-0.5 text-xs font-bold text-muted shadow-soft">
            通关
          </span>
        </div>
      )}
    </div>
  );
}
