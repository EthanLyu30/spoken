import { useEffect, useState } from "react";
import { ArrowRight, ExternalLink, RotateCcw, Volume2 } from "lucide-react";
import type { InterviewScore } from "../lib/api";
import { speakText, stopSpeaking } from "../lib/speech";
import { Buddy } from "./Buddy";
import { interviewRubric, interviewRubricUrl, interviewScoreMax } from "../lib/interviewScoring";

interface VideoReference {
  sourceUrl: string;
  embedUrl: string;
  position: string;
}

function videoReference(source?: string | null): VideoReference | null {
  if (!source) return null;
  try {
    const url = new URL(source);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    let videoId: string | undefined;
    if (url.hostname === "youtu.be") {
      videoId = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
    } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
      if (url.pathname === "/watch" && url.searchParams.getAll("v").length === 1) {
        videoId = url.searchParams.get("v") ?? undefined;
      } else {
        videoId = /^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
      }
    }
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;

    const timestamp = url.searchParams.get("t") ?? url.searchParams.get("start") ?? "0";
    const seconds = /^\d+s?$/.test(timestamp) ? Number(timestamp.replace(/s$/, "")) : 0;
    const start = Number.isSafeInteger(seconds) ? seconds : 0;
    const minutes = String(Math.floor(start / 60) % 60).padStart(2, "0");
    const remainder = String(start % 60).padStart(2, "0");
    const position = start >= 3600 ? `${Math.floor(start / 3600)}:${minutes}:${remainder}` : `${minutes}:${remainder}`;
    return {
      sourceUrl: source,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?start=${start}`,
      position,
    };
  } catch {
    // Old saved records may contain an invalid source URL.
  }
  return null;
}

function VideoAnswer({ reference, questionNumber }: { reference: VideoReference; questionNumber: number }) {
  return (
    <section className="sample-video" aria-label="视频原版答案">
      <p className="sample-video-position">已定位到 {reference.position} 的答案画面，播放后可暂停或全屏查看。</p>
      <iframe
        className="sample-video-player"
        title={`第 ${questionNumber} 题视频原版`}
        src={reference.embedUrl}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
      {/* Cross-origin iframe load events cannot confirm playback, so keep the fallback available. */}
      <a className="sample-video-link" href={reference.sourceUrl} target="_blank" rel="noopener noreferrer">
        打开原视频 <ExternalLink aria-hidden="true" />
      </a>
      <p className="sample-video-note">网络或地区限制可能影响播放，可打开原视频，或切回升级版继续学习。</p>
    </section>
  );
}

export function InterviewResults({
  result,
  onRestart,
  onExit,
  exitLabel = "回首页",
}: {
  result: InterviewScore;
  onRestart: () => void;
  onExit: () => void;
  exitLabel?: string;
}) {
  const [selected, setSelected] = useState(0);
  const [version, setVersion] = useState<"upgrade" | "original">("upgrade");
  useEffect(() => () => stopSpeaking(), [selected, version]);
  const current = result.results[selected];
  const scoreMax = interviewScoreMax(result);
  const wordCount = current?.sample_word_count ?? (current?.sample_answer.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g)?.length ?? 0);
  const estimatedSeconds = current?.sample_estimated_seconds ?? Math.round(wordCount / 110 * 60 + 4);
  const reference = current?.sample_source === "video_reference" ? videoReference(current.sample_source_url) : null;
  return (
    <div className="interview-results">
      <div className="ui-page-head">
        <div>
          <p className="eyebrow">TAKE AN INTERVIEW · YOUR REVIEW</p>
          <h1>把这次的表达，变成下次的底气。</h1>
          <p>回看表达，积累下一次能用上的说法。</p>
        </div>
        <button type="button" className="ui-button" onClick={onRestart}>
          <RotateCcw />
          再练一组
        </button>
      </div>
      <section className="interview-overall">
        <Buddy size={65} />
        <div>
          <h2>{scoreMax === 5 ? "内容参考分" : "旧版练习参考分"}</h2>
          <p>{scoreMax === 5 ? "按 ETS Interview 文本适用标准评估；未评估发音、停顿和流利度，不等同官方成绩。" : "此记录基于转写内容，保留旧版 0–6 分制，未重新评分；不与新版均分混算。"}</p>
        </div>
        <strong>
          {result.overall}
          <small> / {scoreMax}</small>
        </strong>
      </section>
      {scoreMax === 5 && <details className="interview-rubric">
        <summary>查看 0–5 分评分标准</summary>
        <p>以下为官方标准中可从文本观察的部分的中文释义；每题取整数分，上方显示四题均分。</p>
        <dl>{interviewRubric.map((band) => <div key={band.score}><dt>{band.score} 分</dt><dd>{band.description}</dd></div>)}</dl>
        <p>不以固定词数、复杂词汇数量或与视频相同的立场评分。短而完整可以得高分。</p>
        <a href={interviewRubricUrl} target="_blank" rel="noopener noreferrer">ETS 官方评分标准 <ExternalLink size={13} /></a>
      </details>}
      <div className="interview-review-grid">
        <div>
          {current && (
            <section className="interview-answer">
              <p className="eyebrow">
                QUESTION {String(selected + 1).padStart(2, "0")}
              </p>
              <h2>{current.question}</h2>
              <div className="answer-columns">
                <div>
                  <h3>你的回答</h3>
                  <p>{current.answer || "（没有录到回答）"}</p>
                  <div className="answer-feedback">
                    <h3>Pip 的建议</h3>
                    <p>{current.feedback}</p>
                  </div>
                </div>
                <div className="sample-answer">
                  <div className="sample-answer-heading">
                    <h3>参考表达</h3>
                    {version === "upgrade" && <button
                      type="button"
                      onClick={() => speakText(current.sample_answer)}
                      aria-label="朗读范例"
                    >
                      <Volume2 />
                    </button>}
                  </div>
                  <div className="sample-version-switch" role="group" aria-label="参考表达版本">
                    <button type="button" aria-pressed={version === "upgrade"} onClick={() => setVersion("upgrade")}>
                      DeepSeek 升级版
                    </button>
                    <button type="button" aria-pressed={version === "original"} disabled={!reference} onClick={() => setVersion("original")}>
                      视频原版
                    </button>
                  </div>
                  {version === "original" && reference ? (
                    <VideoAnswer key={selected} reference={reference} questionNumber={selected + 1} />
                  ) : (
                    <>
                      <p className="sample-answer-meta">{wordCount} 词 · 约 {estimatedSeconds} 秒</p>
                      <p className="sample-answer-source">
                        {reference ? (
                          <a href={reference.sourceUrl} target="_blank" rel="noopener noreferrer">参考视频思路 · DeepSeek 改写</a>
                        ) : "AI 口语示例"}
                      </p>
                      <p>{current.sample_answer}</p>
                      <p className="sample-answer-estimate">按约 110 词/分钟，加 4 秒停顿估算；实际用时因人而异。</p>
                      {!reference && <p className="sample-video-unavailable">此记录暂无已核对的视频原版，可继续查看升级版。</p>}
                    </>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
        <aside className="interview-question-list">
          <h2>四题回顾</h2>
          {result.results.map((r, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={selected === i}
              onClick={() => {
                if (selected !== i) {
                  setSelected(i);
                  setVersion("upgrade");
                }
              }}
            >
              <span>
                第 {i + 1} 题<small>{r.level}</small>
              </span>
              <strong>
                {r.score}
                <small> / {scoreMax}</small>
              </strong>
            </button>
          ))}
          <p>分数用于本次练习参考，逐题回看建议更能帮助你进步。</p>
        </aside>
      </div>
      <div className="interview-bottom">
        <button type="button" className="ui-secondary" onClick={onExit}>
          {exitLabel}
          <ArrowRight />
        </button>
      </div>
    </div>
  );
}
