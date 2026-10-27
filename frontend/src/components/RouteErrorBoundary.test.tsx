import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

it("offers a full reload of the same route when a deployed page chunk is unavailable", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  window.history.replaceState(null, "", "/words?due=1#review");
  function UnavailablePage(): never { throw new TypeError("Failed to fetch dynamically imported module"); }
  render(<RouteErrorBoundary><UnavailablePage /></RouteErrorBoundary>);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "重新加载页面" })).toHaveAttribute("href", "/words?due=1#review");
  expect(screen.getByRole("link", { name: "返回首页" })).toHaveAttribute("href", "/");
});

it("renders normal content without changing it", () => {
  render(<RouteErrorBoundary><p>练习内容</p></RouteErrorBoundary>);
  expect(screen.getByText("练习内容")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
