import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { getScenarioSuggestion, type CustomScene } from "../lib/api";
import { useCustomScene } from "../store/custom";

const KEY = "spoken-daily-scene";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// anyDay=true returns the last cached scene regardless of date (for instant
// display while today's loads); the default only returns today's pick.
function loadCached(anyDay = false): CustomScene | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { date: string; scene: CustomScene };
    return anyDay || parsed.date === today() ? parsed.scene : null;
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
  // Show the last known pick immediately (even if it's yesterday's) so the card
  // never flashes a skeleton on repeat visits; today's pick refreshes in the
  // background if it isn't cached yet.
  const [scene, setScene] = useState<CustomScene | null>(() => loadCached(true));
  const [loading, setLoading] = useState(() => loadCached() === null);
  const [error, setError] = useState(false);
  const setActive = useCustomScene((s) => s.setScene);
  const navigate = useNavigate();

  const load = useCallback((signal?: AbortSignal, fresh = false) => {
    setLoading(true);
    setError(false);
    return getScenarioSuggestion(fresh, signal)
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
    if (loadCached()) return; // today's pick already cached — nothing to fetch
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  function play() {
    if (!scene) return;
    setActive(scene);
    navigate("/practice/custom");
  }

  return <section className="daily-pick"><div className="pick-heading"><h2 className="ui-title">今日推荐 <small>DAILY PICK</small></h2><button type="button" className="ui-secondary pick-refresh" onClick={() => void load(undefined, true)} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}换一个</button></div>
    {loading && !scene ? <div role="status" className="pick-loading">正在准备今天的推荐…</div> : scene ? <div className="pick-body"><div className="pick-image" role="img" aria-label="温暖的咖啡馆，开启今天的真实对话" /><div className="pick-copy">{scene.source && <span className="pick-source">灵感 · {scene.source}</span>}<h3>{scene.title_zh || scene.title}</h3><p className="pick-english">{scene.title}</p><p className="pick-goal">{scene.goal}</p><button type="button" className="ui-link" onClick={play}><span><ArrowRight /></span>去练这个</button></div></div> : null}
    {error && <p role="alert" className="pick-error">推荐暂时无法更新{scene ? "，仍可练习上一个场景。" : "。"}<button type="button" onClick={() => void load()}>重试推荐</button></p>}
  </section>;
}
