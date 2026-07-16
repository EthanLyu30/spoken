import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  Plus,
  RotateCcw,
  Volume2,
  X,
} from "lucide-react";
import type { DictionaryEntry } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { getDictionaryEntry } from "../../lib/dictionary";
import { speakText } from "../../lib/speech";
import { useWords } from "../../store/words";
import type { DictionaryOpenRequest } from "./DictionaryContext";

type OverlayState =
  | { status: "idle" | "loading" | "error"; entry?: undefined }
  | { status: "ready"; entry: DictionaryEntry };

export function DictionaryOverlay({
  request,
  onClose,
}: {
  request: DictionaryOpenRequest | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<OverlayState>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const words = useWords((value) => value.words);
  const collect = useWords((value) => value.collect);

  useEffect(() => {
    setCopied(false);
    if (!request) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    getDictionaryEntry(request.query, controller.signal).then(
      (entry) => setState({ status: "ready", entry }),
      (error: unknown) => {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return;
        }
        setState({ status: "error" });
      },
    );
    window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => controller.abort();
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        request.trigger?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, request]);

  if (!request) return null;
  const activeRequest = request;

  const mobile = window.matchMedia("(max-width: 639px)").matches;
  const left = Math.max(
    12,
    Math.min(window.innerWidth - 372, activeRequest.rect.left),
  );
  const top = Math.max(
    12,
    Math.min(window.innerHeight - 420, activeRequest.rect.bottom + 10),
  );
  const collected =
    state.status === "ready" &&
    words.some(
      (word) =>
        word.text.toLocaleLowerCase() ===
        state.entry.query.toLocaleLowerCase(),
    );

  function close() {
    onClose();
    window.getSelection()?.removeAllRanges();
    activeRequest.trigger?.focus();
  }

  function retry() {
    setState({ status: "loading" });
    getDictionaryEntry(activeRequest.query).then(
      (entry) => setState({ status: "ready", entry }),
      () => setState({ status: "error" }),
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/10"
      onMouseDown={close}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`词典：${activeRequest.query}`}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className={
          mobile
            ? "absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-h-[72vh] overflow-y-auto rounded-3xl border border-border bg-surface p-5 shadow-pop"
            : "absolute max-h-[70vh] w-[360px] overflow-y-auto rounded-3xl border border-border bg-surface p-5 shadow-pop"
        }
        style={mobile ? undefined : { left, top }}
      >
        <button
          type="button"
          onClick={close}
          aria-label="关闭词典"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-surface-2"
        >
          <X className="h-4 w-4" />
        </button>
        <h2 className="pr-10 font-display text-xl font-semibold text-ink">
          {activeRequest.query}
        </h2>

        {state.status === "loading" && (
          <p
            aria-live="polite"
            className="mt-4 flex items-center gap-2 text-sm text-muted"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            正在查词…
          </p>
        )}

        {state.status === "error" && (
          <div role="alert" className="mt-4">
            <p className="text-sm text-[#e6503d]">
              查询失败，请稍后重试。
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-2 inline-flex items-center gap-1 text-sm font-bold"
            >
              <RotateCcw className="h-4 w-4" />
              重试
            </button>
          </div>
        )}

        {state.status === "ready" && (
          <>
            {(state.entry.phonetic ||
              state.entry.part_of_speech) && (
              <p className="mt-1 text-sm text-muted">
                {state.entry.phonetic}
                {state.entry.phonetic &&
                state.entry.part_of_speech
                  ? " · "
                  : ""}
                {state.entry.part_of_speech}
              </p>
            )}
            <p className="mt-3 text-base font-bold text-ink">
              {state.entry.meaning}
            </p>
            <div className="mt-3 rounded-2xl bg-surface-2 p-3">
              <p className="text-sm text-ink">{state.entry.example}</p>
              <p className="mt-1 text-xs text-muted">
                {state.entry.example_zh}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => speakText(state.entry.query)}
                className="inline-flex items-center gap-1 text-sm font-bold"
              >
                <Volume2 className="h-4 w-4" />
                朗读
              </button>
              <button
                type="button"
                onClick={() => {
                  void copyText(state.entry.query).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  });
                }}
                className="inline-flex items-center gap-1 text-sm font-bold"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied ? "已复制" : "复制"}
              </button>
              <button
                type="button"
                disabled={collected}
                onClick={() =>
                  collect({
                    text: state.entry.query,
                    meaning: state.entry.meaning,
                    example: state.entry.example,
                    kind:
                      state.entry.query.trim().split(/\s+/).length > 1
                        ? "phrase"
                        : "word",
                  })
                }
                className="inline-flex items-center gap-1 text-sm font-bold disabled:opacity-60"
              >
                {collected ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {collected ? "已收藏" : "加入生词本"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
