import { useEffect, useState } from "react";
import { getScenario } from "../data/scenarios";
import { readGuestHistory } from "../lib/api";
import { browserGuestHistoryIds } from "../lib/clientId";

type History = Awaited<ReturnType<typeof readGuestHistory>>;

export function BrowserGuestHistory() {
  const [sources, setSources] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<History | null>(null);
  const [failed, setFailed] = useState(false);
  const guest = sources[selected];

  useEffect(() => {
    if (!guest) return;
    const controller = new AbortController();
    void readGuestHistory(guest, controller.signal).then(
      (records) => { if (!controller.signal.aborted) setHistory(records); },
      () => { if (!controller.signal.aborted) setFailed(true); },
    );
    return () => controller.abort();
  }, [guest, attempt]);

  function resetResults() {
    setHistory(null);
    setFailed(false);
  }

  if (!guest) {
    return <button className="ui-secondary my-4" onClick={() => setSources(browserGuestHistoryIds())}>
      查看本浏览器的游客记录
    </button>;
  }

  return (
    <section className="my-4 rounded-2xl border border-border bg-surface p-4" aria-label="本浏览器的游客记录">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">本浏览器的游客记录</h2>
        <button className="ui-secondary" onClick={() => { resetResults(); setSources([]); setSelected(0); }}>收起游客记录</button>
      </div>
      <p className="my-2 text-sm text-muted">这里显示留在本浏览器游客身份下的记录，与账号学习进度分开。</p>
      {sources.length > 1 && (
        <label className="my-2 block text-sm">
          游客记录来源
          <select className="ml-2 rounded-md border border-border bg-surface p-1" value={selected}
            onChange={(event) => { resetResults(); setSelected(Number(event.target.value)); }}>
            {sources.map((id, index) => <option key={id} value={index}>
              {index === 0 ? "当前游客记录" : `之前的游客记录 ${index}`}
            </option>)}
          </select>
        </label>
      )}
      {failed ? (
        <div role="status" className="text-sm">
          游客记录暂时无法加载。
          <button className="ui-secondary ml-2" onClick={() => { resetResults(); setAttempt((value) => value + 1); }}>重试</button>
        </div>
      ) : !history ? <p role="status" className="text-sm text-muted">正在读取游客记录…</p>
        : history.sessions.length + history.practice.length + history.words.length === 0
          ? <p role="status" className="text-sm text-muted">这个游客身份下没有单独保留的记录。</p>
          : (
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <h3 className="font-semibold">场景对话</h3>
                <ul>{history.sessions.map((session) => <li key={session.id} className="break-words py-1">
                  {getScenario(session.scenario_id)?.titleZh ?? (session.scenario_id === "custom" ? "自定义场景" : session.scenario_id)}
                  {" · "}{session.overall} 分
                </li>)}</ul>
              </div>
              <div>
                <h3 className="font-semibold">练习</h3>
                <ul>{history.practice.map((item) => <li key={item.id} className="break-words py-1">
                  {item.title || (item.kind === "interview" ? "Take an Interview" : "跟读练习")}
                  {" · "}{item.score} 分
                </li>)}</ul>
              </div>
              <div>
                <h3 className="font-semibold">生词与收藏</h3>
                <ul>{history.words.map((word) => <li key={word.id} className="break-words py-1">
                  {word.text}{word.meaning ? ` · ${word.meaning}` : ""}
                </li>)}</ul>
              </div>
            </div>
          )}
    </section>
  );
}
