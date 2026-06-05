import { type ReactNode } from "react";
import { cn } from "../lib/utils";

interface StatChipProps {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  tint?: string;
  fg?: string;
  className?: string;
}

/** A rounded gamification chip: tinted icon + value + tiny label. */
export function StatChip({
  icon,
  value,
  label,
  tint = "var(--surface-2)",
  fg = "var(--coral-deep)",
  className,
}: StatChipProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2.5 rounded-full border border-border bg-surface px-3.5 py-2 shadow-soft",
        className,
      )}
    >
      <span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: tint, color: fg }}>
        {icon}
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-display text-base font-semibold tabnum text-ink">{value}</span>
        <span className="text-[0.66rem] font-bold uppercase tracking-wide text-muted">{label}</span>
      </span>
    </div>
  );
}
