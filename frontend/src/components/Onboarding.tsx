import { useState } from "react";
import { ArrowRight, MessageCircle, Sparkles, Timer, TrendingUp } from "lucide-react";
import { Buddy, type BuddyMood } from "./Buddy";
import { Button } from "./ui/Button";

const KEY = "spoken-onboarded";

interface Slide {
  mood: BuddyMood;
  icon: typeof MessageCircle;
  title: string;
  body: string;
  tint: string;
}

const SLIDES: Slide[] = [
  {
    mood: "happy",
    icon: Sparkles,
    title: "嗨，我是 Pip！",
    body: "你的 AI 英语口语陪练。挑个真实场景，咱们就能开口聊起来 —— 越练越自然。",
    tint: "#fff0dd",
  },
  {
    mood: "talking",
    icon: MessageCircle,
    title: "选场景，开口说",
    body: "面试、点单、看医生…文字或语音都行。我会扮演角色陪你对话，结束还给你打分和纠错。",
    tint: "#e6f4fc",
  },
  {
    mood: "listening",
    icon: Timer,
    title: "限时问答 + 发音评测",
    body: "仿新托福口语独立题，45 秒作答、按标准打分给范例；跟读还能拿到逐词、逐音素的发音分。",
    tint: "#e2f6ee",
  },
  {
    mood: "cheer",
    icon: TrendingUp,
    title: "把学到的真正用起来",
    body: "金句（带应用场景）、生词本（间隔重复复习）、成长曲线与成就，帮你坚持、看得到进步。",
    tint: "#fce6f2",
  },
];

export function Onboarding() {
  const [open, setOpen] = useState(() => {
    try {
      return !localStorage.getItem(KEY);
    } catch {
      return false;
    }
  });
  const [i, setI] = useState(0);

  if (!open) return null;
  const slide = SLIDES[i];
  const last = i === SLIDES.length - 1;
  const Icon = slide.icon;

  function finish() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/40 p-5 backdrop-blur-sm">
      <div className="card w-full max-w-md p-7 text-center shadow-pop">
        <div className="relative mx-auto grid place-items-center">
          <span
            aria-hidden
            className="absolute h-28 w-28 rounded-full"
            style={{ background: `radial-gradient(circle, ${slide.tint}, transparent 70%)` }}
          />
          <Buddy mood={slide.mood} size={132} />
        </div>
        <span
          className="mx-auto mt-3 grid h-10 w-10 place-items-center rounded-full text-coral-deep"
          style={{ background: slide.tint }}
        >
          <Icon className="h-5 w-5" />
        </span>
        <h2 className="mt-3 font-display text-2xl font-semibold text-ink">{slide.title}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">{slide.body}</p>

        <div className="mt-5 flex justify-center gap-1.5">
          {SLIDES.map((_, idx) => (
            <span
              key={idx}
              className="h-2 rounded-full transition-all"
              style={{
                width: idx === i ? 22 : 8,
                background: idx === i ? "var(--coral)" : "var(--border)",
              }}
            />
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={finish}
            className="text-sm font-semibold text-muted transition-colors hover:text-ink"
          >
            跳过
          </button>
          {last ? (
            <Button onClick={finish}>开始练习 🎉</Button>
          ) : (
            <Button onClick={() => setI((x) => x + 1)}>
              下一步 <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Re-open the onboarding from settings. */
// eslint-disable-next-line react-refresh/only-export-components
export function resetOnboarding() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
