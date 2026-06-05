import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Mic } from "lucide-react";
import { getScenario } from "../data/scenarios";
import { themeFor, type ScenarioTheme } from "../lib/theme";
import { Buddy } from "../components/Buddy";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { cn } from "../lib/utils";

const openers: Record<string, string> = {
  interview: "Hi, thanks for coming in! Could you tell me a little about yourself?",
  cafe: "Hi there, welcome in! What can I get started for you today?",
  standup: "Morning! What did you work on yesterday?",
  airport: "Good morning! May I see your passport, please?",
  doctor: "Hello, come on in and take a seat. So, what brings you in today?",
  party: "Hey! I don't think we've met yet — how do you know everyone here?",
};

interface Turn {
  who: "pip" | "you";
  text: string;
}

export default function Conversation() {
  const { scenarioId } = useParams();
  const scenario = scenarioId ? getScenario(scenarioId) : undefined;
  const t = themeFor(scenario?.id ?? "");
  const opener = (scenario && openers[scenario.id]) || "Hi! Tap the mic whenever you're ready.";

  const turns: Turn[] = [
    { who: "pip", text: opener },
    { who: "you", text: "Hi! Sure, let's do it." },
    { who: "pip", text: "Awesome — take your time, I'm listening." },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <PlayfulBackground />

      <header className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-5 pt-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5"
        >
          <ArrowLeft className="h-4 w-4" /> 结束
        </Link>
        <span
          className="truncate rounded-full px-4 py-2 text-sm font-bold shadow-soft"
          style={{ background: t.soft, color: t.deep }}
        >
          {scenario ? `${scenario.titleZh} · ${scenario.title}` : "Practice"}
        </span>
      </header>

      <div className="mx-auto mt-4 flex w-full max-w-2xl flex-col items-center px-5 text-center">
        <Buddy mood="listening" size={132} color={t.base} />
        <p className="mt-2 font-display text-lg font-semibold text-ink">Pip 在听你说…</p>
        <p className="text-sm text-muted">Pip is listening — just start talking</p>
      </div>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-3 px-5 py-6">
        {turns.map((turn, i) => (
          <Bubble key={i} turn={turn} theme={t} />
        ))}
      </main>

      <footer className="sticky bottom-0 mx-auto flex w-full max-w-2xl flex-col items-center gap-2 px-5 pb-8 pt-2">
        <button
          type="button"
          className="relative grid h-20 w-20 place-items-center rounded-full text-white shadow-pop transition-transform active:scale-95"
          style={{ background: t.base }}
          aria-label="按住说话"
        >
          <span
            className="absolute h-full w-full animate-pulsering rounded-full"
            style={{ background: t.base, opacity: 0.3 }}
          />
          <Mic className="relative h-8 w-8" strokeWidth={2.4} />
        </button>
        <p className="text-sm font-semibold text-ink">按住说话 · Hold to speak</p>
        <p className="text-xs text-muted">语音功能开发中，先感受一下界面 · Voice coming soon</p>
      </footer>
    </div>
  );
}

function Bubble({ turn, theme }: { turn: Turn; theme: ScenarioTheme }) {
  const isPip = turn.who === "pip";
  return (
    <div className={cn("flex", isPip ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[80%] rounded-3xl px-4 py-3 shadow-soft",
          isPip ? "rounded-tl-md" : "rounded-tr-md",
        )}
        style={
          isPip
            ? { background: theme.soft, color: "#43302b" }
            : { background: "var(--coral)", color: "var(--coral-fg)" }
        }
      >
        <p className="text-[0.66rem] font-bold uppercase tracking-wide opacity-70">
          {isPip ? "Pip" : "You"}
        </p>
        <p className="mt-0.5 leading-snug">{turn.text}</p>
      </div>
    </div>
  );
}
