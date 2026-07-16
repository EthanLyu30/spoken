import { useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  RotateCcw,
  Sparkles,
  Volume2,
} from "lucide-react";
import {
  postPronunciation,
  postTurnCorrection,
  type CustomScene,
  type PronunciationResult,
  type TurnCorrectionResponse,
} from "../lib/api";
import { copyText } from "../lib/clipboard";
import type { UserTurnMeta } from "../lib/conversationTurns";
import { speakText } from "../lib/speech";
import { InteractiveEnglishText } from "./dictionary/InteractiveEnglishText";
import { PronunciationFeedback } from "./PronunciationFeedback";

type LoadState<T> =
  | { status: "idle" | "loading" | "error"; data?: undefined }
  | { status: "ready"; data: T };

export interface TurnCorrectionCardProps {
  scenarioId: string;
  text: string;
  previousPartnerMessage: string;
  custom?: CustomScene;
  meta: UserTurnMeta;
  onUseSuggestion: (suggestion: string) => void;
}

export function TurnCorrectionCard(props: TurnCorrectionCardProps) {
  const [open, setOpen] = useState(false);
  const [textState, setTextState] =
    useState<LoadState<TurnCorrectionResponse>>({ status: "idle" });
  const [pronunciationState, setPronunciationState] =
    useState<LoadState<PronunciationResult>>({ status: "idle" });
  const [copied, setCopied] = useState(false);

  const canAssessPronunciation = Boolean(props.meta.spokenText && props.meta.pcm);

  async function loadText(force = false) {
    if (!force && (textState.status === "ready" || textState.status === "loading")) {
      return;
    }
    setTextState({ status: "loading" });
    try {
      const data = await postTurnCorrection({
        scenario_id: props.scenarioId,
        text: props.text,
        previous_partner_message: props.previousPartnerMessage,
        custom: props.custom,
      });
      setTextState({ status: "ready", data });
    } catch {
      setTextState({ status: "error" });
    }
  }

  async function loadPronunciation(force = false) {
    if (!canAssessPronunciation) return;
    if (
      !force &&
      (pronunciationState.status === "ready" ||
        pronunciationState.status === "loading")
    ) {
      return;
    }
    setPronunciationState({ status: "loading" });
    try {
      const data = await postPronunciation(
        props.meta.spokenText as string,
        props.meta.pcm as ArrayBuffer,
      );
      setPronunciationState({ status: "ready", data });
    } catch {
      setPronunciationState({ status: "error" });
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      void loadText();
      void loadPronunciation();
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={toggle}
        aria-label={open ? "收起即时纠错" : "即时纠错"}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[0.66rem] font-bold uppercase tracking-wide opacity-75 transition-opacity hover:opacity-100"
      >
        <Sparkles className="h-3.5 w-3.5" />
        {open ? "收起纠错" : "即时纠错"}
      </button>

      {open && (
        <section className="mt-2 rounded-2xl bg-surface-2 p-3 text-left text-ink shadow-soft">
          {textState.status === "loading" && (
            <p
              aria-live="polite"
              className="flex items-center gap-2 text-xs text-muted"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在分析语法和表达…
            </p>
          )}

          {textState.status === "error" && (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="text-[#e6503d]">纠错失败，请重试</span>
              <button
                type="button"
                onClick={() => void loadText(true)}
                className="inline-flex items-center gap-1 font-bold"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重试
              </button>
            </div>
          )}

          {textState.status === "ready" && (
            <>
              <p className="text-[0.62rem] font-bold uppercase text-muted">原句</p>
              <p className="text-sm">
                <InteractiveEnglishText text={textState.data.original} />
              </p>
              <p className="mt-2 text-[0.62rem] font-bold uppercase text-leaf-deep">
                推荐表达
              </p>
              <p className="text-sm font-bold text-leaf-deep">
                <InteractiveEnglishText text={textState.data.suggestion} />
              </p>

              {textState.data.natural ? (
                <p className="mt-2 text-xs text-muted">表达自然，无需修改。</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {textState.data.issues.map((issue, index) => (
                    <li
                      key={`${issue.kind}-${issue.original}-${index}`}
                      className="rounded-xl bg-surface p-2"
                    >
                      <p className="text-[0.62rem] font-bold text-coral-deep">
                        {issue.kind === "grammar" ? "语法" : "表达"}
                      </p>
                      <p className="text-xs">
                        <InteractiveEnglishText
                          text={issue.original}
                          className="line-through text-muted"
                        />
                        {" → "}
                        <InteractiveEnglishText
                          text={issue.replacement}
                          className="font-bold text-leaf-deep"
                        />
                      </p>
                      <p className="text-xs text-muted">{issue.note}</p>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-2 text-xs text-muted">
                {textState.data.explanation}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() =>
                    speakText(textState.data.suggestion, props.scenarioId)
                  }
                  className="inline-flex items-center gap-1 text-xs font-bold"
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  朗读
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void copyText(textState.data.suggestion).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1200);
                    });
                  }}
                  className="inline-flex items-center gap-1 text-xs font-bold"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? "已复制" : "复制"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    props.onUseSuggestion(textState.data.suggestion)
                  }
                  className="text-xs font-bold text-coral-deep"
                >
                  放入输入框
                </button>
              </div>
            </>
          )}

          {props.meta.source === "typed" && (
            <p className="mt-3 text-xs text-muted">
              本句为文字输入，无法评测发音
            </p>
          )}
          {props.meta.source !== "typed" && !props.meta.pcm && (
            <p className="mt-3 text-xs text-muted">
              这轮录音已释放，无法评测发音
            </p>
          )}
          {canAssessPronunciation &&
            pronunciationState.status === "loading" && (
              <p aria-live="polite" className="mt-3 text-xs text-muted">
                正在评测发音…
              </p>
            )}
          {canAssessPronunciation &&
            pronunciationState.status === "error" && (
              <div
                role="alert"
                className="mt-3 flex items-center justify-between gap-2 text-xs"
              >
                <span className="text-[#e6503d]">
                  发音评测失败，可单独重试
                </span>
                <button
                  type="button"
                  onClick={() => void loadPronunciation(true)}
                  className="font-bold"
                >
                  重试
                </button>
              </div>
            )}
          {pronunciationState.status === "ready" && (
            <>
              {props.meta.source === "mixed" && (
                <p className="mt-3 text-xs text-muted">
                  评测语音片段：{props.meta.spokenText}
                </p>
              )}
              <PronunciationFeedback result={pronunciationState.data} />
              <p className="mt-1 text-[0.6rem] text-muted">
                基于讯飞评测与识别文本，仅作练习参考。
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
