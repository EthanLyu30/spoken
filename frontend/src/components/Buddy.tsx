import { cn } from "../lib/utils";
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
      <img src="/images/pip.png" alt="" draggable={false} />
    </div>
  );
}
