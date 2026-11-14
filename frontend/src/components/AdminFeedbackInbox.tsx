import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Gift, Mail, RefreshCw } from "lucide-react";
import {
  awardLabels, feedbackCategories, feedbackDate, feedbackSources, feedbackStatuses, FeedbackApiError,
  getAdminFeedback, getAdminFeedbackItem, markFeedbackPaid, reconcileFeedbackPayout, retryFeedbackDelivery, reviewProductFeedback,
  type AdminFeedback, type Award, type FeedbackPool,
} from "../lib/productFeedbackApi";

const mailState = { pending: "待发送", sending: "发送中", sent: "已交给邮件服务", failed: "发送失败" };
const checkDeliveryLabel = "待核对投递";

function confirmationStatus(item: AdminFeedback) {
  if (item.mail_needs_check?.includes("verification")) return checkDeliveryLabel;
  return item.email_verified ? "已确认" : item.email_pending ? mailState[item.verification_mail_status] : "未填写邮箱";
}

function resultStatus(item: AdminFeedback) {
  if (!item.email_verified) return item.email_pending ? "等待确认邮箱" : "未填写邮箱";
  if (!item.review_note || item.status === "pending") return "待审核";
  if (item.mail_needs_check?.includes("result")) return checkDeliveryLabel;
  return mailState[item.result_mail_status];
}
const aiText = { pending: "待初筛", done: "已初筛", skipped: "直接人工审核", failed: "初筛失败" };

export function AdminFeedbackInbox({ selected, selectTicket, onForbidden }: {
  selected: string | null; selectTicket: (id: string | null) => void; onForbidden: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState<{ items: AdminFeedback[]; has_more: boolean; pool: FeedbackPool } | null>(null);
  const [detail, setDetail] = useState<AdminFeedback | null>(null);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, refresh] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const denied = useRef(onForbidden);
  useEffect(() => { denied.current = onForbidden; }, [onForbidden]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void getAdminFeedback(offset, status, controller.signal).then(data => {
      if (!controller.signal.aborted) { setPage(data); setLastUpdated(Date.now()); }
    }).catch(failure => {
      if (controller.signal.aborted) return;
      if (failure instanceof FeedbackApiError && [401, 403].includes(failure.status)) denied.current();
      else setError(failure instanceof Error ? failure.message : "暂时无法读取反馈。");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [offset, status, revision]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDetailError("");
    void getAdminFeedbackItem(selected, controller.signal).then(data => {
      if (!controller.signal.aborted) setDetail(data);
    }).catch(failure => {
      if (controller.signal.aborted) return;
      if (failure instanceof FeedbackApiError && [401, 403].includes(failure.status)) denied.current();
      else setDetailError(failure instanceof Error ? failure.message : "意见读取失败。");
    });
    return () => controller.abort();
  }, [selected, revision]);

  const update = () => refresh(n => n + 1);
  const current = detail?.id === selected ? detail : null;
  const remaining = page?.pool.remaining ?? null;
  return <section aria-labelledby="admin-feedback-title" className="feedback-admin">
    <header className="feedback-admin-overview">
      <div><h2 id="admin-feedback-title"><Mail size={19} aria-hidden="true" />意见信箱</h2>
        <p>人工核实后预留金额。用户留下微信号后，由你手动转账。</p>
        {lastUpdated && <p role="status">上次刷新 {new Intl.DateTimeFormat("zh-CN", { timeStyle: "medium" }).format(lastUpdated)}</p>}</div>
      <div className="feedback-admin-remaining"><Gift size={20} aria-hidden="true" /><div>
        <small>本期奖池剩余</small><strong>{remaining == null ? "—" : `¥${remaining}`} <span>/ ¥{page?.pool.budget ?? 200}</span></strong>
        {!!page?.pool.reconciliation_amount && <small>另有 ¥{page.pool.reconciliation_amount} 预留待核对</small>}
      </div></div>
      <button className="admin-refresh" type="button" disabled={loading} onClick={update}><RefreshCw size={15} aria-hidden="true" />刷新信箱</button>
    </header>
    {error && <p className="feedback-error" role="alert">{error}{page && " 下面显示上次成功加载的数据。"}</p>}
    <div className="feedback-admin-grid">
      <div className="feedback-panel feedback-admin-list">
        <label htmlFor="admin-feedback-status">审核状态</label>
        <select id="admin-feedback-status" value={status} onChange={event => { setStatus(event.target.value); setOffset(0); }}>
          <option value="">全部状态</option>{Object.entries(feedbackStatuses).map(([key, label]) =>
            <option key={key} value={key}>{label}</option>)}
        </select>
        {loading && <p role="status" className="feedback-muted">正在读取信箱…</p>}
        {!loading && page && page.items.length === 0 && <p className="feedback-muted">暂无匹配的意见。</p>}
        {!loading && page?.items.map(item =>
          <button key={item.id} className={selected === item.id ? "selected" : ""} type="button"
            aria-pressed={selected === item.id} onClick={() => selectTicket(item.id)}>
            <span>{feedbackCategories[item.category]} <small>{item.owner_type === "account" ? "注册用户" : item.owner_type === "removed" ? "已移除账号资料" : "游客"}</small></span>
            <b>{item.description || "原文已移除"}</b>
            <span>{feedbackDate(item.created_at, true)}<strong>{feedbackStatuses[item.status]}</strong></span>
            {item.owner_type !== "removed" && <span className="feedback-list-mail">
              <span className={item.owner_mail_status}>管理员 {item.mail_needs_check?.includes("owner")
                ? checkDeliveryLabel : mailState[item.owner_mail_status]}</span>
              {item.email_pending && <span className={item.verification_mail_status}>确认 {confirmationStatus(item)}</span>}
              {item.email_verified && <span className={item.result_mail_status}>结果 {resultStatus(item)}</span>}
              {!item.email_pending && !item.email_verified && <span>用户未填邮箱</span>}
            </span>}
          </button>)}
        {page && (offset > 0 || page.has_more) && <div className="feedback-pagination">
          <button type="button" aria-label="上一页" disabled={loading || offset === 0} onClick={() => setOffset(value => value - 30)}><ArrowLeft size={16} /></button>
          <button type="button" aria-label="下一页" disabled={loading || !page.has_more} onClick={() => setOffset(value => value + 30)}><ArrowRight size={16} /></button>
        </div>}
      </div>
      {detailError && <p className="feedback-panel feedback-error" role="alert">{detailError}</p>}
      {current ? <FeedbackReview key={current.id} item={current} remaining={remaining} onUpdate={next => {
        if (next) setDetail(next);
        update();
      }} /> : !detailError && <div className="feedback-panel feedback-admin-empty">
        <Mail size={26} aria-hidden="true" /><p>{selected ? "正在打开这条意见…" : "选择一条意见查看详情"}</p>
      </div>}
    </div>
  </section>;
}

function FeedbackReview({ item, remaining, onUpdate }: {
  item: AdminFeedback; remaining: number | null; onUpdate: (next?: AdminFeedback) => void;
}) {
  const [amount, setAmount] = useState<Award>(10);
  const [note, setNote] = useState(item.status === "pending" && item.supplement ? "" : item.review_note);
  const awardAvailable = item.pilot_eligible && (remaining === null || remaining >= 10);
  const [chosenDecision, setDecision] = useState<"award" | "more_info" | "no_award">("award");
  const decision = chosenDecision === "award" && !awardAvailable ? "no_award" : chosenDecision;
  const [paidConfirmation, confirmPaid] = useState(false);
  const [payoutReference, setPayoutReference] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const active = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function act(operation: () => Promise<AdminFeedback | void>, success: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setWorking(true); setMessage(""); setError("");
    try {
      const next = await operation();
      if (!active.current) return;
      setMessage(success);
      onUpdate(next || undefined);
    } catch (failure) {
      if (active.current) setError(failure instanceof Error ? failure.message : "操作暂时无法完成。");
    } finally {
      inFlight.current = false;
      if (active.current) setWorking(false);
    }
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (note.trim().length < 2) return;
    void act(() => reviewProductFeedback(item.id, decision, note.trim(), decision === "award" ? amount : undefined),
      decision === "award" ? `审核通过，已预留 ¥${amount}。` : "已保存人工审核结果。");
  }

  const actionable = item.owner_type !== "removed" && ["pending", "more_info"].includes(item.status);
  const mailChecks = item.mail_needs_check ?? [];
  return <article className="feedback-panel feedback-admin-detail">
    <div className="feedback-panel-heading"><h3>{feedbackCategories[item.category]}</h3>
      <span className="feedback-status">{feedbackStatuses[item.status]}</span></div>
    <p className="feedback-muted">{feedbackSources[item.source]} · {feedbackDate(item.created_at, true)}</p>
    <p className="feedback-number"><code>{item.id}</code></p>
    <p className="feedback-admin-message feedback-preserve">{item.description || "原文已移除"}</p>
    {item.supplement && <div className="feedback-admin-message"><b>用户补充</b><p className="feedback-preserve">{item.supplement}</p></div>}
    <dl className="feedback-review-results">
      <div><dt>AI 初筛</dt><dd>{item.ai_result || aiText[item.ai_status]}</dd></div>
      <div><dt>人工审核</dt><dd>{item.review_note || "待核实"}</dd></div>
    </dl>
    <div className="feedback-admin-mail">
      <span>管理员邮件 · {mailChecks.includes("owner") ? checkDeliveryLabel : mailState[item.owner_mail_status]}</span>
      <span>确认邮件 · {confirmationStatus(item)}</span>
      <span>审核结果邮件 · {resultStatus(item)}</span>
      {mailChecks.length > 0 && <p className="feedback-muted">已超过邮件安全重试窗口，请先在 Resend 核对投递记录。</p>}
      {!mailChecks.includes("verification") && item.email_pending && ["sending", "failed"].includes(item.verification_mail_status) && <button className="ui-secondary"
        type="button" disabled={working} onClick={() => void act(
          () => retryFeedbackDelivery(item.id, "retry-mail?kind=verification"), "已请求重试确认邮件。")}>重试确认邮件</button>}
      {!mailChecks.includes("owner") && item.owner_mail_status !== "sent" && item.owner_type !== "removed" &&
        <button className="ui-secondary" type="button" disabled={working} onClick={() => void act(
          () => retryFeedbackDelivery(item.id, "retry-mail?kind=owner"), "已请求发送管理员通知。")}>重试管理员通知</button>}
      {!mailChecks.includes("result") && item.email_verified && item.result_mail_status !== "sent" && item.review_note && item.status !== "pending" && <button className="ui-secondary"
        type="button" disabled={working} onClick={() => void act(
          () => retryFeedbackDelivery(item.id, "retry-mail?kind=result"), "已请求发送用户通知。")}>重试结果邮件</button>}
      {["pending", "failed"].includes(item.ai_status) && item.owner_type !== "removed" && <button className="ui-secondary"
        type="button" disabled={working} onClick={() => void act(() => retryFeedbackDelivery(item.id, "retry-ai"), "已请求重新初筛。")}>重试 AI 初筛</button>}
    </div>
    {actionable && <form className="feedback-form feedback-admin-form" onSubmit={review}>
      <label htmlFor="feedback-decision">审核决定</label>
      <select id="feedback-decision" value={decision} onChange={event => setDecision(event.target.value as typeof decision)}>
        <option value="award" disabled={!awardAvailable}>通过并预留奖励</option>
        <option value="more_info">请用户补充细节</option><option value="no_award">收录意见，本次不发奖</option>
      </select>
      {!awardAvailable && <p className="feedback-muted">{item.pilot_eligible ? "奖池不足最低档，仍可收录意见或请用户补充。" : "该反馈提交时不在奖励期内。"}</p>}
      {decision === "award" && <fieldset><legend>发放档位</legend><div className="feedback-admin-amounts">
        {([10, 25, 50] as const).map(value => <label key={value}>
          <input type="radio" name="feedback-award" checked={amount === value} onChange={() => setAmount(value)}
            disabled={remaining !== null && remaining < value} /> ¥{value}
          <small>{awardLabels[value]}</small>
        </label>)}
      </div>{remaining !== null && amount <= remaining && <p className="feedback-muted">通过后，奖池剩余 ¥{remaining - amount}。</p>}</fieldset>}
      <label htmlFor="feedback-review-note">给用户的审核理由</label>
      <textarea id="feedback-review-note" required minLength={2} maxLength={300} rows={3}
        value={note} onChange={event => setNote(event.target.value)} placeholder="说明确认了什么、为什么选这一档，或请用户补什么。" />
      <button className="ui-button" disabled={working || (decision === "award" && remaining !== null && amount > remaining)}>
        {decision === "award" ? `通过并预留 ¥${amount}` : "保存审核决定"}
      </button>
    </form>}
    {item.amount > 0 && <div className="feedback-admin-payment">
      <p>批准金额 <b>¥{item.amount}</b>{item.status === "awarded" && ` · 领取截止 ${feedbackDate(item.claim_until, "seconds")}（北京时间）`}</p>
      {item.status === "ready_to_pay" && item.wechat && <>
        <p>微信号 <code>{item.wechat}</code> · 核验码 <code>{item.claim_code}</code></p>
        <p className="feedback-muted">在微信完成转账后，填写账单尾号或内部记录编号。</p>
        {!paidConfirmation && <button type="button" className="ui-secondary" onClick={() => confirmPaid(true)}>记录手动发放</button>}
      </>}
      {item.status === "needs_reconciliation" && <p className="feedback-muted">
        提交者已删除账号，联系方式已清除。这笔额度仍保留，请先核对转账记录。
      </p>}
      {((item.status === "ready_to_pay" && item.wechat && paidConfirmation) || item.status === "needs_reconciliation") &&
        <div className="feedback-form">
          <label htmlFor="feedback-payout-reference">核对依据</label>
          <input id="feedback-payout-reference" maxLength={120} value={payoutReference}
            onChange={event => setPayoutReference(event.target.value)} placeholder="例如账单尾号；请勿填写收款人信息" />
          <div className="feedback-inline">
            <button type="button" className="ui-button" disabled={working || payoutReference.trim().length < 4}
              onClick={() => void act(() => item.status === "needs_reconciliation"
                ? reconcileFeedbackPayout(item.id, "paid", payoutReference.trim())
                : markFeedbackPaid(item.id, payoutReference.trim()), "已记录手动发放。")}>确认已转账 ¥{item.amount}</button>
            {item.status === "needs_reconciliation"
              ? <button type="button" className="ui-secondary" disabled={working || payoutReference.trim().length < 4}
                onClick={() => void act(() => reconcileFeedbackPayout(item.id, "released", payoutReference.trim()),
                  `已释放 ¥${item.amount}。`)}>确认未转账，释放额度</button>
              : <button type="button" className="ui-secondary" onClick={() => confirmPaid(false)}>返回</button>}
          </div>
        </div>}
      {item.status === "paid" && <p>发放记录时间 {feedbackDate(item.paid_at, true)}</p>}
      {item.payout_reference && <p className="feedback-muted">核对依据 {item.payout_reference} · {feedbackDate(item.payout_recorded_at, true)}</p>}
    </div>}
    {error && <p className="feedback-error" role="alert">{error}</p>}
    {message && <p className="feedback-notice" role="status">{message}</p>}
  </article>;
}
