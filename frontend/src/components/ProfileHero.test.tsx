import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fileToAvatarDataUrl: vi.fn(), getMe: vi.fn(), updateProfile: vi.fn() }));
vi.mock("../lib/api", async (load) => ({ ...(await load<object>()), getMe: mocks.getMe, updateProfile: mocks.updateProfile }));
vi.mock("../lib/image", () => ({ fileToAvatarDataUrl: mocks.fileToAvatarDataUrl }));
vi.mock("./Buddy", () => ({ Buddy: () => null }));
vi.mock("./AuthModal", () => ({ AuthModal: () => null }));
import { ProfileHero } from "./ProfileHero";
import { setToken } from "../lib/authToken";
import { useAuth } from "../store/auth";
const account = { id: 1, email: "test@example.test", display_name: "Test", avatar_url: "", created_at: "" };
beforeEach(() => {
  vi.resetAllMocks(); setToken("avatar-a"); useAuth.setState({ user: account, resolving: false });
  mocks.getMe.mockResolvedValue(account); mocks.updateProfile.mockResolvedValue(account);
});
it("does not patch a new account when an old avatar conversion finishes", async () => {
  let resolve!: (value: string) => void;
  mocks.fileToAvatarDataUrl.mockReturnValue(new Promise(r => { resolve = r; }));
  const view = render(<ProfileHero level={1} xp={0} xpNext={100} />);
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["fake"], "avatar.png", { type: "image/png" })] } });
  act(() => { setToken("avatar-b"); });
  await act(async () => { resolve("data:image/png;base64,test"); });
  expect(mocks.updateProfile).not.toHaveBeenCalled();
});
it("still patches the current account after avatar conversion", async () => {
  mocks.fileToAvatarDataUrl.mockResolvedValue("data:image/png;base64,test");
  const view = render(<ProfileHero level={1} xp={0} xpNext={100} />);
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["fake"], "avatar.png", { type: "image/png" })] } });
  await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledWith({ avatar_url: "data:image/png;base64,test" }));
});
