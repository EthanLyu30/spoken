import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Lightbulb,
  Loader2,
  Mic,
  Phone,
  PhoneOff,
  Send,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { getScenario } from "../data/scenarios";
import { scenarioIcons } from "../lib/icons";
import { themeFor, type ScenarioTheme } from "../lib/theme";
import { postChat, fetchTtsUrl, postAsr, postHint, type ChatMessage } from "../lib/api";
import { useSession } from "../store/session";
import { startRecording, type ActiveRecorder } from "../lib/recorder";
import { startVoiceCall, type CallPhase, type VoiceCall } from "../lib/call";
import { Buddy, type BuddyMood } from "../components/Buddy";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { PronounceButton } from "../components/PronounceButton";
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
  const ScenarioIcon = scenario ? scenarioIcons[scenario.icon] : null;
  const fallbackOpener = (id && localOpeners[id]) || "Hi! Whenever you're ready, just say hello.";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false); // awaiting Pip's reply (text)
  const [booting, setBooting] = useState(true); // fetching the opener
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [callPhase, setCallPhase] = useState<CallPhase | null>(null);
  const [hints, setHints] = useState<string[] | null>(null);
  const [hintLoading, setHintLoading] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const lastSpokenRef = useRef(-1);
  const recorderRef = useRef<ActiveRecorder | null>(null);
  const callRef = useRef<VoiceCall | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);

  const navigate = useNavigate();
  const setSession = useSession((s) => s.setSession);
  const hasUserTurn = messages.some((m) => m.role === "user");
  const inCall = callPhase !== null;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  function finish() {
    if (!id) return;
    callRef.current?.end();
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
  }, [messages, loading, callPhase]);

  // Auto-speak Pip's newest line. In call mode the call drives speech itself.
  useEffect(() => {
    const idx = messages.length - 1;
    if (idx < 0 || messages[idx].role !== "assistant" || idx <= lastSpokenRef.current) {
      return;
    }
    lastSpokenRef.current = idx;
    if (callPhase) return;
    if (!muted) void playTts(messages[idx].content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, muted, callPhase]);

  // Stop audio / recording / call + free the blob URL on unmount.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      recorderRef.current?.stop().catch(() => undefined);
      callRef.current?.end();
    };
  }, []);

  // Play a line of Pip's speech; resolves when playback finishes.
  function playTts(text: string): Promise<void> {
    return new Promise((resolve) => {
      fetchTtsUrl(text, id)
        .then((url) => {
          let audio = audioRef.current;
          if (!audio) {
            audio = new Audio();
            audioRef.current = audio;
          }
          audio.pause();
          if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = url;
          audio.src = url;
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          void audio.play().catch(() => resolve());
        })
        .catch(() => resolve());
    });
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

  // Push-to-talk: record one clip, transcribe into the input box.
  async function handleMic() {
    if (transcribing || booting || inCall) return;
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

  // Hands-free call mode: listen -> ASR -> reply -> speak -> repeat.
  async function startCall() {
    if (!id || booting || inCall) return;
    setError(null);
    try {
      callRef.current = await startVoiceCall({
        onPhase: (p) => setCallPhase(p),
        transcribe: (pcm) => postAsr(pcm),
        respond: async (userText) => {
          const next: ChatMessage[] = [
            ...messagesRef.current,
            { role: "user", content: userText },
          ];
          setMessages(next);
          const r = await postChat(id, next);
          setMessages((m) => [...m, { role: "assistant", content: r.reply }]);
          return r.reply;
        },
        speak: (text) => playTts(text),
        onError: (msg) => setError(msg),
      });
      setCallPhase("listening");
    } catch {
      setError("无法开始通话，请允许麦克风权限，或用打字 / 按住说话。");
    }
  }

  function endCall() {
    callRef.current?.end();
    callRef.current = null;
    setCallPhase(null);
    audioRef.current?.pause();
  }

  async function getHints() {
    if (!id || hintLoading || booting) return;
    setHintLoading(true);
    setError(null);
    try {
      const s = await postHint(id, messages);
      setHints(s.length ? s : ["试着先打个招呼或回应上一句～"]);
    } catch {
      setError("获取提示失败，请稍后再试。");
    } finally {
      setHintLoading(false);
    }
  }

  const stageMood: BuddyMood =
    callPhase === "speaking"
      ? "talking"
      : callPhase === "thinking"
        ? "idle"
        : callPhase === "listening"
          ? "listening"
          : loading
            ? "talking"
            : booting
              ? "idle"
              : "listening";

  const stageStatus =
    callPhase === "speaking"
      ? "Pip 在说…"
      : callPhase === "thinking"
        ? "Pip 正在想…"
        : callPhase === "listening"
          ? "在听你说…（说完停顿一下我就接话）"
          : loading
            ? "Pip 正在想怎么回答…"
            : booting
              ? "正在连接 Pip…"
              : "和 Pip 聊聊吧 — 打字、按住说话，或开始通话";

  return (
    <div className="flex h-screen flex-col">
      <PlayfulBackground accent={t.base} />
      {ScenarioIcon && (
        <ScenarioIcon
          aria-hidden
          className="pointer-events-none fixed -right-10 top-20 -z-10 h-80 w-80 opacity-[0.05]"
          style={{ color: t.base }}
          strokeWidth={1.25}
        />
      )}

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
        <div className="relative">
          <Buddy mood={stageMood} size={callPhase ? 124 : 112} color={t.base} />
          {ScenarioIcon && (
            <span
              className="absolute bottom-1 right-1 grid h-9 w-9 place-items-center rounded-full border-2 border-bg shadow-soft"
              style={{ background: t.soft, color: t.deep }}
            >
              <ScenarioIcon className="h-5 w-5" strokeWidth={2.4} />
            </span>
          )}
        </div>
        <p className="mt-1 font-display text-base font-semibold text-ink">{stageStatus}</p>
      </div>

      <main className="mx-auto w-full min-h-0 max-w-2xl flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages.map((m, i) => (
          <Bubble
            key={i}
            role={m.role}
            text={m.content}
            theme={t}
            onSpeak={m.role === "assistant" ? () => void playTts(m.content) : undefined}
          />
        ))}
        {(loading || callPhase === "thinking") && <TypingBubble theme={t} />}
        {error && (
          <p className="mx-auto w-fit rounded-full bg-[#ffe8e3] px-4 py-2 text-center text-xs font-semibold text-[#e6503d]">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </main>

      <footer className="mx-auto w-full max-w-2xl shrink-0 px-5 pb-6 pt-2">
        {inCall ? (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={endCall}
              className="inline-flex items-center gap-2 rounded-full px-6 py-3 font-display font-bold text-white shadow-pop transition-transform active:translate-y-0.5"
              style={{ background: "var(--danger)" }}
            >
              <PhoneOff className="h-5 w-5" /> 结束通话
            </button>
            <p className="text-xs text-muted">
              {callPhase === "listening"
                ? "开口说英文，说完停顿一下我就接话"
                : callPhase === "thinking"
                  ? "Pip 正在思考…"
                  : "Pip 正在说…"}
            </p>
          </div>
        ) : (
          <>
            {hints && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[0.66rem] font-bold uppercase tracking-wide text-muted">提示</span>
                {hints.map((h, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setInput(h);
                      setHints(null);
                    }}
                    className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5"
                  >
                    {h}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setHints(null)}
                  aria-label="关闭提示"
                  className="grid h-6 w-6 place-items-center rounded-full text-muted hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2 rounded-full border border-border bg-surface p-2 shadow-pop">
              <button
                type="button"
                onClick={handleMic}
                disabled={transcribing || booting}
                aria-label={recording ? "结束录音" : "开始录音"}
                title={recording ? "结束录音" : "按一下说，再按结束"}
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
            <div className="mt-2 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={startCall}
                disabled={booting}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold text-white shadow-soft transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                style={{ background: t.base }}
              >
                <Phone className="h-3.5 w-3.5" /> 通话模式
              </button>
              <button
                type="button"
                onClick={getHints}
                disabled={booting || hintLoading}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-bold text-ink shadow-soft transition-transform hover:-translate-y-0.5 disabled:opacity-50"
              >
                {hintLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Lightbulb className="h-3.5 w-3.5" />
                )}
                提示
              </button>
            </div>
          </>
        )}
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
        {isPip && (
          <div className="mt-1.5 flex flex-col gap-1">
            {onSpeak && (
              <button
                type="button"
                onClick={onSpeak}
                aria-label="朗读"
                className="inline-flex w-fit items-center gap-1 text-[0.66rem] font-bold uppercase tracking-wide opacity-60 transition-opacity hover:opacity-100"
              >
                <Volume2 className="h-3.5 w-3.5" /> 朗读
              </button>
            )}
            <PronounceButton text={text} />
          </div>
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
