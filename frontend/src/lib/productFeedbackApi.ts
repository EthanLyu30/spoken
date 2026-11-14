import { getToken } from "./authToken";
import { withTimeout } from "./requestTimeout";

export const feedbackCategories = {
  ui: "界面与易用性", feature: "功能建议", bug: "故障", learning: "练习与评分", other: "其他",
} as const;
export const feedbackSources = {
  home: "首页", profile: "我的", scene_report: "课后小结", interview_result: "面试结果", direct: "反馈信箱",
} as const;
export const feedbackStatuses = {
  pending: "待审核", more_info: "需要补充", awarded: "审核通过", ready_to_pay: "待手动发放",
  no_award: "已收录意见", paid: "已发放", expired: "领取已过期",
  needs_reconciliation: "待核对发放", released: "已释放额度",
} as const;
export const awardLabels = { 10: "请喝蜜雪冰城奶茶", 25: "请吃一顿外卖", 50: "请吃一顿疯狂星期四" } as const;

export type FeedbackCategory = keyof typeof feedbackCategories;
export type FeedbackSource = keyof typeof feedbackSources;
export type FeedbackStatus = keyof typeof feedbackStatuses;
export type Award = keyof typeof awardLabels;

export interface FeedbackPool {
  status: "unconfigured" | "upcoming" | "active" | "ended";
  budget: number;
  remaining: number | null;
  starts_at: string | null;
  ends_at: string | null;
  email_notifications?: boolean;
  reconciliation_amount?: number;
}
export interface FeedbackListItem {
  id: string;
  category: FeedbackCategory;
  created_at: string;
  status: FeedbackStatus;
  amount: Award | 0;
}
export interface FeedbackReceipt extends FeedbackListItem {
  description: string;
  source: FeedbackSource;
  supplement: string;
  ai_status: "pending" | "done" | "skipped" | "failed";
  ai_result: string;
  review_note: string;
  claim_until: string | null;
  claim_code: string | null;
  paid_at: string | null;
  email_verified: boolean;
  email_pending: boolean;
  verification_mail_status: "pending" | "sending" | "sent" | "failed";
  result_mail_status: FeedbackReceipt["verification_mail_status"];
  verification_expires_at: string | null;
  verification_retry_at: string | null;
  email_notifications: boolean;
}
export interface AdminFeedback extends FeedbackReceipt {
  owner_type: "account" | "guest" | "removed";
  pilot_eligible: boolean;
  wechat: string | null;
  owner_mail_status: "pending" | "sending" | "sent" | "failed";
  mail_needs_check?: ("owner" | "result" | "verification")[];
  payout_reference: string | null;
  payout_recorded_at: string | null;
  payout_recorded_by: number | null;
}

export class FeedbackApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const base = import.meta.env.VITE_API_BASE_URL ?? "";
const root = "/api/product-feedback";
const admin = "/api/admin/product-feedback";
const validId = /^[a-f0-9]{24}$/;
const validKey = /^[a-f0-9]{64}$/;

export function privateReceiptPath(id: string, key?: string) {
  return `/feedback/receipt/${encodeURIComponent(id)}${key ? `#key=${encodeURIComponent(key)}` : ""}`;
}

export function newFeedbackRequestId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

const localKey = "spoken.feedback.receipts.v1";

export function localFeedbackReceipts(): Record<string, string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(localKey) ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter(([id, key]) =>
      validId.test(id) && typeof key === "string" && validKey.test(key)));
  } catch { return {}; }
}

export function rememberGuestReceipt(id: string, key: string) {
  if (!validId.test(id) || !validKey.test(key)) return;
  try {
    const current = { ...localFeedbackReceipts(), [id]: key };
    localStorage.setItem(localKey, JSON.stringify(Object.fromEntries(Object.entries(current).slice(-20))));
  } catch { /* The receipt remains available by copying the private link. */ }
}

async function request<T>(path: string, options: { method?: string; body?: object; key?: string; signal?: AbortSignal; auth?: boolean } = {}): Promise<T> {
  const token = options.auth === false || options.key ? null : getToken();
  const response = await fetch(base + path, {
    method: options.method ?? "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.key ? { "X-Feedback-Key": options.key } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal: withTimeout(options.signal, 15_000),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const data = await response.json() as { detail?: unknown };
      if (typeof data.detail === "string") detail = data.detail;
    } catch { /* Upstream may return HTML. */ }
    throw new FeedbackApiError(response.status,
      response.status === 422 ? "请检查填写格式后重试。" : detail || "暂时无法连接反馈信箱，请稍后再试。");
  }
  if (response.status === 204) return undefined as T;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    throw new FeedbackApiError(response.status, "反馈服务返回了意外内容，请稍后重试。");
  }
  return response.json() as Promise<T>;
}

export const getFeedbackPool = (signal?: AbortSignal) => request<FeedbackPool>(`${root}/pilot`, { signal, auth: false });
export const submitProductFeedback = (body: {
  request_id: string; category: FeedbackCategory; source: FeedbackSource; description: string; allow_ai: boolean; email?: string;
}, signal?: AbortSignal) => request<FeedbackReceipt & { receipt_key: string }>(root, { method: "POST", body, signal });
export const getMyFeedback = (signal?: AbortSignal) => request<FeedbackListItem[]>(`${root}/mine`, { signal });
export const getFeedbackReceipt = (id: string, key: string | undefined, signal?: AbortSignal) =>
  request<FeedbackReceipt>(`${root}/${encodeURIComponent(id)}`, { key, signal });
export function updateFeedbackReceipt(
  id: string, key: string | undefined, action: "claim" | "supplement" | "email",
  body: object, signal?: AbortSignal,
) {
  return request<FeedbackReceipt>(`${root}/${encodeURIComponent(id)}/${action}`, {
    method: action === "email" ? "POST" : "PUT", body, key, signal,
  });
}
export const confirmFeedbackEmail = (id: string, token: string, signal?: AbortSignal) =>
  request<{ verified: true }>(`${root}/${encodeURIComponent(id)}/email/confirm`, {
    method: "POST", body: { token }, signal, auth: false,
  });
export const getAdminFeedback = (offset: number, status: string, signal?: AbortSignal) =>
  request<{ items: AdminFeedback[]; has_more: boolean; pool: FeedbackPool }>(
    `${admin}?offset=${offset}${status ? `&status=${encodeURIComponent(status)}` : ""}`, { signal },
  );
export const getAdminFeedbackItem = (id: string, signal?: AbortSignal) =>
  request<AdminFeedback>(`${admin}/${encodeURIComponent(id)}`, { signal });
export const reviewProductFeedback = (id: string, decision: "award" | "more_info" | "no_award", note: string, amount?: Award) =>
  request<AdminFeedback>(`${admin}/${encodeURIComponent(id)}/review`, { method: "POST", body: { decision, note, amount } });
export const markFeedbackPaid = (id: string, reference: string) =>
  request<AdminFeedback>(`${admin}/${encodeURIComponent(id)}/paid`, { method: "POST", body: { reference } });
export const reconcileFeedbackPayout = (id: string, decision: "paid" | "released", reference: string) =>
  request<AdminFeedback>(`${admin}/${encodeURIComponent(id)}/reconcile`, { method: "POST", body: { decision, reference } });
export const retryFeedbackDelivery = (id: string, action: "retry-ai" | "retry-mail?kind=owner" | "retry-mail?kind=result" | "retry-mail?kind=verification") =>
  request<void>(`${admin}/${encodeURIComponent(id)}/${action}`, { method: "POST" });

export const feedbackEmailPattern = String.raw`[^@\s]+@[^@\s]+\.[^@\s]+`;
export const feedbackEmailError = "请输入完整的邮箱地址，例如 name@example.com。";

export function feedbackDate(value: string | null, time: boolean | "seconds" = false) {
  return value ? new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric",
    ...(time ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const : {}),
    ...(time === "seconds" ? { second: "2-digit" } as const : {}),
  }).format(new Date(value)) : "";
}
