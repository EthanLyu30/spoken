import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Mic, RotateCcw, Send, Timer, Volume2 } from "lucide-react";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import { Button } from "../components/ui/Button";
import { Ring } from "../components/ui/Ring";
import {
  getInterviewQuestions,
  postAsr,
  savePractice,
  scoreInterview,
  type InterviewScore,
} from "../lib/api";
import { startRecording, type ActiveRecorder } from "../lib/recorder";
import { speakText } from "../lib/speech";

const ANSWER_SECONDS = 45;

type Phase = "intro" | "quiz" | "scoring" | "results" | "error";
type QPhase = "ready" | "recording" | "transcribing";

const MAX_BAND = 6;

function bandColor(score: number): string {
  if (score >= 5) return "#2fa274";
  if (score >= 3) return "#e07f1c";
  return "#e6503d";
}

export default function Interview() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [questions, setQuestions] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [qPhase, setQPhase] = useState<QPhase>("ready");
  const [left, setLeft] = useState(ANSWER_SECONDS);
  const [result, setResult] = useState<InterviewScore | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<ActiveRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recRef.current?.stop().catch(() => undefined);
    };
  }, []);

  async function begin() {
    setPhase("scoring"); // brief loading reuse
    setError(null);
    try {
      const qs = await getInterviewQuestions(4);
      setQuestions(qs);
      setAnswers([]);
      setIdx(0);
      setQPhase("ready");
      setPhase("quiz");
    } catch {
      setError("题目生成失败，请确认后端在运行后重试。");
      setPhase("error");
    }
  }

  async function startAnswer() {
    setError(null);
    try {
      recRef.current = await startRecording();
    } catch {
      setError("无法使用麦克风，请允许权限后重试。");
      return;
    }
    setQPhase("recording");
    setLeft(ANSWER_SECONDS);
    timerRef.current = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          void finishAnswer();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function finishAnswer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (qPhase === "transcribing") return;
    setQPhase("transcribing");
    const rec = recRef.current;
    recRef.current = null;
    let text = "";
    try {
      if (rec) text = (await postAsr(await rec.stop())).trim();
    } catch {
      text = "";
    }
    const nextAnswers = [...answers, text];
    setAnswers(nextAnswers);

    if (idx + 1 < questions.length) {
      setIdx(idx + 1);
      setQPhase("ready");
    } else {
      await scoreAll(nextAnswers);
    }
  }

  async function scoreAll(allAnswers: string[]) {
    setPhase("scoring");
    try {
      const items = questions.map((q, i) => ({ question: q, answer: allAnswers[i] ?? "" }));
      const res = await scoreInterview(items);
      setResult(res);
      savePractice("interview", res.overall, "限时问答").catch(() => undefined);
      setPhase("results");
    } catch {
      setError("评分失败，请确认后端在运行后重试。");
      setPhase("error");
    }
  }

  function restart() {
    setResult(null);
    setAnswers([]);
    setIdx(0);
    setPhase("intro");
  }

  return (
    <div className="min-h-screen pb-24">
      <PlayfulBackground />

      <header className="mx-auto w-full max-w-2xl px-5 pt-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5"
        >
          <ArrowLeft className="h-4 w-4" /> 回首页
        </Link>
      </header>

      <main className="mx-auto w-full max-w-2xl px-5 py-6">
        {phase === "intro" && (
          <section className="card p-6 text-center md:p-8">
            <Buddy mood="happy" size={120} className="mx-auto" />
            <p className="eyebrow mt-2">Timed Q&A · 限时问答</p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-ink">模拟托福口语 · 独立题</h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              共 4 题，每题 45 秒即兴作答。系统按托福口语评分标准给分，并给出高分范例答案。
              全程用英文开口说，越自然越好！
            </p>
            <div className="mt-5">
              <Button size="lg" onClick={begin}>
                开始测试
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted">需要麦克风权限 · 建议在安静环境作答</p>
          </section>
        )}

        {phase === "scoring" && (
          <section className="card grid place-items-center p-10 text-center">
            <Buddy mood="talking" size={120} />
            <h1 className="mt-3 font-display text-xl font-semibold text-ink">
              {result === null && questions.length === 0 ? "正在出题…" : "正在按托福标准评分…"}
            </h1>
            <p className="mt-1 text-sm text-muted">稍等一下，马上好</p>
          </section>
        )}

        {phase === "error" && (
          <section className="card grid place-items-center gap-4 p-10 text-center">
            <Buddy mood="idle" size={110} />
            <p className="font-semibold text-ink">{error}</p>
            <div className="flex gap-3">
              <Button variant="soft" onClick={() => setPhase("intro")}>
                重新开始
              </Button>
              <Link to="/">
                <Button variant="ghost">回首页</Button>
              </Link>
            </div>
          </section>
        )}

        {phase === "quiz" && (
          <section className="card p-6 md:p-8">
            <div className="mb-4 flex items-center justify-between">
              <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-bold text-coral-deep">
                第 {idx + 1} / {questions.length} 题
              </span>
              {qPhase === "recording" && (
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[#e6503d]">
                  <Timer className="h-4 w-4" /> {left}s
                </span>
              )}
            </div>

            <h2 className="font-display text-xl font-semibold leading-snug text-ink md:text-2xl">
              {questions[idx]}
            </h2>

            <div className="mt-6 grid place-items-center gap-4">
              {qPhase === "recording" ? (
                <>
                  <Ring pct={(left / ANSWER_SECONDS) * 100} size={120} stroke={12} color="var(--coral)">
                    <div className="text-center">
                      <div className="font-display text-3xl font-bold tabnum text-ink">{left}</div>
                      <div className="text-[0.6rem] font-bold uppercase text-muted">秒</div>
                    </div>
                  </Ring>
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted">
                    <Mic className="h-4 w-4 animate-pulse text-[#e6503d]" /> 正在录音，开口说英文…
                  </span>
                  <Button onClick={() => void finishAnswer()}>
                    <Send className="h-5 w-5" /> 提交回答
                  </Button>
                </>
              ) : qPhase === "transcribing" ? (
                <span className="inline-flex items-center gap-2 text-muted">
                  <Loader2 className="h-5 w-5 animate-spin" /> 识别中…
                </span>
              ) : (
                <>
                  <Buddy mood="listening" size={104} />
                  <p className="text-sm text-muted">想好思路后点开始，计时 45 秒</p>
                  <Button size="lg" onClick={startAnswer}>
                    <Mic className="h-5 w-5" /> 开始回答（45 秒）
                  </Button>
                  {error && <p className="text-xs font-semibold text-[#e6503d]">{error}</p>}
                </>
              )}
            </div>
          </section>
        )}

        {phase === "results" && result && (
          <>
            <section className="card flex items-center gap-5 p-6">
              <Ring pct={(result.overall / MAX_BAND) * 100} size={104} stroke={11} color={bandColor(result.overall)}>
                <div className="text-center">
                  <div className="font-display text-2xl font-bold tabnum text-ink">{result.overall}</div>
                  <div className="text-[0.58rem] font-bold uppercase text-muted">/ {MAX_BAND}</div>
                </div>
              </Ring>
              <div>
                <p className="eyebrow">Your score · 总评</p>
                <h1 className="mt-1 font-display text-2xl font-semibold text-ink">托福口语预估分</h1>
                <p className="mt-1 text-sm text-muted">满分 {MAX_BAND}，对照托福独立口语评分标准</p>
              </div>
            </section>

            <div className="mt-5 space-y-5">
              {result.results.map((r, i) => (
                <section key={i} className="card p-5 md:p-6">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-muted">第 {i + 1} 题</span>
                    <span className="font-display text-lg font-bold tabnum" style={{ color: bandColor(r.score) }}>
                      {r.score}
                      <span className="ml-1 text-xs font-bold text-muted">/{MAX_BAND} · {r.level}</span>
                    </span>
                  </div>
                  <h3 className="font-display font-semibold leading-snug text-ink">{r.question}</h3>

                  <details className="mt-3 rounded-2xl bg-surface-2 p-3">
                    <summary className="cursor-pointer text-sm font-bold text-ink">你的回答</summary>
                    <p className="mt-2 text-sm text-muted">{r.answer || "（没有录到回答）"}</p>
                  </details>

                  <p className="mt-3 text-sm leading-relaxed text-ink">
                    <span className="font-bold text-coral-deep">点评：</span>
                    {r.feedback}
                  </p>

                  <div className="mt-3 rounded-2xl border border-border bg-surface p-4">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wide text-coral-deep">
                        高分范例 · Sample
                      </span>
                      <button
                        type="button"
                        onClick={() => speakText(r.sample_answer)}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-ink"
                      >
                        <Volume2 className="h-3.5 w-3.5" /> 朗读
                      </button>
                    </div>
                    <p className="text-sm leading-relaxed text-ink">{r.sample_answer}</p>
                  </div>
                </section>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button size="lg" onClick={restart}>
                <RotateCcw className="h-5 w-5" /> 再测一次
              </Button>
              <Button size="lg" variant="ghost" onClick={() => navigate("/")}>
                回首页
              </Button>
            </div>
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
