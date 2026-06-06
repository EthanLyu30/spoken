import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dices, Loader2, Play, Sparkles } from "lucide-react";
import { getScenarioSuggestion, type CustomScene } from "../lib/api";
import { useCustomScene } from "../store/custom";

const KEY = "spoken-daily-scene";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadCached(): CustomScene | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { date: string; scene: CustomScene };
    return parsed.date === today() ? parsed.scene : null;
  } catch {
    return null;
  }
}

function saveCached(scene: CustomScene) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ date: today(), scene }));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Featured, DeepSeek-generated scenario of the day. Refreshes once per day. */
export function DailyScenePick() {
  const [scene, setScene] = useState<CustomScene | null>(() => loadCached());
  const [loading, setLoading] = useState(!scene);
  const [error, setError] = useState(false);
  const setActive = useCustomScene((s) => s.setScene);
  const navigate = useNavigate();

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    setError(false);
    return getScenarioSuggestion(signal)
      .then((s) => {
        setScene(s);
        saveCached(s);
      })
      .catch(() => {
        if (!signal?.aborted) setError(true);
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (scene) return;
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [scene, load]);

  function play() {
    if (!scene) return;
    setActive(scene);
    navigate("/practice/custom");
  }

  // Nothing to show and it failed — stay out of the way.
  if (error && !scene) return null;

  return (
    <section className="card relative mt-6 overflow-hidden p-5 md:p-6">
      <Sparkles
        aria-hidden
        className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 text-coral opacity-10"
      />
      <p className="eyebrow">今日新场景 · Daily pick</p>

      {loading && !scene ? (
        <div className="mt-3 space-y-2">
          <div className="h-6 w-2/3 animate-pulse rounded-full bg-surface-2" />
          <div className="h-4 w-1/2 animate-pulse rounded-full bg-surface-2" />
        </div>
      ) : scene ? (
        <>
          <h3 className="mt-1.5 font-display text-xl font-semibold text-ink">
            {scene.title_zh || scene.title}
          </h3>
          <p className="mt-0.5 text-sm font-semibold text-coral-deep">{scene.title}</p>
          {scene.source && (
            <span className="mt-2 inline-block rounded-full bg-surface-2 px-2.5 py-1 text-xs font-bold text-coral-deep">
              灵感 · {scene.source}
            </span>
          )}
          <p className="mt-1.5 text-sm text-muted">{scene.goal}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={play}
              className="inline-flex items-center gap-1.5 rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-primary-fg shadow-pop transition-transform active:translate-y-0.5"
            >
              <Play className="h-4 w-4" /> 去练这个
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-bold text-ink shadow-soft transition-transform hover:-translate-y-0.5 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Dices className="h-4 w-4" />}
              换一个
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
