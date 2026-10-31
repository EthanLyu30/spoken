import { useEffect, useState } from "react";
import { deviceTimezone, learningDay } from "../lib/learningDay";

/** Recheck at local midnight and when returning to the page. */
export function useLearningDay(): string {
  const [day, setDay] = useState(learningDay);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      setDay(learningDay());
      clearTimeout(timer);
      const now = new Date();
      const next = deviceTimezone() === "UTC"
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
        : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(check, Math.min(60 * 60 * 1000, Math.max(1000, next.getTime() - now.getTime() + 50)));
    };
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { clearTimeout(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, []);
  return day;
}
