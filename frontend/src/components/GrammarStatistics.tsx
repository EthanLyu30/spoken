import { ArrowRight, ChartNoAxesColumnIncreasing, ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { getScenario } from "../data/scenarios";
import { getGrammarStatistics, type GrammarGroup, type GrammarKind, type GrammarStatistics as Statistics } from "../lib/api";
import { getAuthGeneration, subscribeAuthGeneration } from "../lib/authToken";
import { progressGeneration, subscribeProgress } from "../lib/progressCache";
import { QuickCorrectionPractice } from "./QuickCorrectionPractice";
import "./GrammarStatistics.css";

const labels: Record<GrammarKind, string> = {
  article_missing: "漏掉冠词", article_extra: "多用了冠词", article_choice: "冠词选错",
  past_simple: "漏用一般过去时", present_perfect: "现在完成时用法", agreement: "主谓一致",
  verb_object_collocation: "动宾搭配", verb_object_structure: "及物动词后多加介词",
  time_preposition: "时间介词", fixed_preposition: "固定介词搭配", embedded_question: "间接问句语序",
  reason: "because 原因从句", articles: "其他冠词用法", tense: "其他动词时态",
  prepositions: "其他介词用法", sentence_structure: "其他句子结构", word_order: "其他语序", word_choice: "其他用词搭配",
};

export function GrammarStatistics({ refresh }: { refresh: number }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const identity = useSyncExternalStore(subscribeAuthGeneration, getAuthGeneration, getAuthGeneration);
  const revision = useSyncExternalStore(subscribeProgress, progressGeneration, progressGeneration);
  return <section className="grammar-statistics" aria-labelledby={id + "-heading"}>
    <h2 id={id + "-heading"}><button type="button" className="grammar-toggle" aria-expanded={open}
      aria-controls={id} onClick={() => setOpen(!open)}>
      <ChartNoAxesColumnIncreasing size={21} aria-hidden="true" />
      语法错误统计
      <span>{open ? "收起统计" : "查看统计"}</span><ChevronDown size={17} aria-hidden="true" />
    </button></h2>
    <div id={id} hidden={!open}>
      {open && <Report key={`${identity}:${revision}:${refresh}`} />}
    </div>
  </section>;
}

function Report() {
  const [stats, setStats] = useState<Statistics>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<GrammarKind>();
  const id = useId();
  useEffect(() => {
    const controller = new AbortController();
    getGrammarStatistics(controller.signal).then((result) => {
      if (!controller.signal.aborted) setStats(result);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attempt]);
  if (error) return <div className="grammar-status" role="status">
    暂时无法读取语法错误统计。 <button type="button" className="coaching-secondary" onClick={() => {
      setError(false); setAttempt(attempt + 1);
    }}>重新加载统计</button>
  </div>;
  if (!stats) return <p className="grammar-status" role="status">正在整理你的纠错记录…</p>;
  return <>
    <p className="grammar-window">统计最近 {stats.sessions_analyzed} 次已保存的场景对话，最多 {stats.session_limit} 次。</p>
    {!stats.groups.length ? <p className="grammar-status">还没有可统计的语法纠错。练习中有分类的纠错会出现在这里。</p> : <>
      <p className="grammar-instructions">按原句中出现的处数排序。选一类，练习自己的错句。</p>
      <ol className="grammar-groups" aria-label="按出现次数排列的错误类型">
        {stats.groups.map((group) => {
          const expanded = selected === group.kind;
          const groupId = id + group.kind;
          return <li key={group.kind}>
            <button type="button" className="grammar-group-toggle" aria-controls={groupId} aria-expanded={expanded}
              onClick={() => setSelected(expanded ? undefined : group.kind)}>
              <strong>{labels[group.kind]}</strong>
              <span><b>{group.occurrences}</b> 处 · {group.sentences} 句</span>
              <ChevronRight size={17} aria-hidden="true" />
            </button>
            <div id={groupId} hidden={!expanded}>
              {expanded && <Examples group={group} />}
            </div>
          </li>;
        })}
      </ol>
    </>}
  </>;
}

function Examples({ group }: { group: GrammarGroup }) {
  const [index, setIndex] = useState(0);
  const example = group.examples[index];
  const fix = example?.corrections[0];
  if (!example || !fix) return <p className="grammar-status">这类记录暂时没有可复练的原句。</p>;
  return <div className="grammar-example">
    <div className="grammar-example-nav">
      <span>{getScenario(example.scenario_id)?.titleZh ?? "自定义场景"} · 原句 {index + 1} / {group.examples.length}
        {group.sentences > group.examples.length && `（最近 ${group.examples.length} 句）`}</span>
      {group.examples.length > 1 && <button type="button" className="coaching-secondary"
        onClick={() => setIndex((index + 1) % group.examples.length)}>下一句 <ArrowRight size={14} aria-hidden="true" /></button>}
    </div>
    <QuickCorrectionPractice key={index} example={example} correction={fix}>
      <p className="grammar-example-line" lang="en">{example.original}</p>
      <p className="coaching-phrase-pair" lang="en"><del>{fix.original}</del>
        <ArrowRight size={13} aria-hidden="true" /><strong>{fix.suggestion}</strong></p>
      {fix.note && <p className="grammar-note">{fix.note}</p>}
    </QuickCorrectionPractice>
  </div>;
}
