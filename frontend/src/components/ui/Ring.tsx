import { useEffect, useState, type ReactNode } from "react";

interface RingProps {
  pct: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}

/** Circular progress ring that sweeps to its value on mount. */
export function Ring({
  pct,
  size = 76,
  stroke = 9,
  color = "var(--leaf)",
  track = "rgba(67,48,43,0.10)",
  children,
}: RingProps) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [p, setP] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setP(clamped));
    return () => cancelAnimationFrame(id);
  }, [clamped]);

  const offset = c * (1 - p / 100);

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.9s ease" }}
        />
      </svg>
      {children && <div className="absolute grid place-items-center">{children}</div>}
    </div>
  );
}
