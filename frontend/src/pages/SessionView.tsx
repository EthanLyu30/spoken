import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import { CorrectionReview } from "../components/CorrectionReview";
import { InteractiveEnglishText } from "../components/dictionary/InteractiveEnglishText";
import { DictionarySceneContext } from "../components/dictionary/DictionaryContext";
import { sceneWordOrigin } from "../lib/wordOrigin";
import { Button } from "../components/ui/Button";
import { PracticeSummary } from "../components/PracticeSummary";
import { ProgressBar } from "../components/ui/ProgressBar";
import { getSession, type SessionDetail } from "../lib/api";
import { getScenario } from "../data/scenarios";
import { cn } from "../lib/utils";
import { correctionDrills, isCorrectionCategory } from "../lib/practiceCorrections";
import { recordCreationQuery } from "../lib/practiceRecordStatus";
import { getAuthGeneration } from "../lib/authToken";

const SCORE_COLORS = ["#ff6f5e", "#ff9f45", "#41c08c", "#57b7e8"];

const backLink =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5";

function formatTime(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SessionView() {
  const { id } = useParams();
  const { hash, search } = useLocation();
  const createdAt = new URLSearchParams(search).get("created_at") ?? undefined;
  return <SessionRecord key={`${id}:${createdAt ?? ""}`} id={id} createdAt={createdAt} hash={hash} />;
}

function SessionRecord({ id, createdAt, hash }: { id?: string; createdAt?: string; hash: string }) {
  const [generation] = useState(getAuthGeneration);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const num = Number(id);
    setDetail(null);
    if (!num) {
      setStatus("error");
      return;
    }
    setStatus("loading");
    const ctrl = new AbortController();
    getSession(num, ctrl.signal, createdAt)
      .then((d) => {
        if (!ctrl.signal.aborted && generation === getAuthGeneration()) {
          setDetail(d);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setStatus("error");
      });
    return () => ctrl.abort();
  }, [id, createdAt, generation]);

  useEffect(() => {
    if (status !== "ready" || detail?.id !== Number(id) || !/^#correction-turn-\d+$/.test(hash)) return;
    const turn = document.getElementById(hash.slice(1));
    turn?.scrollIntoView?.({ block: "start" });
    turn?.focus({ preventScroll: true });
  }, [status, detail?.id, id, hash]);

  const scenario = detail?.scenario_id ? getScenario(detail.scenario_id) : undefined;
  const sceneLabel = scenario
    ? `${scenario.titleZh} · ${scenario.title}`
    : detail?.scenario_id === "custom"
      ? detail.custom?.title_zh || detail.custom?.title || "自定义场景"
      : (detail?.scenario_id ?? "");
  const tags = new Map<number, Set<string>>();
  for (const entry of detail?.corrections ?? []) {
    const category = entry.category ?? null;
    if (entry.turn_index == null || entry.self_marked || !entry.marked) continue;
    const labels = tags.get(entry.turn_index) ?? new Set<string>();
    labels.add(isCorrectionCategory(category) ? correctionDrills[category].label : "表达");
    tags.set(entry.turn_index, labels);
  }

  return (
    <DictionarySceneContext.Provider value={sceneWordOrigin(detail?.scenario_id, detail?.custom)}><div className="min-h-screen pb-24">

      <header className="mx-auto w-full max-w-3xl px-5 pt-6">
        <Link to="/progress" className={backLink}>
          <ArrowLeft className="h-4 w-4" /> 返回进度
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-6">
        {(status === "loading" || (status === "ready" && detail?.id !== Number(id))) && (
          <section className="card grid place-items-center p-10 text-center">
            <Buddy mood="idle" size={110} />
            <p className="mt-3 text-muted">正在加载这次练习…</p>
          </section>
        )}

        {status === "error" && (
          <section className="card grid place-items-center gap-3 p-10 text-center">
            <Buddy mood="idle" size={110} />
            <p role="alert" className="font-semibold text-ink">没找到这次记录，或后端未连接。</p>
            <Link to="/progress">
              <Button variant="soft">返回进度</Button>
            </Link>
          </section>
        )}

        {status === "ready" && detail?.id === Number(id) && (
          <>
            <PracticeSummary scene={sceneLabel} summary={detail.summary || (detail.overall === null ? "这次练习的对话记录" : "这次练习的小结")} score={detail.overall}>
              {formatTime(detail.created_at)}
            </PracticeSummary>
            {detail.scenario_id === "custom" && detail.custom?.practice_exercises?.length === 2 && (
              <Link className="coaching-secondary mt-4" to={`/prepare/custom?${new URLSearchParams({ lesson: String(detail.id), created_at: detail.created_at })}`}>再做这次的专项练习</Link>
            )}
            {detail.overall === null && detail.client_session_id && (
              <Link className="coaching-secondary mt-4" to={`/report/saved/${detail.id}${recordCreationQuery(detail.created_at)}`}>为这次对话生成小结</Link>
            )}

            {detail.scores.length > 0 && (
              <section className="card mt-6 p-6">
                <h2 className="font-display text-lg font-semibold text-ink">能力拆解 · Skills</h2>
                <div className="mt-4 space-y-4">
                  {detail.scores.map((s, i) => (
                    <div key={s.key}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="font-semibold text-ink">
                          {s.label_zh} · {s.label_en}
                        </span>
                        <span className="font-bold tabnum" style={{ color: SCORE_COLORS[i % SCORE_COLORS.length] }}>
                          {s.score}
                        </span>
                      </div>
                      <ProgressBar value={s.score} color={SCORE_COLORS[i % SCORE_COLORS.length]} height={10} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {detail.tip && (
              <section className="card mt-6 p-6">
                <h2 className="font-display text-lg font-semibold text-ink">Pip 的建议</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink">{detail.tip}</p>
              </section>
            )}

            {detail.corrections && detail.corrections.length > 0 && (
              <CorrectionReview corrections={detail.corrections} messages={detail.messages} scenarioId={detail.scenario_id}
                sessionId={detail.id} sessionCreatedAt={detail.created_at}
                onCorrectionsChange={corrections => setDetail(current => current?.id === detail.id && current.created_at === detail.created_at ? { ...current, corrections } : current)}
                custom={detail.custom ?? undefined} className="mt-6" />
            )}

            <section className="card mt-6 p-6">
              <h2 className="mb-3 font-display text-lg font-semibold text-ink">对话回顾 · 你的回答历程</h2>
              {detail.messages.length === 0 ? (
                <p className="text-sm text-muted">这次没有保存对话内容。</p>
              ) : (
                <div className="space-y-2.5">
                  {detail.messages.map((m, i) => {
                    const isPip = m.role === "assistant";
                    return (
                      <div key={i} className={cn("flex", isPip ? "justify-start" : "justify-end")}>
                        <div
                          className={cn(
                            "max-w-[82%] rounded-3xl px-4 py-2.5 text-sm shadow-soft",
                            isPip ? "rounded-tl-md bg-surface-2 text-ink" : "rounded-tr-md text-primary-fg",
                          )}
                          style={isPip ? undefined : { background: "var(--coral-deep)" }}
                        >
                          <p className="text-[0.6rem] font-bold uppercase tracking-wide opacity-70">
                            {isPip ? "Pip" : "You"}
                          </p>
                          <p className="mt-0.5 leading-snug">
                            <InteractiveEnglishText text={m.content} />
                          </p>
                          {!isPip && tags.has(i) && (
                            <p className="mt-1 text-xs font-bold">复练标记 · {[...tags.get(i)!].join("、")}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <div className="mt-7 flex justify-center">
              <Link to="/progress">
                <Button variant="soft">返回进度</Button>
              </Link>
            </div>
          </>
        )}
      </main>
      <BottomNav />
    </div></DictionarySceneContext.Provider>
  );
}
