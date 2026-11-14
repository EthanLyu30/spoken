import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ArrowUpRight, Check, Coffee, Drumstick, Gift, Mail, Sandwich } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Buddy } from "../components/Buddy";
import { BottomNav } from "../components/BottomNav";
import {
  awardLabels, feedbackCategories, feedbackDate, feedbackEmailError, feedbackEmailPattern, feedbackSources, feedbackStatuses,
  getFeedbackPool, getMyFeedback,
  localFeedbackReceipts, newFeedbackRequestId, privateReceiptPath, rememberGuestReceipt, submitProductFeedback,
  type FeedbackCategory, type FeedbackListItem, type FeedbackPool, type FeedbackSource,
} from "../lib/productFeedbackApi";
import { useAuth } from "../store/auth";

const tiers = [
  { amount: 10, icon: Coffee, heading: "确认一个小问题",
    standard: "指出一个能确认的局部问题，或提出一条可以直接采纳的小改进。",
    example: "例如 iPhone 上成绩页的标签挡住日期，但练习仍能完成。" },
  { amount: 25, icon: Sandwich, heading: "改善一段练习流程",
    standard: "帮我们定位明显影响练习的问题，或提出被采纳、能改善一段使用流程的方案。",
    example: "例如录音识别失败后找不到重试入口，说清触发步骤和适合放提示的位置。" },
  { amount: 50, icon: Drumstick, heading: "修好核心体验",
    standard: "给出关键线索，确认核心流程故障、记录丢失或系统性评分错误，或推动经验证的核心体验改进。",
    example: "例如游客注册后练习记录消失，提供了稳定的复现步骤。" },
] as const;

function FeedbackPoolView({ pool, unavailable }: { pool: FeedbackPool | null; unavailable: boolean }) {
  const remaining = pool?.remaining;
  return <div className="feedback-pool" role="status" aria-live="polite" aria-atomic="true">
    <div className="feedback-pool-label"><Gift size={17} aria-hidden="true" />本期现金答谢</div>
    <div className="feedback-pool-amount"><strong>{unavailable || remaining == null ? "—" : `¥${remaining}`}</strong>
      <span>剩余 · 总额 ¥{pool?.budget ?? 200}</span></div>
    {!unavailable && remaining != null && pool &&
      <progress max={pool.budget} value={remaining} aria-label="剩余奖励金额" />}
    <p>{unavailable ? "暂时无法读取奖池，仍可以提交意见。" :
      pool?.status === "upcoming" ? "活动即将开始" :
      pool?.status === "ended" ? "本期活动已结束，信箱继续接收意见。" :
      pool?.status === "active" && remaining === 0 ? "本期奖励已预留完毕，信箱继续接收意见。" :
      pool?.status === "active" && remaining != null && remaining < 10 ? "剩余额度不足最低档，信箱继续接收意见。" :
      pool?.status === "unconfigured" ? "活动日期待公布，信箱已开放。" :
      pool ? "审核通过后立即预留对应金额。" : "正在获取本期奖池…"}</p>
    {pool?.starts_at && <small>{feedbackDate(pool.starts_at)} 至 {feedbackDate(pool.ends_at)} · 北京时间</small>}
  </div>;
}

export default function Feedback() {
  const [params] = useSearchParams();
  const rawSource = params.get("from") ?? "";
  const source: FeedbackSource = Object.prototype.hasOwnProperty.call(feedbackSources, rawSource) ? rawSource as FeedbackSource : "direct";
  const user = useAuth(state => state.user);
  const navigate = useNavigate();
  const [pool, setPool] = useState<FeedbackPool | null>(null);
  const [poolError, setPoolError] = useState(false);
  const [history, setHistory] = useState<FeedbackListItem[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [historyRevision, refreshHistory] = useState(0);
  const [guestReceipts] = useState(localFeedbackReceipts);
  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState(false);
  const [allowAI, setAllowAI] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const request = useRef<{ body: string; id: string } | null>(null);
  const work = useRef<AbortController | null>(null);
  const formStart = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const refresh = () => {
      if (loading) return;
      loading = true;
      void getFeedbackPool(controller.signal).then(next => {
        if (!controller.signal.aborted) { setPool(next); setPoolError(false); }
      }).catch(() => { if (!controller.signal.aborted) setPoolError(true); })
        .finally(() => { loading = false; });
    };
    refresh();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (user?.id != null) void getMyFeedback(controller.signal).then(items => {
      if (!controller.signal.aborted) { setHistory(items); setHistoryError(false); }
    }).catch(() => { if (!controller.signal.aborted) setHistoryError(true); });
    return () => controller.abort();
  }, [user?.id, historyRevision]);

  useEffect(() => () => work.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !category) return;
    if (description.trim().length < 6) {
      setError("请至少写 6 个字，方便我们理解你的意见。");
      document.getElementById("feedback-description")?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    work.current = controller;
    const payload = { category, source, description: description.trim(), allow_ai: allowAI, email: email.trim() || undefined };
    const body = JSON.stringify(payload);
    if (request.current?.body !== body) request.current = { body, id: newFeedbackRequestId() };
    try {
      const item = await submitProductFeedback({ ...payload, request_id: request.current.id }, controller.signal);
      if (controller.signal.aborted) return;
      if (user?.id == null) rememberGuestReceipt(item.id, item.receipt_key);
      navigate(privateReceiptPath(item.id, item.receipt_key), { state: { newFeedback: true } });
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "暂时无法提交，请重试。");
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <div className="feedback-page">
    <main id="spoken-main" tabIndex={-1} className="feedback-main">
      <div className="feedback-hero">
        <div className="feedback-hero-copy">
          <span className="feedback-kicker"><Mail size={15} aria-hidden="true" /> SPOKEN 意见反馈 · 30 天试行</span>
          <h1>Pip 请客</h1>
          <p>你的一条意见，能让下一次开口更顺。说说哪里不好用，或有什么值得加上。</p>
          <a className="ui-button" href="#feedback-form" onClick={event => {
            if (!formStart.current || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            formStart.current.focus();
          }}>给 Pip 写封信 <ArrowRight size={17} aria-hidden="true" /></a>
        </div>
        <Buddy mood="happy" size={178} className="feedback-hero-pip" />
        <FeedbackPoolView pool={pool} unavailable={poolError} />
      </div>

      <section className="feedback-section feedback-standards" aria-labelledby="feedback-tiers">
        <h2 id="feedback-tiers">三种谢礼，按反馈的实际帮助评定</h2>
        <div className="feedback-tier-grid">{tiers.map(({ amount, icon: Icon, heading, standard, example }) =>
          <article className={`feedback-tier feedback-tier-${amount}`} key={amount}>
            <div className="feedback-tier-top"><Icon size={22} aria-hidden="true" /><strong>¥{amount}</strong></div>
            <h3>{awardLabels[amount]}</h3>
            <p><b>{heading}</b>。{standard}</p>
            <small>{example}</small>
          </article>)}</div>
      </section>

      <div className="feedback-body">
        <section className="feedback-panel" aria-labelledby="feedback-form-title" id="feedback-form" tabIndex={-1} ref={formStart}>
          <h2 id="feedback-form-title">给 Pip 写封信</h2>
          <p className="feedback-muted">游客和注册用户都可以提交，欢迎说真实感受。</p>
          <form className="feedback-form" aria-busy={busy} onSubmit={submit}>
            <fieldset><legend>你想聊什么？</legend><div className="feedback-categories">
              {Object.entries(feedbackCategories).map(([key, label]) => <label key={key} className={category === key ? "selected" : ""}>
                <input type="radio" name="category" value={key} checked={category === key} required
                  onChange={() => setCategory(key as FeedbackCategory)} />{label}
              </label>)}
            </div></fieldset>
            <label htmlFor="feedback-description">具体发生了什么？</label>
            <textarea id="feedback-description" value={description} onChange={event => setDescription(event.target.value)}
              minLength={6} maxLength={1500} required rows={4} aria-describedby="feedback-description-help"
              placeholder="在哪个页面、做了什么、你希望怎样？" />
            <div className="feedback-field-foot">
              <small id="feedback-description-help">正文里请勿填写联系方式或收款信息。</small>
              <small className="feedback-character-count">{description.length} / 1500</small>
            </div>
            <div className="feedback-email-field">
              <label htmlFor="feedback-contact-email"><Mail size={16} aria-hidden="true" />接收结果的邮箱 <span>选填</span></label>
              <input id="feedback-contact-email" name="email" type="email" maxLength={255} autoComplete="email"
                spellCheck={false} value={email} pattern={feedbackEmailPattern} aria-invalid={emailError || undefined}
                onChange={event => { setEmail(event.target.value); setEmailError(false); }}
                onInvalid={event => { event.preventDefault(); setEmailError(true); event.currentTarget.focus(); }}
                aria-describedby={`feedback-contact-help${emailError ? " feedback-contact-error" : ""}`} placeholder="name@example.com" />
              {emailError && <p className="feedback-field-error" id="feedback-contact-error" role="alert">{feedbackEmailError}</p>}
              <small id="feedback-contact-help">{pool?.email_notifications === false
                ? "邮件暂不可用。你仍可提交意见。请保存私密回执，之后可以补填邮箱或重发确认邮件。"
                : "建议填写你自己的常用邮箱。确认邮箱后，审核结果会发到这个邮箱。留空也能提交，审核结果只会更新在私密回执里，不会发邮件。请保存回执链接。"}</small>
            </div>
            <label className="feedback-checkbox">
              <input type="checkbox" checked={allowAI} onChange={event => setAllowAI(event.target.checked)} />
              <span>允许 DeepSeek 初筛这条反馈。也可以直接提交给人工。</span>
            </label>
            <small className="feedback-muted">意见正文会存入 Spoken 并发给负责人。接收邮箱仅用于这条反馈的通知。</small>
            {error && <p className="feedback-error" role="alert">{error}</p>}
            <button className="ui-button feedback-submit" type="submit" disabled={busy}>
              <Mail size={17} aria-hidden="true" />{busy ? "正在提交…" : "发送这封信"}
            </button>
          </form>
        </section>

        <aside className="feedback-panel feedback-guide" aria-labelledby="feedback-review-title">
          <h2 id="feedback-review-title">提交后会发生什么？</h2>
          <ol>
            <li><Check size={16} aria-hidden="true" /><div><strong>提交后拿到私密回执</strong><p>留了邮箱的话，打开邮件点一次确认就能接收进度。也可以保存回执自己查。</p></div></li>
            <li><Check size={16} aria-hidden="true" /><div><strong>负责人审核</strong><p>同意 AI 初筛时，DeepSeek 会先整理线索。核实、写结论和决定档位都由负责人完成。</p></div></li>
            <li><Check size={16} aria-hidden="true" /><div><strong>领取现金答谢</strong><p>获奖后 14 天内可自愿留微信号，由 Spoken 负责人加好友、核对回执后手动转账。</p></div></li>
          </ol>
          <details><summary>查看试行规则</summary>
            <p>Spoken 负责人以个人名义发起，试行 30 天，总预算 ¥200。仅在试行期内提交的反馈参与评奖。按贡献审核，同一问题只发一档，优先奖励第一条足以推动处理的意见。</p>
            <p>审核通过后预留金额，额度用完仍可提交。审核通过后 14 天内未留下微信号，预留金额将释放。活动进度和领取状态以私密回执为准。</p>
            <p>三档为现金答谢。微信号只用于联系发奖，后台确认发放后从反馈记录移除。</p>
          </details>
        </aside>
      </div>

      {(history.length > 0 || Object.keys(guestReceipts).length > 0 || historyError) && <section className="feedback-panel feedback-history">
        <h2>我的反馈</h2>
        {historyError && <p className="feedback-muted">账号反馈暂时无法读取。 <button className="ui-link" type="button"
          onClick={() => refreshHistory(n => n + 1)}>重试</button></p>}
        {history.map(item => <Link key={item.id} to={privateReceiptPath(item.id)}>
          <span>{feedbackCategories[item.category]} · {feedbackDate(item.created_at)}</span><span>{feedbackStatuses[item.status]} <ArrowUpRight size={15} aria-hidden="true" /></span>
        </Link>)}
        {Object.entries(guestReceipts).filter(([id]) => !history.some(item => item.id === id)).map(([id, key]) =>
          <Link key={id} to={privateReceiptPath(id, key)}><span>本机游客回执 · {id.slice(-6).toUpperCase()}</span><ArrowUpRight size={15} aria-hidden="true" /></Link>)}
      </section>}
    </main>
    <BottomNav />
  </div>;
}
