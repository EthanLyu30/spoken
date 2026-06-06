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

/** Ambient, gently-drifting blobs + grain behind every page. */
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
