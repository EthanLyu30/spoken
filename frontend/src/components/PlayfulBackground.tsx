interface PlayfulBackgroundProps {
  celebrate?: boolean;
}

const CONFETTI = [
  { left: "10%", top: "16%", color: "#ff6f5e", delay: "0s" },
  { left: "82%", top: "12%", color: "#ffc94d", delay: "0.4s" },
  { left: "24%", top: "70%", color: "#41c08c", delay: "0.8s" },
  { left: "70%", top: "62%", color: "#57b7e8", delay: "1.1s" },
  { left: "46%", top: "22%", color: "#ff7aa2", delay: "1.5s" },
  { left: "90%", top: "44%", color: "#ff9f45", delay: "1.9s" },
];

/** Ambient blobs + grain behind every page. Optionally rains confetti. */
export function PlayfulBackground({ celebrate = false }: PlayfulBackgroundProps) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <span
        className="absolute -left-24 -top-24 h-80 w-80 animate-floaty rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle,#ffd2a8,transparent 70%)" }}
      />
      <span
        className="absolute -right-24 top-20 h-96 w-96 animate-floaty rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle,#ffc6d6,transparent 70%)", animationDelay: "1.6s" }}
      />
      <span
        className="absolute -bottom-28 left-1/3 h-96 w-96 animate-floaty rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle,#bdeccf,transparent 70%)", animationDelay: "3.1s" }}
      />
      {celebrate &&
        CONFETTI.map((c, i) => (
          <span
            key={i}
            className="absolute h-3 w-3 animate-sparkle rounded-[3px]"
            style={{ left: c.left, top: c.top, background: c.color, animationDelay: c.delay }}
          />
        ))}
      <div className="noise" />
    </div>
  );
}
