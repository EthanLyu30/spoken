import { cn } from "../lib/utils";

interface PlayfulBackgroundProps {
  /** Rain confetti (used on the report). */
  celebrate?: boolean;
  /** Scenario hex to tint the atmosphere toward that scene. */
  accent?: string;
}

const CONFETTI = Array.from({ length: 16 }, (_, i) => ({
  left: `${(i * 6 + 4) % 100}%`,
  color: ["#ff6f5e", "#ffc94d", "#41c08c", "#57b7e8", "#ff7aa2", "#ff9f45"][i % 6],
  delay: `${(i % 8) * 0.32}s`,
  dur: `${3 + (i % 4) * 0.7}s`,
}));

// Small, gently-drifting doodles for a richer, more playful backdrop. Kept
// low-opacity and behind everything so they never compete with content.
type Decor = { type: "dot" | "ring" | "square" | "sparkle"; cls: string; size: number; color: string; anim: string; delay: string };
const DECOR: Decor[] = [
  { type: "sparkle", cls: "left-[8%] top-[16%]", size: 20, color: "#ffc94d", anim: "animate-bob", delay: "0s" },
  { type: "ring", cls: "left-[13%] top-[64%]", size: 28, color: "#57b7e8", anim: "animate-floaty", delay: "1.1s" },
  { type: "dot", cls: "right-[10%] top-[24%]", size: 12, color: "#ff7aa2", anim: "animate-drift", delay: "0.6s" },
  { type: "square", cls: "right-[15%] top-[66%]", size: 16, color: "#41c08c", anim: "animate-floaty", delay: "2s" },
  { type: "sparkle", cls: "right-[26%] top-[10%]", size: 16, color: "#ff6f5e", anim: "animate-bob", delay: "1.6s" },
  { type: "dot", cls: "left-[44%] top-[7%]", size: 10, color: "#8a7bf0", anim: "animate-drift", delay: "2.6s" },
  { type: "ring", cls: "right-[38%] bottom-[12%]", size: 22, color: "#ff9f45", anim: "animate-floaty", delay: "3s" },
  { type: "sparkle", cls: "left-[28%] bottom-[14%]", size: 16, color: "#ffc94d", anim: "animate-bob", delay: "0.9s" },
  { type: "square", cls: "left-[58%] bottom-[20%]", size: 14, color: "#57b7e8", anim: "animate-drift", delay: "1.8s" },
  { type: "dot", cls: "right-[7%] bottom-[30%]", size: 12, color: "#41c08c", anim: "animate-floaty", delay: "2.3s" },
  { type: "sparkle", cls: "left-[6%] bottom-[40%]", size: 13, color: "#ff7aa2", anim: "animate-bob", delay: "3.4s" },
];

function Doodle({ d }: { d: Decor }) {
  const base = cn("absolute", d.cls, d.anim);
  if (d.type === "sparkle") {
    return (
      <span
        className={cn(base, "select-none opacity-50")}
        style={{ color: d.color, fontSize: d.size, animationDelay: d.delay }}
      >
        ✦
      </span>
    );
  }
  if (d.type === "ring") {
    return (
      <span
        className={cn(base, "rounded-full opacity-40")}
        style={{ width: d.size, height: d.size, border: `2px solid ${d.color}`, animationDelay: d.delay }}
      />
    );
  }
  if (d.type === "square") {
    return (
      <span
        className={cn(base, "rotate-12 opacity-40")}
        style={{ width: d.size, height: d.size, background: d.color, borderRadius: 4, animationDelay: d.delay }}
      />
    );
  }
  return (
    <span
      className={cn(base, "rounded-full opacity-50")}
      style={{ width: d.size, height: d.size, background: d.color, animationDelay: d.delay }}
    />
  );
}

/** Ambient, gently-drifting blobs + doodles + grain behind every page. */
export function PlayfulBackground({ celebrate = false, accent }: PlayfulBackgroundProps) {
  const blobs = [
    { cls: "-left-24 -top-24 h-80 w-80", color: accent ?? "#ffd2a8", anim: "animate-floaty", delay: "0s" },
    { cls: "-right-24 top-16 h-96 w-96", color: "#ffc6d6", anim: "animate-drift", delay: "1.4s" },
    { cls: "-bottom-28 left-1/3 h-96 w-96", color: "#bdeccf", anim: "animate-floaty", delay: "3.1s" },
    { cls: "right-1/4 top-1/3 h-72 w-72", color: "#ffe1a8", anim: "animate-drift", delay: "2.2s" },
    { cls: "bottom-12 left-6 h-64 w-64", color: "#d8d2ff", anim: "animate-floaty", delay: "4.4s" },
  ];

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {blobs.map((b, i) => (
        <span
          key={i}
          className={cn("absolute rounded-full blur-3xl", b.cls, b.anim)}
          style={{
            background: `radial-gradient(circle, ${b.color}, transparent 70%)`,
            animationDelay: b.delay,
          }}
        />
      ))}
      {DECOR.map((d, i) => (
        <Doodle key={i} d={d} />
      ))}
      {celebrate &&
        CONFETTI.map((c, i) => (
          <span
            key={i}
            className="absolute top-0 h-3 w-2 animate-fall rounded-[2px]"
            style={{
              left: c.left,
              background: c.color,
              animationDelay: c.delay,
              animationDuration: c.dur,
            }}
          />
        ))}
      <div className="noise" />
    </div>
  );
}
