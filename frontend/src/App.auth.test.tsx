import { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
vi.mock("./pages/Home", () => ({ default: function Home() {
  useEffect(() => { lifecycle.mounts++; return () => { lifecycle.unmounts++; }; }, []);
  return <div>Owner home</div>;
} }));
vi.mock("./components/dictionary/DictionaryProvider", () => ({ DictionaryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("./components/SiteVisitTracker", () => ({ SiteVisitTracker: () => null }));
vi.mock("./components/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("./components/Onboarding", () => ({ Onboarding: () => null }));
import App from "./App";
import { useAuth } from "./store/auth";
import { clearToken, setToken } from "./lib/authToken";
beforeEach(() => {
  clearToken(); useAuth.setState({ user: null, resolving: false, resolutionError: false });
  lifecycle.mounts = 0; lifecycle.unmounts = 0;
});
const mount = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App /></MemoryRouter>);
it("opens guests immediately and gates owner routes during account resolution", async () => {
  mount(); await screen.findByText("Owner home");
  act(() => { setToken("unresolved"); });
  expect(screen.queryByText("Owner home")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("正在确认账户");
  expect(lifecycle.unmounts).toBe(1);
});
it("remounts owner routes even when a replacement credential resolves to the same account in one batch", async () => {
  setToken("first"); useAuth.setState({ user: { id: 1, email: "test@example.test", display_name: "", avatar_url: "", created_at: "" }, resolving: false });
  mount(); await screen.findByText("Owner home");
  act(() => {
    setToken("replacement");
    useAuth.setState({ user: { id: 1, email: "test@example.test", display_name: "", avatar_url: "", created_at: "" }, resolving: false });
  });
  await screen.findByText("Owner home");
  expect(lifecycle.mounts).toBe(2); expect(lifecycle.unmounts).toBe(1);
});
it("keeps unresolved account failures gated with explicit retry and logout controls", () => {
  setToken("offline"); useAuth.setState({ resolving: false, resolutionError: true });
  mount();
  expect(screen.queryByText("Owner home")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重试" })).toBeVisible();
  expect(screen.getByRole("button", { name: "退出账户" })).toBeVisible();
});
