import { cn } from "../lib/utils";
import pip192 from "../assets/pip-192.webp";
import pip384 from "../assets/pip-384.webp";
import pip768 from "../assets/pip-768.webp";
export type BuddyMood = "idle" | "happy" | "listening" | "talking" | "cheer";
interface BuddyProps {
  mood?: BuddyMood;
  size?: number;
  color?: string;
  className?: string;
}
/** Shared source artwork; mood remains driven by the existing voice state. */
export function Buddy({ mood = "idle", size = 160, className }: BuddyProps) {
  return (
    <div
      className={cn("buddy-art", `buddy-${mood}`, className)}
      style={{ width: size, height: size }}
    >
      <img src={pip384} srcSet={`${pip192} 192w, ${pip384} 384w, ${pip768} 768w`} sizes={`${size}px`} width={size} height={size} alt="" draggable={false} />
    </div>
  );
}
