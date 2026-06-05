import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Mic, Send, Square, Volume2, VolumeX } from "lucide-react";
import { getScenario } from "../data/scenarios";
import { themeFor, type ScenarioTheme } from "../lib/theme";
import { postChat, fetchTtsUrl, postAsr, type ChatMessage } from "../lib/api";
import { useSession } from "../store/session";
import { startRecording, type ActiveRecorder } from "../lib/recorder";
import { Buddy, type BuddyMood } from "../components/Buddy";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { cn } from "../lib/utils";

const localOpeners: Record<string, string> = {
  interview: "Hi, thanks for coming in! Could you tell me a little about yourself?",
  cafe: "Hi there, welcome in! What can I get started for you today?",
  standup: "Morning! What did you work on yesterday?",
  airport: "Good morning! May I see your passport, please?",
  doctor: "Hello, come on in and take a seat. So, what brings you in today?",
  party: "Hey! I don't think we've met yet — how do you know everyone here?",
};

export default function Conversation() {
  const { scenarioId } = useParams();
  const scenario = scenarioId ? getScenario(scenarioId) : undefined;
  const id = scenario?.id ?? "";
  const t = themeFor(id);
  const fallbackOpener = (id && localOpeners[id]) || "Hi! Whenever you're ready, just type below.";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false); // awaiting Pip's reply
  const [booting, setBooting] = useState(true); // fetching the opener
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const lastSpokenRef = useRef(-1);
  const recorderRef = useRef<ActiveRecorder | null>(null);
  const navigate = useNavigate();
  const setSession = useSession((s) => s.setSession);
  const hasUserTurn = messages.some((m) => m.role === "user");

  function finish() {
    if (!id) return;
    setSession(id, messages);
    navigate(`/report/${id}`);
  }

  // Fetch the scene opener once.
  useEffect(() => {
    const ctrl = new AbortController();
    setBooting(true);
    setError(null);
    if (!id) {
      setMessages([{ role: "assistant", content: fallbackOpener }]);
      setBooting(false);
      return;
    }
    postChat(id, [], ctrl.signal)
      .then((r) => setMessages([{ role: "assistant", content: r.reply }]))
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setMessages([{ role: "assistant", content: fallbackOpener }]);
        setError("后端未连接，先看看界面。启动后端后刷新即可与 Pip 对话。");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setBooting(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Keep the latest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Speak Pip's newest line (best-effort; browsers may block autoplay until a gesture).
  useEffect(() => {
    const idx = messages.length - 1;
    if (idx < 0 || messages[idx].role !== "assistant" || idx <= lastSpokenRef.current) {
      return;
    }
    lastSpokenRef.current = idx;
    if (!muted) void speak(messages[idx].content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, muted]);

  // Stop audio / recording + free the blob URL on unmount.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      recorderRef.current?.stop().catch(() => undefined);
    };
  }, []);

  async function speak(text: string) {
    try {
      const url = await fetchTtsUrl(text);
      let audio = audioRef.current;
      if (!audio) {
        audio = new Audio();
        audioRef.current = audio;
      }
      audio.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = url;
      audio.src = url;
      await audio.play();
    } catch {
      /* autoplay blocked or TTS unavailable — ignore */
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading || booting || !id) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setError(null);
    setLoading(true);
    try {
      const r = await postChat(id, next);
      setMessages((m) => [...m, { role: "assistant", content: r.reply }]);
    } catch {
      setError("发送失败，请确认后端在运行后重试。");
    } finally {
      setLoading(false);
    }
  }

  async function handleMic() {
    if (transcribing || booting) return;
    if (recording) {
      setRecording(false);
      const rec = recorderRef.current;
      recorderRef.current = null;
      if (!rec) return;
      setTranscribing(true);
      setError(null);
      try {
        const text = (await postAsr(await rec.stop())).trim();
        if (text) setInput((prev) => (prev ? `${prev} ${text}` : text));
        else setError("没听清，再说一次试试？");
      } catch {
        setError("语音识别失败，请检查麦克风权限或后端，或直接打字。");
      } finally {
        setTranscribing(false);
      }
    } else {
      setError(null);
      try {
        recorderRef.current = await startRecording();
        setRecording(true);
      } catch {
        setError("无法使用麦克风，请允许权限后重试，或直接打字。");
      }
    }
  }

  const mood: BuddyMood = loading ? "talking" : booting ? "idle" : "listening";
  const status = loading
    ? "Pip 正在想怎么回答…"
    : booting
      ? "正在连接 Pip…"
      : "Pip 在听你说，打字告诉它吧";

  return (
    <div className="flex h-screen flex-col">
      <PlayfulBackground />

      <header className="mx-auto flex w-full max-w-2xl shrink-0 items-center justify-between gap-3 px-5 pt-6">
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5"
          >
            <ArrowLeft className="h-4 w-4" /> 返回
          </Link>
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "开启朗读" : "关闭朗读"}
            title={muted ? "开启朗读" : "关闭朗读"}
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface text-ink shadow-soft transition-transform hover:-translate-y-0.5"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="truncate rounded-full px-4 py-2 text-sm font-bold shadow-soft"
            style={{ background: t.soft, color: t.deep }}
          >
            {scenario ? `${scenario.titleZh} · ${scenario.title}` : "Practice"}
          </span>
          {hasUserTurn && (
            <button
              type="button"
              onClick={finish}
              className="shrink-0 rounded-full bg-coral px-4 py-2 text-sm font-bold text-primary-fg shadow-pop transition-transform active:translate-y-0.5"
            >
              看小结
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto mt-3 flex w-full max-w-2xl shrink-0 flex-col items-center px-5 text-center">
        <Buddy mood={mood} size={112} color={t.base} />
        <p className="mt-1 font-display text-base font-semibold text-ink">{status}</p>
      </div>

      <main className="mx-auto w-full min-h-0 max-w-2xl flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages.map((m, i) => (
          <Bubble
            key={i}
            role={m.role}
            text={m.content}
            theme={t}
            onSpeak={m.role === "assistant" ? () => speak(m.content) : undefined}
          />
        ))}
        {loading && <TypingBubble theme={t} />}
        {error && (
          <p className="mx-auto w-fit rounded-full bg-[#ffe8e3] px-4 py-2 text-center text-xs font-semibold text-[#e6503d]">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </main>

      <footer className="mx-auto w-full max-w-2xl shrink-0 px-5 pb-6 pt-2">
        <div className="flex items-center gap-2 rounded-full border border-border bg-surface p-2 shadow-pop">
          <button
            type="button"
            onClick={handleMic}
            disabled={transcribing || booting}
            aria-label={recording ? "结束录音" : "开始录音"}
            title={recording ? "结束录音" : "用英文说"}
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center rounded-full text-white shadow-soft transition-transform active:scale-95 disabled:opacity-50",
              recording && "animate-pulse",
            )}
            style={{ background: recording ? "var(--danger)" : t.base }}
          >
            {transcribing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : recording ? (
              <Square className="h-4 w-4" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            placeholder={
              recording
                ? "正在聆听…点停止结束"
                : transcribing
                  ? "识别中…"
                  : booting
                    ? "正在连接…"
                    : "用英文打字回复 Pip…"
            }
            disabled={booting || recording || transcribing}
            className="min-w-0 flex-1 bg-transparent px-2 text-ink outline-none placeholder:text-muted"
          />
          <button
            type="button"
            onClick={send}
            disabled={loading || booting || recording || transcribing || !input.trim()}
            aria-label="发送"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white shadow-soft transition-transform active:scale-95 disabled:opacity-40"
            style={{ background: t.base }}
          >
            <Send className="h-5 w-5" strokeWidth={2.4} />
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-muted">点麦克风用英文说，或直接打字（麦克风为测试版）</p>
      </footer>
    </div>
  );
}

function Bubble({
  role,
  text,
  theme,
  onSpeak,
}: {
  role: "user" | "assistant";
  text: string;
  theme: ScenarioTheme;
  onSpeak?: () => void;
}) {
  const isPip = role === "assistant";
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
        <p className="mt-0.5 leading-snug">{text}</p>
        {isPip && onSpeak && (
          <button
            type="button"
            onClick={onSpeak}
            aria-label="朗读"
            className="mt-1.5 inline-flex items-center gap-1 text-[0.66rem] font-bold uppercase tracking-wide opacity-60 transition-opacity hover:opacity-100"
          >
            <Volume2 className="h-3.5 w-3.5" /> 朗读
          </button>
        )}
      </div>
    </div>
  );
}

function TypingBubble({ theme }: { theme: ScenarioTheme }) {
  return (
    <div className="flex justify-start">
      <div
        className="flex items-center gap-1.5 rounded-3xl rounded-tl-md px-5 py-4 shadow-soft"
        style={{ background: theme.soft }}
      >
        {["0s", "0.15s", "0.3s"].map((d) => (
          <span
            key={d}
            className="h-2 w-2 animate-bob rounded-full"
            style={{ background: "var(--muted)", animationDuration: "0.9s", animationDelay: d }}
          />
        ))}
      </div>
    </div>
  );
}
