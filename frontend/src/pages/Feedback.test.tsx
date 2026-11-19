import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Feedback from "./Feedback";
import FeedbackReceiptPage from "./FeedbackReceipt";
import FeedbackEmailConfirm from "./FeedbackEmailConfirm";
import { AdminFeedbackInbox } from "../components/AdminFeedbackInbox";
import { localFeedbackReceipts, privateReceiptPath, rememberGuestReceipt, type AdminFeedback, type FeedbackReceipt } from "../lib/productFeedbackApi";
import { clearToken, setToken } from "../lib/authToken";
import { rotateClientId } from "../lib/clientId";
import { useAuth } from "../store/auth";

const id = "e".repeat(24);
const key = "a".repeat(64);
const receipt: FeedbackReceipt = {
  id, category: "bug", created_at: "2026-11-10T11:00:00Z", status: "pending", amount: 0,
  description: "录音失败后找不到重试入口。", source: "direct", supplement: "",
  ai_status: "skipped", ai_result: "", review_note: "", claim_until: null, claim_code: null,
  paid_at: null, email_verified: false, email_pending: false, verification_mail_status: "pending",
  result_mail_status: "pending", verification_expires_at: null, verification_retry_at: null,
  email_notifications: true,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function feedbackRoute(entry: string | { pathname: string; search: string; state: unknown } = "/feedback") {
  render(<MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/feedback" element={<Feedback />} />
      <Route path="/feedback/receipt/:ticketId" element={<h1>已打开私密回执</h1>} />
    </Routes>
  </MemoryRouter>);
}

afterEach(() => {
  cleanup();
  clearToken();
  useAuth.setState({user: null});
  localStorage.clear();
  vi.unstubAllGlobals();
});

function switchToAccount(account: number) {
  setToken(`feedback-account-${account}`);
  useAuth.setState({user: {id: account, email: "", display_name: "", avatar_url: "", created_at: ""}});
}

it("appends older registered feedback without losing entries already on screen", async () => {
  useAuth.setState({user: {id: 18, email: "learner@example.test", display_name: "Learner", avatar_url: "", created_at: "2026-11-10"}});
  const oldest = "d".repeat(24);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/pilot")) return json({ status: "unconfigured", budget: 200, remaining: 200 });
    if (url.endsWith("/mine/page")) return json({items: [receipt], next_cursor: id});
    if (url.endsWith(`/mine/page?before=${id}`)) return json({items: [{...receipt, id: oldest, category: "feature"}], next_cursor: null});
    throw new Error("Unexpected request");
  }));
  feedbackRoute();
  await userEvent.click(await screen.findByRole("button", {name: "查看更早"}));
  expect(await screen.findByRole("link", {name: /功能建议/})).toHaveAttribute("href", privateReceiptPath(oldest));
  expect(screen.getByRole("link", {name: /问题反馈|故障/})).toHaveAttribute("href", privateReceiptPath(id));
  expect(screen.queryByRole("button", {name: "查看更早"})).not.toBeInTheDocument();
});

it("retains and reveals guest receipts older than the newest twenty", async () => {
  const receiptIds = Array.from({length: 21}, (_, index) => index.toString(16).padStart(24, "a"));
  for (const receiptId of receiptIds) rememberGuestReceipt(receiptId, key);
  vi.stubGlobal("fetch", vi.fn(async () => json({status: "unconfigured", budget: 200, remaining: 200})));
  feedbackRoute();
  expect(screen.getAllByRole("link", {name: /本机游客回执/})).toHaveLength(20);
  await userEvent.click(screen.getByRole("button", {name: "查看更早的游客回执"}));
  expect(screen.getAllByRole("link", {name: /本机游客回执/})).toHaveLength(21);
  expect(screen.getByRole("link", {name: /AAAAA0/})).toHaveAttribute("href", privateReceiptPath(receiptIds[0], key));
});

it("orders guest receipts by creation time even when they are remembered out of order", () => {
  const recentId = "b".repeat(24);
  rememberGuestReceipt(recentId, key, "2026-11-18T11:00:00Z");
  rememberGuestReceipt(id, key, "2026-11-10T11:00:00Z");
  expect(Object.keys(localFeedbackReceipts())).toEqual([recentId, id]);
});

it("does not expose guest history under an account or under a rotated guest identity", async () => {
  rememberGuestReceipt(id, key);
  expect(localFeedbackReceipts()).toEqual({ [id]: key });
  switchToAccount(29);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/mine/page")
    ? json({ items: [], next_cursor: null }) : json({ status: "unconfigured" })));
  feedbackRoute();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("link", { name: /本机游客回执/ })).not.toBeInTheDocument();
  expect(localFeedbackReceipts()).toEqual({});
  act(() => { clearToken(); rotateClientId(); });
  expect(localFeedbackReceipts()).toEqual({});
});

it("restarts from the first page when the saved feedback cursor has been removed", async () => {
  const freshId = "b".repeat(24);
  let firstPages = 0;
  const read = vi.fn(async (url: string) => {
    if (url.endsWith("/mine/page")) return ++firstPages === 1
      ? json({ items: [receipt], next_cursor: id })
      : json({ items: [{ ...receipt, id: freshId, category: "feature" }], next_cursor: null });
    if (url.endsWith(`/mine/page?before=${id}`)) return json({ detail: "分页位置已失效" }, 404);
    return json({ status: "unconfigured" });
  });
  vi.stubGlobal("fetch", read);
  switchToAccount(30);
  feedbackRoute();
  await userEvent.click(await screen.findByRole("button", { name: "查看更早" }));
  expect(await screen.findByRole("link", { name: /功能建议/ })).toHaveAttribute("href", privateReceiptPath(freshId));
  expect(screen.queryByRole("link", { name: /故障/ })).not.toBeInTheDocument();
  expect(read.mock.calls.filter(([url]) => url.includes("?before="))).toHaveLength(1);
  expect(firstPages).toBe(2);
});

it("discards a pending earlier page when a different account opens the feedback list", async () => {
  let resolveOlder!: (response: Response) => void;
  let olderSignal: AbortSignal | null | undefined;
  const older = new Promise<Response>(resolve => { resolveOlder = resolve; });
  const otherId = "b".repeat(24);
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const auth = new Headers(options?.headers).get("Authorization");
    if (url.endsWith(`/mine/page?before=${id}`)) {
      olderSignal = options?.signal;
      return older;
    }
    if (url.endsWith("/mine/page")) return auth === "Bearer feedback-account-31"
      ? json({ items: [receipt], next_cursor: id })
      : json({ items: [{ ...receipt, id: otherId, category: "feature" }], next_cursor: null });
    return json({ status: "unconfigured" });
  }));
  switchToAccount(31);
  feedbackRoute();
  await userEvent.click(await screen.findByRole("button", { name: "查看更早" }));
  await waitFor(() => expect(olderSignal).toBeDefined());
  act(() => switchToAccount(32));
  expect(await screen.findByRole("link", { name: /功能建议/ })).toHaveAttribute("href", privateReceiptPath(otherId));
  expect(olderSignal?.aborted).toBe(true);
  await act(async () => resolveOlder(json({ items: [receipt], next_cursor: null })));
  expect(screen.queryByRole("link", { name: /故障/ })).not.toBeInTheDocument();
});

it("keeps the logged-in credential when opening an explicit guest receipt link", async () => {
  const read = vi.fn(async (_url: string, options?: RequestInit) => {
    expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer feedback-account-33");
    return json({ detail: "未找到回执。" }, 404);
  });
  vi.stubGlobal("fetch", read);
  switchToAccount(33);
  render(<MemoryRouter initialEntries={[privateReceiptPath(id, key)]}>
    <Routes><Route path="/feedback/receipt/:ticketId" element={<FeedbackReceiptPage />} /></Routes>
  </MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("未找到回执");
  expect(read).toHaveBeenCalledOnce();
  expect(screen.queryByText("查看我的意见")).not.toBeInTheDocument();
});

it("opens an editable coaching report and submits it only after the learner sends it", async () => {
  const submissions: Record<string, string>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/pilot")) return json({ status: "unconfigured", budget: 200, remaining: 200 });
    if (options?.method === "POST") {
      submissions.push(JSON.parse(String(options.body)));
      return json({ ...receipt, receipt_key: key }, 201);
    }
    throw new Error("Unexpected request");
  }));
  feedbackRoute({ pathname: "/feedback", search: "?from=coaching",
    state: { coaching: { title: "酒店前台", tasks: ["报告昨天完成的一件事。", "告诉同事上周做了什么。"] } } });
  const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "具体发生了什么？" });
  expect(field.value).toContain("酒店前台");
  expect(field.value).toContain("报告昨天完成的一件事。");
  expect(screen.getByRole("radio", { name: "练习与评分" })).toBeChecked();
  expect(submissions).toHaveLength(0);
  await userEvent.setup().click(screen.getByRole("button", { name: "发送这封信" }));
  expect(await screen.findByRole("heading", { name: "已打开私密回执" })).toBeVisible();
  expect(submissions).toEqual([expect.objectContaining({ source: "coaching", category: "learning", allow_ai: false })]);
});

it("announces an invalid optional email and keeps the draft and request id for retries", async () => {
  const submissions: Record<string, string>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/pilot")) return json({ status: "active", budget: 200, remaining: 200, email_notifications: true });
    if (options?.method === "POST") {
      submissions.push(JSON.parse(String(options.body)));
      if (submissions.length === 1) return json({ detail: "暂时无法提交，请重试。" }, 503);
      return json({ ...receipt, receipt_key: key }, 201);
    }
    throw new Error("Unexpected request");
  }));
  feedbackRoute();
  const user = userEvent.setup();
  const email = screen.getByRole("textbox", { name: /接收结果的邮箱/ });
  expect(email).toHaveAccessibleDescription(/审核结果只会更新在私密回执里，不会发邮件/);
  await user.click(screen.getByRole("radio", { name: "故障" }));
  await user.type(screen.getByRole("textbox", { name: "具体发生了什么？" }), receipt.description);
  await user.type(email, "not-an-email");
  await user.click(screen.getByRole("button", { name: "发送这封信" }));
  expect(await screen.findByText(/请输入完整的邮箱地址/)).toBeVisible();
  expect(email).toHaveAttribute("aria-invalid", "true");
  expect(email).toHaveFocus();
  expect(submissions).toHaveLength(0);

  await user.clear(email);
  expect(email).not.toHaveAttribute("aria-invalid");
  await user.click(screen.getByRole("button", { name: "发送这封信" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法提交");
  expect(screen.getByRole("textbox", { name: "具体发生了什么？" })).toHaveValue(receipt.description);
  await user.click(screen.getByRole("button", { name: "发送这封信" }));
  expect(await screen.findByRole("heading", { name: "已打开私密回执" })).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  expect(submissions[0]).not.toHaveProperty("email");
});

it("shows the delivery check and hides expired admin retry actions", async () => {
  const item: AdminFeedback = {
    ...receipt, status: "no_award", review_note: "已收录。", email_verified: true,
    owner_type: "guest", pilot_eligible: false, wechat: null, owner_mail_status: "sending",
    result_mail_status: "failed", mail_needs_check: ["owner", "result"], payout_reference: null,
    payout_recorded_at: null, payout_recorded_by: null,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("?offset=")
    ? json({ items: [item], has_more: false, pool: { status: "unconfigured", budget: 200, remaining: null } })
    : json(item)));
  render(<AdminFeedbackInbox selected={id} selectTicket={vi.fn()} onForbidden={vi.fn()} />);
  expect(await screen.findByText(/请先在 Resend 核对投递记录/)).toBeVisible();
  expect(screen.getByText("管理员邮件 · 待核对投递")).toBeVisible();
  expect(screen.getByText("审核结果邮件 · 待核对投递")).toBeVisible();
  expect(screen.queryByRole("button", { name: "重试管理员通知" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "重试结果邮件" })).not.toBeInTheDocument();
});

it("opens confirmation without sending until clicked, and confirms without the receipt key", async () => {
  const send = vi.fn(async () => json({ verified: true }));
  vi.stubGlobal("fetch", send);
  render(<MemoryRouter initialEntries={[`/feedback/confirm/${id}#token=${key}`]}>
    <Routes><Route path="/feedback/confirm/:ticketId" element={<FeedbackEmailConfirm />} /></Routes>
  </MemoryRouter>);
  expect(screen.getByRole("heading", { name: "确认接收审核结果" })).toBeVisible();
  expect(send).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole("button", { name: "确认接收" }));
  expect(await screen.findByRole("heading", { name: "邮箱已确认" })).toBeVisible();
  const call = send.mock.calls[0] as unknown as [string, RequestInit];
  expect(call[0]).toContain("/email/confirm");
  expect(JSON.parse(String(call[1].body))).toEqual({ token: key });
  expect(new Headers(call[1].headers).has("X-Feedback-Key")).toBe(false);
});

it("clears private receipt content when a refresh reports that access was removed", async () => {
  const read = vi.fn()
    .mockResolvedValueOnce(json(receipt))
    .mockResolvedValueOnce(json({ detail: "未找到回执。" }, 404));
  vi.stubGlobal("fetch", read);
  render(<MemoryRouter initialEntries={[privateReceiptPath(id, key)]}>
    <Routes><Route path="/feedback/receipt/:ticketId" element={<FeedbackReceiptPage />} /></Routes>
  </MemoryRouter>);
  const user = userEvent.setup();
  await user.click(await screen.findByText("查看我的意见"));
  expect(screen.getByText(receipt.description)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "刷新进度" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("未找到回执");
  await waitFor(() => expect(screen.queryByText(receipt.description)).not.toBeInTheDocument());
});
