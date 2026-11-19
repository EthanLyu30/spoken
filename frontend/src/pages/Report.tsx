import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  Lightbulb,
  RotateCcw,
} from "lucide-react";
import { Buddy } from "../components/Buddy";
import { CorrectionReview } from "../components/CorrectionReview";
import { PracticeSummary } from "../components/PracticeSummary";
import { PracticeFeedbackInvite } from "../components/FeedbackEntry";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Button } from "../components/ui/Button";
import { InteractiveEnglishText } from "../components/dictionary/InteractiveEnglishText";
import { useSession } from "../store/session";
import { getSession, postFeedback, type FeedbackResponse, type SessionDetail } from "../lib/api";
import { useAuth } from "../store/auth";
import { useWords } from "../store/words";
import { persistSessionOnce, unscoredSession } from "../lib/sessionSave";
import { getAuthGeneration } from "../lib/authToken";
import { getScenario } from "../data/scenarios";
import { includeMarkedCorrections } from "../lib/practiceCorrections";

const SCORE_COLORS = ["#ff6f5e", "#ff9f45", "#41c08c", "#57b7e8"];

const backLink =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5";

type ReportSession = Pick<ReturnType<typeof useSession.getState>, "scenarioId" | "practiceId" | "messages" | "markedCorrections" | "custom">;
type SavedAssessment = Awaited<ReturnType<typeof persistSessionOnce>>;

function reportFromSaved(scenarioId: string, saved: NonNullable<SavedAssessment>, candidate?: FeedbackResponse): FeedbackResponse | null {
  if (saved.overall === null) return null;
  const sameAssessment = candidate?.overall === saved.overall && candidate.summary === saved.summary && candidate.tip === saved.tip;
  return {scenario_id: scenarioId, overall: saved.overall, summary: saved.summary || "这次练习的小结",
    tip: saved.tip ?? "", scores: saved.scores ?? [], corrections: saved.corrections ?? [],
    phrases: sameAssessment ? candidate.phrases : []};
}

export default function Report() {
  const { sessionId, savedSessionId } = useParams();
  const generation = useAuth(state => state.generation);
  return savedSessionId ? <SavedReport key={`${generation}:${savedSessionId}`} id={savedSessionId} />
    : <ActiveReport key={`${generation}:${sessionId}`} id={sessionId} />;
}

function ActiveReport({id}: {id?: string}) {
  const session = useSession();
  if (!id || session.practiceId !== id) return <EmptyReport />;
  return <ReportContent session={session} />;
}

function EmptyReport() {
  return <div className="grid min-h-screen place-items-center px-5">
    <div className="text-center">
      <Buddy mood="happy" size={150} className="mx-auto" />
      <h1 className="mt-4 font-display text-2xl font-semibold text-ink">还没有可复盘的对话</h1>
      <p className="mt-2 text-muted">已保存的对话可以在练习历史里查看。</p>
      <Link to="/progress" className="mt-6 inline-block">
        <Button size="lg">查看练习历史</Button>
      </Link>
    </div>
  </div>;
}

function SavedReport({id}: {id: string}) {
  const [detail, setDetail] = useState<SessionDetail | null>();
  useEffect(() => {
    const generation = getAuthGeneration();
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && generation === getAuthGeneration();
    if (!/^\d{1,15}$/.test(id) || Number(id) < 1) { setDetail(null); return; }
    void getSession(Number(id), controller.signal).then(result => {
      if (current()) setDetail(result);
    }).catch(() => { if (current()) setDetail(null); });
    return () => controller.abort();
  }, [id]);
  if (!detail) return <main className="mx-auto max-w-3xl px-5 py-10">
    <p role="status">{detail === null ? "暂时无法打开这次对话。" : "正在读取这次对话…"}</p>
    <Link to="/progress">返回练习历史</Link>
  </main>;
  return <ReportContent storedReport={reportFromSaved(detail.scenario_id, detail)} session={{
    practiceId: detail.client_session_id ?? null, scenarioId: detail.scenario_id, messages: detail.messages,
    markedCorrections: (detail.corrections ?? []).filter(correction => correction.marked), custom: detail.custom ?? null,
  }} />;
}

function ReportContent({session, storedReport}: {session: ReportSession; storedReport?: FeedbackResponse | null}) {
  const generation = useRef(getAuthGeneration()).current;
  const { scenarioId, practiceId, messages, markedCorrections: marked, custom: customScene } = session;
  const isCustom = scenarioId === "custom";
  const scenario =
    scenarioId && !isCustom ? getScenario(scenarioId) : undefined;
  const sceneLabel =
    scenario?.titleZh ?? (isCustom ? customScene?.title_zh : undefined);
  const hasSession = !!scenarioId && messages.some((m) => m.role === "user");

  const [feedback, setFeedback] = useState<FeedbackResponse | null>(storedReport ?? null);
  const [loading, setLoading] = useState(hasSession && !storedReport);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(Boolean(storedReport));
  const [attempt, setAttempt] = useState(0);
  // phrase index -> saved word id, so the chip can toggle collect / un-collect.
  const words = useWords((s) => s.words);
  const ensureWords = useWords((s) => s.ensureLoaded);
  const collect = useWords((s) => s.collect);
  const removeWord = useWords((s) => s.remove);
  const reqId = useRef(0);

  useEffect(() => {
    ensureWords();
  }, [ensureWords]);

  useEffect(() => {
    if (storedReport || !hasSession || !scenarioId || generation !== getAuthGeneration()) return;
    const ctrl = new AbortController();
    const myId = ++reqId.current;
    const current = () => !ctrl.signal.aborted && myId === reqId.current && generation === getAuthGeneration();
    const saveResult = async (candidate?: FeedbackResponse) => {
      if (!practiceId) { if (candidate && current()) setFeedback(candidate); return; }
      try {
        const result = await persistSessionOnce(scenarioId, messages, candidate ?? unscoredSession(marked), practiceId, generation, customScene);
        if (!current()) return;
        const canonical = result ? reportFromSaved(scenarioId, result, candidate) : null;
        if (canonical) { setFeedback(canonical); setError(null); }
        else if (candidate) setFeedback(candidate);
        setSaved(true);
        setSaveError(Boolean(candidate && result?.overall === null));
      } catch {
        if (current()) { if (candidate) setFeedback(candidate); setSaveError(true); }
      }
    };
    setLoading(true);
    setError(null);
    postFeedback(
      scenarioId,
      messages,
      ctrl.signal,
      isCustom ? (customScene ?? undefined) : undefined,
    )
      .then((f) => {
        if (myId !== reqId.current || generation !== getAuthGeneration()) return;
        return saveResult(includeMarkedCorrections(f, marked));
      })
      .catch(() => {
        if (myId !== reqId.current || generation !== getAuthGeneration()) return;
        if (current()) setError("暂时无法生成小结，请重试。");
        return saveResult();
      })
      .finally(() => {
        if (!ctrl.signal.aborted && myId === reqId.current && generation === getAuthGeneration()) setLoading(false);
      });
    return () => ctrl.abort();
    // Analyse the captured session once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  async function retrySave() {
    if (!scenarioId || !practiceId || saving || generation !== getAuthGeneration()) return;
    setSaving(true);
    try {
      const result = await persistSessionOnce(scenarioId, messages, feedback ?? unscoredSession(marked), practiceId, generation, customScene);
      if (generation === getAuthGeneration()) {
        const canonical = result ? reportFromSaved(scenarioId, result, feedback ?? undefined) : null;
        if (canonical) { setFeedback(canonical); setError(null); }
        setSaveError(Boolean(feedback && result?.overall === null));
        setSaved(true);
      }
    } catch {
      if (generation === getAuthGeneration()) setSaveError(true);
    } finally {
      if (generation === getAuthGeneration()) setSaving(false);
    }
  }

  if (!hasSession) return <EmptyReport />;

  return (
    <div className="min-h-screen">

      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-5 pt-6 print:hidden">
        <Link to="/" className={backLink}>
          <ArrowLeft className="h-4 w-4" /> 回首页
        </Link>
        {feedback && !loading && (
          <button
            type="button"
            onClick={() => window.print()}
            className={backLink}
          >
            <Download className="h-4 w-4" /> 下载 PDF
          </button>
        )}
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-6">
        <PracticeFeedbackInvite completed={saved && !!feedback && !loading} source="scene_report" />
        {saveError && (
          <div
            role="alert"
            className="mb-4 rounded-2xl border border-border bg-surface p-4 text-sm text-ink"
          >
            {feedback ? "小结已生成，记录暂未保存。" : "对话和错句标记暂未保存。"}
            <button
              type="button"
              onClick={() => void retrySave()}
              disabled={saving}
              className="ml-2 font-bold underline"
            >
              {saving ? "保存中…" : "重试保存"}
            </button>
          </div>
        )}
        {loading && (
          <section className="card grid place-items-center p-10 text-center">
            <Buddy mood="talking" size={120} />
            <h1 className="mt-3 font-display text-xl font-semibold text-ink">
              Pip 正在帮你复盘…
            </h1>
            <p className="mt-1 text-sm text-muted">正在分析这次对话的发挥</p>
          </section>
        )}

        {error && !loading && (
          <section className="card grid place-items-center gap-4 p-10 text-center">
            <Buddy mood="idle" size={110} />
            <p role="alert" className="font-semibold text-ink">
              {error}
            </p>
            {saved && <Link to="/progress" className="font-semibold text-coral-deep">对话和错句标记已保存为未评分 · 查看历史</Link>}
            <div className="flex gap-3">
              <Button onClick={() => setAttempt((value) => value + 1)}>
                重试生成
              </Button>
              <Link to={`/prepare/${scenarioId}`}>
                <Button variant="soft">回到对话</Button>
              </Link>
              <Link to="/">
                <Button variant="ghost">回首页</Button>
              </Link>
            </div>
          </section>
        )}

        {error && !loading && marked.length > 0 && (
          <CorrectionReview className="mt-4" corrections={marked} messages={messages} scenarioId={scenarioId}
            custom={isCustom ? customScene ?? undefined : undefined} />
        )}

        {feedback && !loading && (
          <>
            <p className="mb-4 hidden text-sm font-semibold text-muted print:block">
              Spoken 课后报告{sceneLabel ? ` · ${sceneLabel}` : ""} ·{" "}
              {new Date().toLocaleDateString("zh-CN")}
            </p>
            <PracticeSummary scene={sceneLabel} summary={feedback.summary} score={feedback.overall}>
              {saved ? "这次对话已计入练习进度" : "本次评分"}
            </PracticeSummary>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <section className="card p-6">
                <h2 className="font-display text-lg font-semibold text-ink">
                  能力拆解 · Skills
                </h2>
                <div className="mt-4 space-y-4">
                  {feedback.scores.map((s, i) => (
                    <div key={s.key}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="font-semibold text-ink">
                          {s.label_zh} · {s.label_en}
                        </span>
                        <span
                          className="font-bold tabnum"
                          style={{
                            color: SCORE_COLORS[i % SCORE_COLORS.length],
                          }}
                        >
                          {s.score}
                        </span>
                      </div>
                      <ProgressBar
                        value={s.score}
                        color={SCORE_COLORS[i % SCORE_COLORS.length]}
                        height={10}
                      />
                    </div>
                  ))}
                </div>
              </section>

              <CorrectionReview corrections={feedback.corrections} messages={messages} scenarioId={scenarioId} custom={isCustom ? customScene ?? undefined : undefined} />
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <section className="card p-6">
                <h2 className="font-display text-lg font-semibold text-ink">
                  好用表达 · Phrases
                </h2>
                {feedback.phrases.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">
                    继续积累地道表达吧！
                  </p>
                ) : (
                  <ul className="mt-4 space-y-2.5">
                    {feedback.phrases.map((p, i) => {
                      const collected = words.some((w) => w.text === p.text);
                      return (
                        <li
                          key={i}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <span className="rounded-full bg-surface-2 px-3 py-1 text-sm font-semibold text-ink">
                            <InteractiveEnglishText text={p.text} />
                          </span>
                          <span className="text-xs text-muted">{p.note}</span>
                          <button
                            type="button"
                            title={
                              collected ? "再次点击取消收藏" : "收藏到生词本"
                            }
                            onClick={() => {
                              if (generation !== getAuthGeneration()) return;
                              const existing = words.find(
                                (w) => w.text === p.text,
                              );
                              if (existing) {
                                removeWord(existing.id);
                                return;
                              }
                              collect({
                                text: p.text,
                                meaning: p.note,
                                scenario_id: scenarioId ?? "",
                                kind: "phrase",
                              });
                            }}
                            className="text-[0.66rem] font-bold uppercase tracking-wide text-coral-deep print:hidden"
                          >
                            {collected ? "已收藏 ✓" : "+ 收藏"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="card flex p-6">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fff5d8] text-[#cf9612]">
                    <Lightbulb className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="font-display text-lg font-semibold text-ink">
                      Pip 的建议
                    </h2>
                    <p className="mt-1 text-sm leading-relaxed text-ink">
                      {feedback.tip}
                    </p>
                  </div>
                </div>
              </section>
            </div>

            <div className="mt-7 flex flex-wrap justify-center gap-3 print:hidden">
              <Link to={`/prepare/${scenarioId}`}>
                <Button size="lg">
                  <RotateCcw className="h-5 w-5" /> 再来一局
                </Button>
              </Link>
              <Link to="/progress">
                <Button size="lg" variant="soft">
                  查看进度
                </Button>
              </Link>
              <Link to="/">
                <Button size="lg" variant="ghost">
                  回首页
                </Button>
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
