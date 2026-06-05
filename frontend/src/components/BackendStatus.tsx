import { useEffect, useState } from "react";
import { getHealth } from "../lib/api";
import { cn } from "../lib/utils";

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
    checking: "bg-warning",
    online: "bg-success",
    offline: "bg-danger",
  };
  const label: Record<State, string> = {
    checking: "连接后端…",
    online: `后端已连接${app ? ` · ${app}` : ""}`,
    offline: "后端未运行 · 启动 backend 后刷新",
  };

  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn("h-1.5 w-1.5 rounded-full", dot[state])} />
      <span className="eyebrow !text-muted">{label[state]}</span>
    </span>
  );
}
