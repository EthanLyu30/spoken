import { useEffect, useState } from "react";
import { getHealth, withTimeout } from "../lib/api";

type State = "checking" | "waking" | "online" | "offline";

// Render's free tier sleeps after ~15 min idle, so the first request after a
// while triggers a cold container start (often 30–60s). Probe with short
// per-attempt timeouts and keep retrying across that window instead of giving
// up after one slow request. This keeps the status honest — a "唤醒中" state
// rather than a scary "未运行" — and warms the backend so the first real call
// (opening a conversation) is already fast.
const PROBE_TIMEOUT_MS = 6_000;
const RETRY_DELAY_MS = 2_500;
const MAX_ATTEMPTS = 12; // ~12 × (≤6s + 2.5s) comfortably covers a cold start

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/** Small pill that surfaces whether the FastAPI backend is reachable. */
export function BackendStatus() {
  const [state, setState] = useState<State>("checking");
  const [app, setApp] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (ctrl.signal.aborted) return;
        try {
          const r = await getHealth(withTimeout(ctrl.signal, PROBE_TIMEOUT_MS));
          if (ctrl.signal.aborted) return;
          setApp(r.app);
          setState("online");
          return;
        } catch {
          if (ctrl.signal.aborted) return;
          // A miss early on is almost always a cold start, not an outage.
          setState("waking");
          await sleep(RETRY_DELAY_MS, ctrl.signal);
        }
      }
      if (!ctrl.signal.aborted) setState("offline");
    })();
    return () => ctrl.abort();
  }, []);

  const dot: Record<State, string> = {
    checking: "var(--sunny)",
    waking: "var(--sunny)",
    online: "var(--leaf)",
    offline: "var(--danger)",
  };
  const label: Record<State, string> = {
    checking: "连接后端…",
    waking: "唤醒服务中…",
    online: `后端已连接${app ? ` · ${app}` : ""}`,
    offline: "后端未运行 · 启动后刷新",
  };
  const title: Record<State, string> = {
    checking: "正在连接后端",
    waking: "免费实例休眠后首次访问需唤醒，约 30 秒，请稍候",
    online: "后端已连接",
    offline: "多次重试仍连不上后端",
  };

  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 shadow-soft"
      title={title[state]}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          state === "checking" || state === "waking" ? "animate-pulse" : ""
        }`}
        style={{ background: dot[state] }}
      />
      <span className="text-xs font-semibold text-muted">{label[state]}</span>
    </span>
  );
}
