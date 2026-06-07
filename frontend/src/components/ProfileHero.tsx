import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, Check, LogOut, Pencil, X } from "lucide-react";
import { Buddy } from "./Buddy";
import { ProgressBar } from "./ui/ProgressBar";
import { AuthModal } from "./AuthModal";
import { useAuth } from "../store/auth";
import { fileToAvatarDataUrl } from "../lib/image";

/**
 * The "我的小屋" identity card with the account woven in:
 * - logged out: Pip + a login/register entry
 * - logged in: your avatar (tap to upload), an editable name shown as
 *   「{名字}的小屋」, the email, and a logout action — all in one hero.
 */
export function ProfileHero({ level, xp, xpNext }: { level: number; xp: number; xpNext: number }) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const refresh = useAuth((s) => s.refresh);
  const updateProfile = useAuth((s) => s.updateProfile);

  const [authOpen, setAuthOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Validate the persisted token once when the profile opens (clears it if stale).
  useEffect(() => {
    if (user) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const name = user?.display_name?.trim() ?? "";
  const title = name ? `${name}的小屋` : "我的小屋";

  async function onPickAvatar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the user re-pick the same file later
    if (!file) return;
    setBusy(true);
    try {
      await updateProfile({ avatar_url: await fileToAvatarDataUrl(file) });
    } catch {
      /* ignore — keep the old avatar on failure */
    } finally {
      setBusy(false);
    }
  }

  async function saveName() {
    const v = nameDraft.trim();
    setEditing(false);
    if (!v || v === name) return;
    try {
      await updateProfile({ display_name: v });
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="card flex flex-col items-center gap-3 p-6 text-center">
      <div className="relative">
        {user ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            aria-label="更换头像"
            className="relative block rounded-full transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt="头像"
                className="h-28 w-28 rounded-full object-cover shadow-soft"
              />
            ) : (
              <Buddy mood="happy" size={120} />
            )}
            <span className="absolute bottom-0 right-0 grid h-9 w-9 place-items-center rounded-full bg-coral text-primary-fg shadow-pop">
              <Camera className="h-4 w-4" />
            </span>
          </button>
        ) : (
          <Buddy mood="happy" size={120} />
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickAvatar} />
      </div>

      <div className="w-full">
        {editing ? (
          <div className="mx-auto flex max-w-xs items-center justify-center gap-2">
            <input
              autoFocus
              value={nameDraft}
              maxLength={40}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveName();
                if (e.key === "Escape") setEditing(false);
              }}
              placeholder="取个名字"
              className="w-full rounded-full border border-border bg-surface-2 px-4 py-1.5 text-center font-display text-lg font-semibold text-ink outline-none focus:border-coral"
            />
            <button
              type="button"
              onClick={() => void saveName()}
              aria-label="保存"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-coral text-primary-fg"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              aria-label="取消"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1.5">
            <h1 className="font-display text-2xl font-semibold text-ink">{title}</h1>
            {user && (
              <button
                type="button"
                onClick={() => {
                  setNameDraft(name);
                  setEditing(true);
                }}
                aria-label="改名"
                className="text-muted transition-colors hover:text-coral-deep"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        <p className="mt-0.5 text-sm text-muted">Lv.{level} · 和 Pip 一起成长</p>

        {user ? (
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 text-xs text-muted">
            <span className="max-w-[12rem] truncate">{user.email}</span>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-1 font-semibold transition-colors hover:text-coral-deep"
            >
              <LogOut className="h-3.5 w-3.5" /> 退出登录
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-dashed border-coral/60 bg-coral/5 px-4 py-1.5 text-sm font-bold text-coral-deep transition-transform hover:-translate-y-0.5 active:translate-y-0"
          >
            登录 / 注册 · 跨设备续进度
          </button>
        )}
      </div>

      <div className="w-full max-w-xs">
        <div className="mb-1 flex justify-between text-xs font-semibold text-muted">
          <span>Lv.{level}</span>
          <span className="tabnum">
            {xp} / {xpNext} XP
          </span>
        </div>
        <ProgressBar value={(xp / xpNext) * 100} color="var(--tangerine)" />
      </div>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </section>
  );
}
