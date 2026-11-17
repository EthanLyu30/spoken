import { ArrowLeft, ArrowRight, BookOpen, Target } from "lucide-react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { InteractiveEnglishText } from "../components/dictionary/InteractiveEnglishText";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { practiceCues } from "../data/practiceCues";
import { getScenario } from "../data/scenarios";
import { correctionDrills, isCorrectionCategory } from "../lib/practiceCorrections";
import { useCustomScene } from "../store/custom";

export default function PracticePrep() {
  const { scenarioId = "" } = useParams();
  const [search] = useSearchParams();
  const focusId = search.get("focus");
  const focus = isCorrectionCategory(focusId) ? correctionDrills[focusId] : null;
  const scenario = getScenario(scenarioId);
  const customScene = useCustomScene((state) => state.scene);
  const custom = scenarioId === "custom" ? customScene : null;
  if (!scenario && !custom) return <Navigate to={scenarioId === "custom" ? "/custom" : "/scenes"} replace />;

  const title = scenario?.titleZh ?? custom?.title_zh;
  const goal = scenario?.subtitle ?? custom?.goal;
  const cues = practiceCues(scenarioId, custom);
  const articleExample = focusId === "articles"
    ? cues.map(([, , sentence]) => sentence).find((sentence) => /\b(?:a|an|the)\b/i.test(sentence))
    : undefined;
  const drillPrompt = articleExample?.replace(/\b(?:a|an|the)\b/i, "___");

  return (
    <div className="min-h-screen">
      <PlayfulBackground />
      <main id="spoken-main" tabIndex={-1} className="relative mx-auto w-full max-w-3xl space-y-5 px-5 pb-16 pt-7">
        <Link to={custom ? "/custom" : "/scenes"} className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <ArrowLeft size={16} /> 返回场景
        </Link>
        <header className="card border border-border p-5 sm:p-7">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold text-coral-deep"><BookOpen size={17} /> 场景预习</p>
          <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{goal}</p>
        </header>

        {focus && (
          <section className="card border border-border p-5 sm:p-6" aria-labelledby="prep-focus">
            <h2 id="prep-focus" className="flex items-center gap-2 font-display text-lg font-bold text-ink">
              <Target size={18} /> 专项复练 · {focus.label}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink">{focus.task}</p>
            <p className="mt-3 text-sm font-semibold text-ink">
              {drillPrompt ? "补全这句里的冠词，再试着说一遍。" : focus.prompt}
            </p>
            {drillPrompt && <p className="mt-1 text-sm text-ink" lang="en">{drillPrompt}</p>}
            <details className="mt-2 rounded-xl bg-surface-2 p-3 text-sm">
              <summary className="cursor-pointer font-semibold text-ink">查看参考说法</summary>
              <p className="mt-2 leading-relaxed" lang="en"><InteractiveEnglishText text={articleExample ?? focus.answer} /></p>
            </details>
            <p className="mt-3 text-sm text-muted">进入对话后，用下面的一个关键词完成场景任务，同时应用这条规则。</p>
          </section>
        )}

        <section className="card border border-border p-5 sm:p-6" aria-labelledby="prep-phrases">
          <h2 id="prep-phrases" className="font-display text-lg font-bold text-ink">
            {custom && !custom.practice_cues?.length ? "开口句型" : "关键词与句型"}
          </h2>
          <ul className="mt-3 grid gap-3">
            {cues.map(([keyword, meaning, sentence]) => (
              <li key={keyword} className="rounded-2xl bg-surface-2 p-4">
                <p className="break-words text-sm font-bold text-ink" lang="en">{keyword}</p>
                <p className="mt-1 text-xs text-muted">{meaning}</p>
                <p className="mt-2 break-words text-sm text-ink" lang="en"><InteractiveEnglishText text={sentence} /></p>
              </li>
            ))}
          </ul>
        </section>
        <Link to={`/practice/${scenarioId}${focus ? `?focus=${focusId}` : ""}`} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-coral px-5 py-3 font-bold text-ink shadow-pop sm:w-auto">
          开始场景练习 <ArrowRight size={18} />
        </Link>
      </main>
    </div>
  );
}
