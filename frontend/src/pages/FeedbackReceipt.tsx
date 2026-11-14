import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCircle2, Copy, Gift, Mail, RefreshCw } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { BottomNav } from "../components/BottomNav";
import {
  awardLabels, feedbackCategories, feedbackDate, feedbackEmailError, feedbackEmailPattern, feedbackStatuses,
  getFeedbackReceipt, localFeedbackReceipts,
  FeedbackApiError, privateReceiptPath, updateFeedbackReceipt, type FeedbackReceipt,
} from "../lib/productFeedbackApi";
import { useAuth } from "../store/auth";

const aiStatusText = { pending: "正在等待初筛", done: "初筛完成", skipped: "直接交给人工", failed: "初筛暂未完成" } as const;

export default function FeedbackReceiptPage() {
  const { ticketId = "" } = useParams();
  const location = useLocation();
  const generation = useAuth(state => state.generation);
  const key = new URLSearchParams(location.hash.slice(1)).get("key") ?? localFeedbackReceipts()[ticketId];
  const [loaded, setLoaded] = useState<{ scope: string; item: FeedbackReceipt } | null>(null);
  const scope = `${ticketId}|${generation}|${key ?? ""}`;
  const item = loaded?.scope === scope ? loaded.item : null;
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [wechat, setWechat] = useState("");
  const [supplement, setSupplement] = useState("");
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [revision, refresh] = useState(0);
  const [showLink, setShowLink] = useState(false);
  const [now, setNow] = useState(Date.now);
  const heading = useRef<HTMLHeadingElement>(null);
  const mutation = useRef<AbortController | null>(null);
  const ticketValid = /^[a-f0-9]{24}$/.test(ticketId);
  const keyValid = !key || /^[a-f0-9]{64}$/.test(key);

  useEffect(() => {
    if (!ticketValid || !keyValid) return;
    const controller = new AbortController();
    let busy = false;
    const read = () => {
      if (busy || mutation.current) return;
      busy = true;
      void getFeedbackReceipt(ticketId, key, controller.signal).then(data => {
        if (!controller.signal.aborted && !mutation.current) { setLoaded({ scope, item: data }); setReadError(""); setNow(Date.now()); }
      }).catch(failure => {
        if (!controller.signal.aborted && !mutation.current) {
          if (failure instanceof FeedbackApiError && [401, 403, 404].includes(failure.status)) setLoaded(null);
          setReadError(failure instanceof Error ? failure.message : "回执读取失败。");
        }
      }).finally(() => { busy = false; });
    };
    read();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") read(); }, 20_000);
    window.addEventListener("focus", read);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", read); };
  }, [ticketId, key, scope, ticketValid, keyValid, revision]);
  useEffect(() => {
    return () => { mutation.current?.abort(); mutation.current = null; };
  }, [scope]);

  useEffect(() => {
    if (location.state?.newFeedback) heading.current?.focus();
  }, [location.state?.newFeedback]);

  const canResendAt = item?.verification_retry_at ? Date.parse(item.verification_retry_at) : 0;
  const emailExpired = item?.verification_expires_at ? Date.parse(item.verification_expires_at) <= now : false;
  useEffect(() => {
    if (canResendAt <= now) return;
    const timer = window.setTimeout(() => setNow(Date.now()), canResendAt - now + 20);
    return () => window.clearTimeout(timer);
  }, [canResendAt, now]);

  async function update(event: FormEvent, action: Parameters<typeof updateFeedbackReceipt>[2], data: object, success: string) {
    event.preventDefault();
    if (!item || mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    setWorking(true); setError(""); setNotice("");
    try {
      const next = await updateFeedbackReceipt(ticketId, key, action, data, controller.signal);
      if (controller.signal.aborted) return;
      setLoaded({ scope, item: next });
      setNotice(success);
      if (action === "claim") setWechat("");
      if (action === "email") { setEditingEmail(false); setEmail(""); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "操作未完成，请重试。");
    } finally {
      if (mutation.current === controller) {
        mutation.current = null;
        setWorking(false);
        refresh(value => value + 1);
      }
    }
  }
  const privateLink = key && keyValid && ticketValid ? new URL(privateReceiptPath(ticketId, key), window.location.origin).href : "";
  async function copy() {
    try { await navigator.clipboard.writeText(privateLink); setNotice("私密回执链接已复制。"); }
    catch { setShowLink(true); }
  }

  return <div className="feedback-page feedback-receipt">
    <main id="spoken-main" tabIndex={-1} className="feedback-main">
      <Link to="/feedback" className="feedback-back"><ArrowLeft size={17} aria-hidden="true" /> 返回反馈信箱</Link>
      <div className="feedback-panel">
        <span className="feedback-kicker"><Mail size={15} aria-hidden="true" /> 仅持有链接或提交账号可查看</span>
        <h1 ref={heading} tabIndex={-1}>{location.state?.newFeedback ? "Pip 收到你的来信了" : "我的私密回执"}</h1>
        {(!ticketValid || !keyValid) && <p role="alert" className="feedback-error">请打开完整的私密回执链接。</p>}
        {ticketValid && keyValid && !item && !readError && <p role="status">正在读取回执…</p>}
        {error && <p role="alert" className="feedback-error">{error}</p>}
        {readError && <p role="alert" className="feedback-error">{readError}{item && " 当前显示上次成功加载的状态。"}</p>}
        {readError && !item && <button className="ui-secondary" type="button" onClick={() => refresh(n => n + 1)}>重试读取</button>}
        {notice && <p role="status" className="feedback-notice">{notice}</p>}
        {item && <>
          <div className="feedback-receipt-meta">
            <span>{feedbackCategories[item.category]} · {feedbackDate(item.created_at, true)}</span>
            <strong className="feedback-status">{feedbackStatuses[item.status]}</strong>
          </div>
          <p className="feedback-number">反馈编号 <code>{item.id}</code></p>
          {privateLink && <div className="feedback-receipt-link">
            <button className="ui-secondary" type="button" onClick={() => void copy()}><Copy size={16} aria-hidden="true" />复制私密回执</button>
            <small>换设备时也可以打开，请妥善保存。</small>
            {showLink && <input readOnly value={privateLink} aria-label="私密回执链接" onFocus={event => event.target.select()} />}
          </div>}
          <dl className="feedback-review-results">
            <div><dt>AI 初筛</dt><dd>{item.ai_result || aiStatusText[item.ai_status]}</dd></div>
            <div><dt>人工审核</dt><dd>{item.status === "pending" && item.supplement ? "补充说明已收到，等待继续审核。" : item.review_note || "负责人审核后会更新这里。"}</dd></div>
          </dl>
          <details className="feedback-details"><summary>查看我的意见</summary>
            <p className="feedback-preserve">{item.description}</p>
            {item.supplement && <p className="feedback-preserve">补充说明 {item.supplement}</p>}
          </details>
        </>}
      </div>
      {item?.status === "more_info" && <section className="feedback-panel">
        <h2>补充一点细节</h2>
        <form className="feedback-form" onSubmit={event => void update(event, "supplement", { description: supplement }, "补充说明已送回审核。")}>
          <label htmlFor="feedback-supplement">补充说明</label>
          <textarea id="feedback-supplement" minLength={6} maxLength={500} required rows={3}
            value={supplement} onChange={event => setSupplement(event.target.value)} />
          <button className="ui-button" disabled={working}>送出补充说明</button>
        </form>
      </section>}
      {item && item.amount !== 0 && <section className="feedback-panel feedback-reward">
        <span className="feedback-kicker"><Gift size={17} aria-hidden="true" /> PIP 请客</span>
        <h2>{awardLabels[item.amount]} · ¥{item.amount}</h2>
        {item.status === "awarded" && <>
          <p>可在 {feedbackDate(item.claim_until, "seconds")}（北京时间）前自愿填写微信号。Spoken 负责人核对后会添加你并手动转账。</p>
          <form className="feedback-form" onSubmit={event => void update(event, "claim", { wechat: wechat.trim() }, "微信号已提交，请留意好友申请。")}>
            <label htmlFor="feedback-wechat">微信号</label>
            <input id="feedback-wechat" required maxLength={32} pattern={"[A-Za-z0-9_\\-]+"} autoComplete="off"
              value={wechat} onChange={event => setWechat(event.target.value)} placeholder="填写可搜索到你的微信号" />
            <small className="feedback-muted">用于联系本次发奖。发放后从反馈记录移除。</small>
            <button className="ui-button" disabled={working}>提交微信号，领取 ¥{item.amount}</button>
          </form>
        </>}
        {item.status === "ready_to_pay" && <p>联系方式已提交，等待负责人手动转账。核验码 <code>{item.claim_code}</code>，仅在确认对方是 Spoken 负责人后提供。</p>}
        {item.status === "paid" && <p><CheckCircle2 size={17} aria-hidden="true" />已于 {feedbackDate(item.paid_at, true)} 发放，请查看微信转账记录。</p>}
        {item.status === "expired" && <p>领取期限已过，这笔预留额度已释放。</p>}
      </section>}
      {item && <section className="feedback-panel">
        <div className="feedback-panel-heading"><h2>用邮件收进度</h2>
          <button className="ui-secondary" type="button" onClick={() => refresh(n => n + 1)}><RefreshCw size={15} aria-hidden="true" /> 刷新进度</button></div>
        {item.email_verified ? <p className="feedback-notice"><CheckCircle2 size={16} aria-hidden="true" />
          {item.result_mail_status === "sent" ? "审核结果已发往你的邮箱，请查收。" :
            item.result_mail_status === "failed" ? "审核结果邮件暂未发出。你可以先在这张回执里查看。" :
            "邮箱已确认，审核结果会发到这个邮箱。"}</p> : <>
          {item.email_pending && <p className="feedback-notice">
            {!item.email_notifications ? "邮件服务暂不可用，请保存私密回执。" :
              emailExpired ? "确认链接已过期，可以重新发送。" :
              item.verification_mail_status === "sent" ? "确认邮件已发出。请在收件箱或垃圾邮件中打开链接，确认接收。" :
              item.verification_mail_status === "failed" ? "确认邮件暂未发出。系统会重试，你也可以稍后手动重发。" :
              "邮箱已登记，正在发送确认邮件。"}
          </p>}
          {item.email_pending && !editingEmail && item.email_notifications && <div className="feedback-inline feedback-mail-actions">
            <button type="button" className="ui-secondary" disabled={working || now < canResendAt}
              onClick={event => void update(event, "email", {}, "已请求重新发送确认邮件。")}>
              {now < canResendAt ? "稍后可重发" : "重发确认邮件"}
            </button>
            <button type="button" className="ui-secondary" onClick={() => setEditingEmail(true)}>更换接收邮箱</button>
          </div>}
          {(!item.email_pending || editingEmail) && item.email_notifications && <>
            <p className="feedback-muted">可选。确认后会收到审核结论，也可以直接保留此回执。</p>
            <form className="feedback-form" onSubmit={event => void update(event, "email", { email: email.trim() }, "邮箱已登记，请查收确认邮件。")}>
              <label htmlFor="feedback-email">接收邮箱</label>
              <div className="feedback-inline">
                <input id="feedback-email" type="email" required maxLength={255} autoComplete="email" spellCheck={false}
                  value={email} pattern={feedbackEmailPattern} aria-invalid={emailError || undefined}
                  aria-describedby={emailError ? "feedback-receipt-email-error" : undefined}
                  onChange={event => { setEmail(event.target.value); setEmailError(false); }}
                  onInvalid={event => { event.preventDefault(); setEmailError(true); event.currentTarget.focus(); }}
                  placeholder="name@example.com" />
                <button className="ui-secondary" disabled={working || now < canResendAt}>发送确认邮件</button>
              </div>
              {emailError && <p className="feedback-field-error" id="feedback-receipt-email-error" role="alert">{feedbackEmailError}</p>}
            </form>
          </>}
          {!item.email_notifications && !item.email_pending && <p className="feedback-muted">邮件服务暂不可用，请保留此回执查看结果。</p>}
        </>}
      </section>}
    </main>
    <BottomNav />
  </div>;
}
