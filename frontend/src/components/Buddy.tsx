import { cn } from "../lib/utils";

export type BuddyMood = "idle" | "happy" | "listening" | "talking" | "cheer";

interface BuddyProps {
  mood?: BuddyMood;
  size?: number;
  /** Body colour (hex). Lets the buddy take on a scenario's accent. */
  color?: string;
  className?: string;
}

/**
 * "Pip" — the speaking buddy. A round coral creature with a little sprout on
 * top (growth = your language levelling up). Reacts to the conversation:
 * blinks when idle, shows listening rings, animates its mouth when talking,
 * and throws sparkles when celebrating.
 */
export function Buddy({ mood = "idle", size = 160, color = "#ff6f5e", className }: BuddyProps) {
  const talking = mood === "talking";
  const listening = mood === "listening";
  const cheer = mood === "cheer";

  return (
    <div
      className={cn("relative inline-grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      {listening && (
        <>
          <span
            className="absolute animate-pulsering rounded-full"
            style={{ width: size * 0.82, height: size * 0.82, background: "rgba(87,183,232,0.22)" }}
          />
          <span
            className="absolute animate-pulsering rounded-full"
            style={{ width: size * 0.82, height: size * 0.82, background: "rgba(87,183,232,0.22)", animationDelay: "0.7s" }}
          />
        </>
      )}
      {cheer && (
        <>
          <Spark className="left-1 top-4" />
          <Spark className="right-3 top-7" delay="0.5s" />
          <Spark className="bottom-9 right-5" delay="1s" />
          <Spark className="bottom-12 left-4" delay="1.4s" />
        </>
      )}

      <svg
        viewBox="0 0 140 160"
        width={size}
        height={size}
        className="relative animate-bob"
        style={cheer ? { animationDuration: "1.3s" } : undefined}
      >
        {/* ground shadow */}
        <ellipse cx="70" cy="151" rx="40" ry="6.5" fill="rgba(67,48,43,0.10)" />
        {/* feet */}
        <ellipse cx="55" cy="138" rx="11" ry="7.5" fill={color} />
        <ellipse cx="85" cy="138" rx="11" ry="7.5" fill={color} />
        {/* arms */}
        <ellipse
          cx="19"
          cy={cheer ? "70" : "96"}
          rx="8.5"
          ry="12"
          fill={color}
          transform={cheer ? "rotate(-28 19 80)" : "rotate(18 19 96)"}
        />
        <ellipse
          cx="121"
          cy={cheer ? "70" : "96"}
          rx="8.5"
          ry="12"
          fill={color}
          transform={cheer ? "rotate(28 121 80)" : "rotate(-18 121 96)"}
        />
        {/* sprout */}
        <path d="M70 44 V24" stroke="#2fa274" strokeWidth="4" strokeLinecap="round" />
        <path d="M70 30 q 13 -3 19 -15 q -14 0 -19 11 Z" fill="#41c08c" />
        <path d="M70 36 q -12 -4 -18 -14 q 13 -1 18 9 Z" fill="#5bd3a0" />
        <circle cx="70" cy="22" r="4.5" fill="#41c08c" />
        {/* body */}
        <ellipse cx="70" cy="90" rx="52" ry="50" fill={color} />
        <ellipse cx="70" cy="66" rx="40" ry="24" fill="#ffffff" opacity="0.22" />
        <ellipse cx="70" cy="118" rx="45" ry="22" fill="#43302b" opacity="0.06" />
        {/* cheeks */}
        <ellipse cx="38" cy="100" rx="9" ry="6" fill="#ff5a7a" opacity="0.5" />
        <ellipse cx="102" cy="100" rx="9" ry="6" fill="#ff5a7a" opacity="0.5" />
        {/* eyes */}
        {cheer ? (
          <>
            <path d="M44 84 q10 -12 20 0" stroke="#43302b" strokeWidth="4.5" fill="none" strokeLinecap="round" />
            <path d="M76 84 q10 -12 20 0" stroke="#43302b" strokeWidth="4.5" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <>
            <g className="eye animate-blink">
              <ellipse cx="54" cy="84" rx="12" ry="14" fill="#fffdf9" />
              <circle cx="56" cy="87" r="6" fill="#43302b" />
              <circle cx="53.5" cy="84.5" r="2.1" fill="#fffdf9" />
            </g>
            <g className="eye animate-blink">
              <ellipse cx="88" cy="84" rx="12" ry="14" fill="#fffdf9" />
              <circle cx="90" cy="87" r="6" fill="#43302b" />
              <circle cx="87.5" cy="84.5" r="2.1" fill="#fffdf9" />
            </g>
          </>
        )}
        {/* mouth */}
        {talking ? (
          <g>
            <ellipse className="mouth animate-talk" cx="70" cy="112" rx="10" ry="9" fill="#6b352c" />
            <ellipse cx="70" cy="116" rx="5.5" ry="3.5" fill="#ff7aa2" />
          </g>
        ) : cheer ? (
          <g>
            <path d="M55 106 q15 18 30 0 Z" fill="#6b352c" />
            <ellipse cx="70" cy="113" rx="7" ry="4" fill="#ff7aa2" />
          </g>
        ) : (
          <path d="M58 107 q12 11 24 0" stroke="#43302b" strokeWidth="4" fill="none" strokeLinecap="round" />
        )}
      </svg>
    </div>
  );
}

function Spark({ className, delay }: { className?: string; delay?: string }) {
  return (
    <span className={cn("absolute animate-sparkle", className)} style={{ animationDelay: delay }}>
      <svg width="20" height="20" viewBox="0 0 20 20">
        <path d="M10 0 L12 8 L20 10 L12 12 L10 20 L8 12 L0 10 L8 8 Z" fill="#ffc94d" />
      </svg>
    </span>
  );
}
