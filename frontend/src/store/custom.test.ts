import { afterEach, expect, it } from "vitest";
import { clearToken, setToken } from "../lib/authToken";
import type { CustomScene } from "../lib/api";
import { useCustomScene } from "./custom";

const draft: CustomScene = {
  title: "Venue", title_zh: "只属于甲的场景", goal: "Confirm the reservation.",
  partner_role: "Host", persona: "You are the host.", opening_line: "May I have the booking name?",
};

const token = (sub: string, ver: string) => "test." + btoa(JSON.stringify({ sub, ver })) + ".signature";

afterEach(() => {
  useCustomScene.getState().clear();
  clearToken();
  localStorage.clear();
});

it("shows an active manual scene only to its owner even when identity changes in the same browser", () => {
  setToken(token("71", "first"));
  useCustomScene.getState().setScene(draft);
  expect(useCustomScene.getState().scene).toEqual(draft);

  setToken(token("72", "second"));
  expect(useCustomScene.getState().scene).toBeNull();
  const other = { ...draft, title_zh: "乙的场景" };
  useCustomScene.getState().setScene(other);

  setToken(token("71", "first"));
  expect(useCustomScene.getState().scene).toEqual(draft);
  setToken(token("71", "different-account-version"));
  expect(useCustomScene.getState().scene).toBeNull();
  clearToken();
  expect(useCustomScene.getState().scene).toBeNull();
});
