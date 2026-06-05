import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";

interface ProgressBarProps {
  value: number;
  max?: number;
  color?: string;
  height?: number;
  className?: string;
}

/** Chunky rounded progress bar that fills in from zero on mount. */
export function ProgressBar({
  value,
  max = 100,
  color = "var(--leaf)",
  height = 12,
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const [w, setW] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setW(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);

  return (
    <div
      className={cn("w-full overflow-hidden rounded-full", className)}
      style={{ height, background: "rgba(67,48,43,0.08)" }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{
          width: `${w}%`,
          background: color,
          boxShadow: "inset 0 2px 0 rgba(255,255,255,0.45)",
        }}
      />
    </div>
  );
}
