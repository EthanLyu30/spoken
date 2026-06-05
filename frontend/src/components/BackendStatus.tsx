import { useEffect, useState } from "react";
import { getHealth } from "../lib/api";

type State = "checking" | "online" | "offline";

/** Small pill that surfaces whether the FastAPI backend is reachable. */
export function BackendStatus() {
  const [state, setState] = useState<State>("checking");
  const [app, setApp] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    getHealth(ctrl.signal)
      .then((r) => {
        setState("online");
        setApp(r.app);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState("offline");
      });
    return () => ctrl.abort();
  }, []);

  const dot: Record<State, string> = {
    checking: "var(--sunny)",
    online: "var(--leaf)",
    offline: "var(--danger)",
  };
  const label: Record<State, string> = {
    checking: "连接后端…",
    online: `后端已连接${app ? ` · ${app}` : ""}`,
    offline: "后端未运行 · 启动后刷新",
  };

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 shadow-soft">
      <span className="h-2 w-2 rounded-full" style={{ background: dot[state] }} />
      <span className="text-xs font-semibold text-muted">{label[state]}</span>
    </span>
  );
}
