import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserGuestHistory } from "./BrowserGuestHistory";
import { getClientId, rotateClientId } from "../lib/clientId";
import { clearToken, setToken } from "../lib/authToken";

afterEach(() => {
  cleanup();
  clearToken();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("reads an earlier visitor's records without using the signed-in account credential", async () => {
  localStorage.setItem("spoken-client-id", "previous-visitor");
  expect(getClientId()).toBe("previous-visitor");
  const next = rotateClientId();
  setToken("signed-in-account");
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const word = headers.get("X-Client-Id") === "previous-visitor"
      ? [{ id: 9, text: "visitor's phrase", meaning: "释义" }]
      : [];
    return Response.json(path.endsWith("/words") ? word : []);
  });
  vi.stubGlobal("fetch", fetcher);

  render(<BrowserGuestHistory />);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查看本浏览器的游客记录" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(screen.queryByText("visitor's phrase")).toBeNull();

  fireEvent.change(screen.getByLabelText("游客记录来源"), { target: { value: "1" } });
  expect(await screen.findByText(/visitor's phrase/)).toBeTruthy();
  expect(getClientId()).toBe(next);
  expect(fetcher).toHaveBeenCalledTimes(6);
  for (const [, init] of fetcher.mock.calls) {
    expect(new Headers(init?.headers).get("Authorization")).toBeNull();
    expect(init?.credentials).toBe("omit");
  }
});
