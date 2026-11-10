import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AccountSettings from "./AccountSettings";
import { useAuth } from "../store/auth";

const originalLogout = useAuth.getState().logout;
const user = { id: 7, email: "learner@example.test", display_name: "Learner", avatar_url: "", created_at: "" };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useAuth.setState({ user: null, logout: originalLogout }); });

it("requires a separate password confirmation before deleting and signs out after 204", async () => {
  const logout = vi.fn();
  useAuth.setState({ user, logout });
  const fetcher = vi.fn(async (url: string) => url.includes("/account-capabilities")
    ? Response.json({ account_data: true, email_actions: false })
    : new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  render(<AccountSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "删除账号" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("发送验证邮件")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "fixture-password" } });
  fireEvent.click(screen.getByRole("button", { name: "确认永久删除" }));
  await waitFor(() => expect(logout).toHaveBeenCalledOnce());
  expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining("/api/auth/me"), expect.objectContaining({
    method: "DELETE", body: JSON.stringify({ password: "fixture-password" }),
  }));
});
