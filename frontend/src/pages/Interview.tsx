import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  ExternalLink,
  Lightbulb,
  Loader2,
  Mic,
  RefreshCw,
  RotateCcw,
  Send,
  Timer,
  Volume2,
} from "lucide-react";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import { InterviewResults } from "../components/InterviewResults";
import { InterviewLibrary } from "../components/InterviewLibrary";
import {
  getInterviewSets,
  type InterviewCollection,
  type InterviewSetSummary,
} from "../lib/api";
import { speakText } from "../lib/speech";
import { getClientId } from "../lib/clientId";
import { useAuth } from "../store/auth";
import {
  useInterviewSession,
  type InterviewMode,
} from "../hooks/useInterviewSession";

const stages = ["聊聊经历", "解释选择", "表达观点", "拓展讨论"];
export default function Interview() {
  const account = useAuth((s) => s.user?.id);
  const owner = account ? "account:" + account : "device:" + getClientId();
  const session = useInterviewSession(owner);
  const [mode, setMode] = useState<InterviewMode>("practice");
  const [sets, setSets] = useState<InterviewSetSummary[]>([]);
  const [source, setSource] = useState<InterviewCollection>("inspire");
  const [selected, setSelected] = useState("");
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();
  useEffect(() => {
    const controller = new AbortController();
    setCatalogueError(false);
    setCatalogueLoading(true);
    getInterviewSets(controller.signal)
      .then(setSets)
      .catch(() => {
        if (!controller.signal.aborted) setCatalogueError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogueLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);
  const sourceSets = sets.filter((entry) => entry.collection === source);
  const selection = sourceSets.find((entry) => entry.id === selected);
  const canStart = !catalogueLoading && !catalogueError && sourceSets.length > 0;
  const inspireCount = sets.filter((entry) => entry.collection === "inspire").length;
  const etsCount = sets.filter((entry) => entry.collection === "ets").length;
  const { phase, deck, idx, qPhase, error } = session;
  const active = phase !== "intro" && phase !== "results";
  return (
    <div className="min-h-screen pb-24 interview-page-v2">
      <main className="mx-auto">
        {phase === "intro" && (
          <>
            <header className="interview-heading-v2">
              <div>
                <p className="eyebrow">TOEFL iBT 2026 · TAKE AN INTERVIEW</p>
                <h1>
                  一个主题，
                  <br />
                  聊出你的想法。
                </h1>
                <p>从熟悉的经历出发，把理由说清，把观点展开。</p>
              </div>
              <div className="interview-heading-art">
                <Buddy size={130} />
                <span>Think it. Say it.</span>
              </div>
            </header>
            <div className="interview-mobile-quickstart">
              <span>
                {selection?.topic ?? "随机主题"}
                <small>
                  {source === "inspire" ? "博主系列" : "ETS 公开样题"} · 四题 · 每题 45 秒
                </small>
              </span>
              <button
                className="ui-button"
                disabled={!canStart}
                onClick={() => void session.begin(mode, selection?.id, source)}
              >
                {mode === "practice" ? "开始练习" : "开始模拟"}
                <ArrowRight size={16} />
              </button>
            </div>
            <div className="interview-setup-grid">
              <section className="interview-topic-panel">
                <div className="learning-section-title">
                  <div>
                    <p className="eyebrow">01 · CHOOSE YOUR TOPIC</p>
                    <h2>今天，想聊哪一个？</h2>
                  </div>
                  <span className="interview-source-chip">题源可追溯</span>
                </div>
                <InterviewLibrary
                  sets={sets}
                  source={source}
                  onSourceChange={setSource}
                  selected={selection?.id ?? ""}
                  onSelect={setSelected}
                  loading={catalogueLoading}
                  error={catalogueError}
                />
                {catalogueError && (
                  <p role="status" className="learning-notice">
                    主题暂时未能加载。
                    <button onClick={() => setAttempt((n) => n + 1)}>
                      重新加载
                    </button>
                  </p>
                )}
                <div className="interview-mode-heading">
                  <p className="eyebrow">02 · FIND YOUR PACE</p>
                  <h2>按自己的节奏，或像考试一样。</h2>
                </div>
                <div
                  className="interview-modes"
                  role="group"
                  aria-label="访谈模式"
                >
                  <button
                    aria-pressed={mode === "practice"}
                    onClick={() => setMode("practice")}
                  >
                    <BookOpen />
                    <span>
                      <strong>
                        练习模式<small>推荐</small>
                      </strong>
                      <p>先理思路 · 可看提示 · 逐题确认与重录</p>
                    </span>
                    {mode === "practice" && <Check size={17} />}
                  </button>
                  <button
                    aria-pressed={mode === "simulation"}
                    onClick={() => setMode("simulation")}
                  >
                    <Timer />
                    <span>
                      <strong>模拟模式</strong>
                      <p>无准备时间 · 听题后自动录音 · 连续四题</p>
                    </span>
                    {mode === "simulation" && <Check size={17} />}
                  </button>
                </div>
                <details className="interview-source-details">
                  <summary>系列收录说明</summary>
                  <p>
                    {catalogueLoading
                      ? "正在读取收录数量。"
                      : catalogueError
                        ? "收录数量暂时无法读取，请重新加载题库。"
                        : `博主系列已收录 ${inspireCount} 组，ETS 公开样题 ${etsCount} 组。`}
                    来自已核实的 Inspire SpeakEasy 视频与 ETS 新版公开样题，按原题意改编，每组保留同主题四题与来源链接。练习和模拟共用所选来源，随机抽取完整题组。它们是练习材料，不是已核实的考场原题；不会混入临时 AI 生成题。
                  </p>
                  {selection && (
                    <a
                      href={selection.source_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      当前主题来源 · {selection.source_title}
                      <ExternalLink size={12} />
                    </a>
                  )}
                  <a
                    href="https://www.youtube.com/playlist?list=PLfNWEZJODl5iNLcLDJX27jebB_psDCPec"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Inspire SpeakEasy · 完整 Interview 系列
                    <ExternalLink size={12} />
                  </a>
                </details>
              </section>
              <aside className="interview-start-panel">
                <span className="eyebrow">YOUR NEXT CONVERSATION</span>
                <h2>{selection?.topic ?? "准备好，聊个新话题。"}</h2>
                <p>
                  {selection?.topic_en ??
                    "A little challenge. A better conversation."}
                </p>
                <div className="interview-session-facts">
                  <span>
                    <strong>4</strong>道同主题问题
                  </span>
                  <span>
                    <strong>
                      45<small>s</small>
                    </strong>
                    每题作答时间
                  </span>
                </div>
                <ol>
                  {stages.map((stage, i) => (
                    <li key={stage}>
                      <span>0{i + 1}</span>
                      {stage}
                    </li>
                  ))}
                </ol>
                <button
                  className="ui-button"
                  disabled={!canStart}
                  onClick={() =>
                    void session.begin(mode, selection?.id, source)
                  }
                >
                  {mode === "practice" ? "开始这组练习" : "开始模拟访谈"}
                  <ArrowRight size={18} />
                </button>
                <p className="interview-mic-note">
                  <Mic size={14} />
                  {mode === "practice"
                    ? "录音时需要麦克风权限"
                    : "先确认麦克风，再逐题听题作答"}
                </p>
                {error && (
                  <p role="alert" className="interview-error">
                    {error}
                  </p>
                )}
                <p className="interview-score-note">
                  完成后获得逐题建议与 0–5
                  内容参考分。按 ETS Interview 文本适用标准评估，不包含发音和流利度评测，不等同官方成绩。
                </p>
              </aside>
            </div>
          </>
        )}
        {active && (
          <header className="interview-run-heading">
            <button onClick={session.exit} className="ui-secondary">
              <ArrowLeft size={15} />
              退出本次
            </button>
            <span>
              {session.mode === "practice" ? "练习模式" : "模拟模式"}
              <small>TAKE AN INTERVIEW</small>
            </span>
          </header>
        )}
        {phase === "loading" && (
          <section className="interview-loading">
            <Buddy mood="listening" size={100} />
            <h2>准备好这一组对话…</h2>
            <p>
              {session.mode === "simulation"
                ? "请先允许麦克风，接下来会听题并自动开始计时。"
                : "正在准备本次主题，马上开始。"}
            </p>
          </section>
        )}
        {phase === "quiz" && deck && (
          <>
            <div className="interview-run-title">
              <div>
                <p className="eyebrow">{deck.topic_en}</p>
                <h1>{deck.topic}</h1>
              </div>
              <span className="interview-position">
                QUESTION <strong>0{idx + 1}</strong> / 04
              </span>
            </div>
            <div className="interview-workspace">
              <section className="interview-speaking-card">
                <div className="interview-question-meta">
                  <span>{stages[idx]}</span>
                  <span>
                    <Timer size={14} />
                    45 秒作答
                  </span>
                </div>
                <h2>{deck.questions[idx]}</h2>
                {session.mode === "practice" && (
                  <div className="interview-question-tools">
                    <button onClick={() => speakText(deck.questions[idx])}>
                      <Volume2 size={16} />
                      听一听题目
                    </button>
                    <details>
                      <summary>
                        <Lightbulb size={15} />
                        一点思路
                      </summary>
                      <p>{deck.hints[idx]}</p>
                    </details>
                  </div>
                )}
                <div className={"interview-recorder-area " + qPhase}>
                  {qPhase === "recording" ? (
                    <>
                      <div
                        className="interview-countdown"
                        role="timer"
                        aria-label={"剩余 " + session.left + " 秒"}
                      >
                        <strong>
                          {String(Math.floor(session.left / 60)).padStart(
                            2,
                            "0",
                          )}
                          :{String(session.left % 60).padStart(2, "0")}
                        </strong>
                        <span>
                          <i />
                          正在录音 · 自然说出你的想法
                        </span>
                      </div>
                      <progress
                        value={session.left}
                        max={45}
                        aria-label="作答剩余时间"
                      />
                      <button
                        className="ui-button"
                        onClick={() => void session.finishAnswer()}
                      >
                        <Send size={17} />
                        {session.mode === "practice"
                          ? "结束录音，确认回答"
                          : "提前完成本题"}
                      </button>
                    </>
                  ) : qPhase === "review" ? (
                    <>
                      <label htmlFor="interview-transcript">
                        确认你的回答<span>可修正识别错误</span>
                      </label>
                      <textarea
                        id="interview-transcript"
                        value={session.draft}
                        maxLength={4000}
                        onChange={(e) => session.setDraft(e.target.value)}
                      />
                      <div className="interview-answer-actions">
                        <button
                          className="ui-secondary"
                          onClick={() => void session.startAnswer()}
                        >
                          <RotateCcw size={15} />
                          重新录一遍
                        </button>
                        <button
                          className="ui-button"
                          disabled={!session.draft.trim()}
                          onClick={() => void session.acceptAnswer()}
                        >
                          {idx === 3 ? "完成并查看反馈" : "确认，进入下一题"}
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </>
                  ) : ["listening", "starting", "transcribing"].includes(
                      qPhase,
                    ) ? (
                    <div className="interview-processing">
                      <Loader2 className="animate-spin" size={25} />
                      <strong>
                        {qPhase === "listening"
                          ? "请听题，随后自动开始作答"
                          : qPhase === "starting"
                            ? "正在连接麦克风…"
                            : "正在识别你的回答…"}
                      </strong>
                      <p>
                        {qPhase === "transcribing"
                          ? "保留你说过的每一句，马上就好。"
                          : "不用抢答，计时会在录音开始后启动。"}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="interview-ready-icon">
                        <Mic />
                      </div>
                      <h3>
                        {session.mode === "practice"
                          ? "先想好，再开口。"
                          : "本题已暂停，请恢复作答。"}
                      </h3>
                      <p>
                        {session.mode === "practice"
                          ? "准备时间不计时，点击后开始 45 秒录音。"
                          : "技术问题已暂停模拟，本题不会被当作未作答计分。"}
                      </p>
                      <div className="interview-answer-actions">
                        {session.canRetryRecognition && (
                          <button
                            className="ui-secondary"
                            onClick={() => void session.retryRecognition()}
                          >
                            <RefreshCw size={15} />
                            重新识别录音
                          </button>
                        )}
                        <button
                          className="ui-button"
                          onClick={() => void session.startAnswer()}
                        >
                          <Mic size={17} />
                          {session.canRetryRecognition
                            ? "重新录制"
                            : "开始回答"}
                        </button>
                      </div>
                    </>
                  )}
                  {error && (
                    <p role="alert" className="interview-error">
                      {error}
                    </p>
                  )}
                </div>
              </section>
              <aside className="interview-run-sidebar">
                <p className="eyebrow">ONE TOPIC · FOUR STEPS</p>
                <h2>一步步，把想法说完整。</h2>
                <ol>
                  {stages.map((stage, i) => (
                    <li
                      key={stage}
                      className={
                        i === idx ? "active" : i < idx ? "complete" : ""
                      }
                    >
                      <span>
                        {i < session.answers.length ? (
                          <Check size={15} />
                        ) : (
                          "0" + (i + 1)
                        )}
                      </span>
                      <div>
                        <strong>{stage}</strong>
                        <small>
                          {i < session.answers.length
                            ? "已完成"
                            : i === idx
                              ? "当前问题"
                              : "稍后解锁"}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
                <p>
                  {session.mode === "practice"
                    ? "回答中带一个具体细节，往往比堆砌观点更有说服力。"
                    : "听完问题后直接作答，尽量持续表达并给出理由。"}
                </p>
                <a href={deck.source_url} target="_blank" rel="noreferrer">
                  {deck.source_title}
                  <ExternalLink size={12} />
                </a>
              </aside>
            </div>
          </>
        )}
        {phase === "scoring" && (
          <section className="interview-loading">
            <Buddy mood="listening" size={110} />
            <h2>四个回答，都值得认真回看。</h2>
            <p>正在整理表达建议与参考答案。你的回答已保留。</p>
            <Loader2 size={22} className="animate-spin" />
          </section>
        )}
        {phase === "error" && (
          <section className="interview-loading">
            <Buddy size={90} />
            <h2>回答都在，稍后再试一次。</h2>
            <p role="alert">{error}</p>
            <button
              className="ui-button"
              onClick={() => void session.retryScore()}
            >
              <RefreshCw size={17} />
              重新生成反馈
            </button>
          </section>
        )}
        {phase === "results" && session.result && (
          <>
            {session.saving && (
              <p role="status" className="learning-notice">
                反馈已生成，练习记录正在保存。
              </p>
            )}
            <div className="interview-result-source">
              <span>
                {deck?.topic} ·{" "}
                {session.mode === "practice" ? "练习模式" : "模拟模式"}
              </span>
              <Link to="/progress">
                去学习进度
                <ChevronRight size={15} />
              </Link>
            </div>
            {session.saveError && (
              <p className="learning-notice" role="status">
                反馈已生成，但记录还没保存。
                <button
                  disabled={session.saving}
                  onClick={() => void session.retrySave()}
                >
                  {session.saving ? "保存中…" : "重试保存"}
                </button>
              </p>
            )}
            <InterviewResults
              result={session.result}
              onRestart={session.exit}
              onExit={() => navigate("/progress")}
              exitLabel="查看学习进度"
            />
          </>
        )}
      </main>
      {!active && <BottomNav />}
    </div>
  );
}
