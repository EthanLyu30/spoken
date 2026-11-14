import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Feedback from "./Feedback";
import FeedbackReceiptPage from "./FeedbackReceipt";
import FeedbackEmailConfirm from "./FeedbackEmailConfirm";
import { AdminFeedbackInbox } from "../components/AdminFeedbackInbox";
import { privateReceiptPath, type AdminFeedback, type FeedbackReceipt } from "../lib/productFeedbackApi";

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

function feedbackRoute() {
  render(<MemoryRouter initialEntries={["/feedback"]}>
    <Routes>
      <Route path="/feedback" element={<Feedback />} />
      <Route path="/feedback/receipt/:ticketId" element={<h1>已打开私密回执</h1>} />
    </Routes>
  </MemoryRouter>);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
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
