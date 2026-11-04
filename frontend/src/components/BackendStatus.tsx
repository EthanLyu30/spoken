import { useEffect, useState } from "react";
import { getHealth, withTimeout } from "../lib/api";

type State = "checking" | "waking" | "online" | "offline";

// Render's free tier sleeps after ~15 min idle, so the first request after a
// while triggers a cold container start (often 30–60s). Probe with short
// per-attempt timeouts and keep retrying across that window instead of giving
// up after one slow request. The visible copy stays user-facing: no service
// names, no infrastructure details.
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

/** Small status pill that surfaces whether Spoken can reach its service. */
export function BackendStatus() {
  const [state, setState] = useState<State>("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setState("checking");
    const ctrl = new AbortController();
    (async () => {
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        if (ctrl.signal.aborted) return;
        try {
          await getHealth(withTimeout(ctrl.signal, PROBE_TIMEOUT_MS));
          if (ctrl.signal.aborted) return;
          setState("online");
          return;
        } catch {
          if (ctrl.signal.aborted) return;
          setState("waking");
          await sleep(RETRY_DELAY_MS, ctrl.signal);
        }
      }
      if (!ctrl.signal.aborted) setState("offline");
    })();
    return () => ctrl.abort();
  }, [attempt]);

  const dot: Record<State, string> = {
    checking: "var(--sunny)",
    waking: "var(--sunny)",
    online: "var(--leaf)",
    offline: "var(--danger)",
  };
  const label: Record<State, string> = {
    checking: "连接服务中…",
    waking: "正在连接服务…",
    online: "服务已连接",
    offline: "服务暂不可用 · 重试",
  };
  const title: Record<State, string> = {
    checking: "正在连接 Spoken 服务",
    waking: "正在建立连接，请稍候",
    online: "Spoken 服务可用",
    offline: "多次重试仍无法连接，点击重试",
  };

  const content = (
    <>
      <span
        className={`h-2 w-2 rounded-full ${
          state === "checking" || state === "waking" ? "animate-pulse" : ""
        }`}
        style={{ background: dot[state] }}
      />
      <span className="text-xs font-semibold text-muted">{label[state]}</span>
    </>
  );
  const className =
    "inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 shadow-soft";

  if (state === "offline") {
    return (
      <button
        type="button"
        onClick={() => setAttempt((value) => value + 1)}
        className={`${className} cursor-pointer`}
        title={title.offline}
        aria-label="服务暂不可用，点击重试"
      >
        {content}
      </button>
    );
  }
  return (
    <span
      role="status"
      aria-live="polite"
      className={className}
      title={title[state]}
    >
      {content}
    </span>
  );
}
