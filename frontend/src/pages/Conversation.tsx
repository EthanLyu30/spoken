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
  Settings2,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { getScenario } from "../data/scenarios";
import { scenarioIcons } from "../lib/icons";
import { themeFor, type ScenarioTheme } from "../lib/theme";
import {
  postChat,
  postHint,
  postFeedback,
  streamChat,
  type ChatMessage,
} from "../lib/api";
import {
  appendUserTurn,
  previousPartnerMessage,
  type UserTurnMeta,
  type UserTurnMetaMap,
} from "../lib/conversationTurns";
import { createPracticeId, persistSessionOnce } from "../lib/sessionSave";
import { getAuthGeneration } from "../lib/authToken";
import {
  speakText,
  createSpeechQueue,
  type Speaking,
  type SpeechQueue,
} from "../lib/speech";
import { useSession } from "../store/session";
import { useCustomScene } from "../store/custom";
import { useVoice, type VoiceEngine } from "../store/voice";
import { SpeechPlaybackStatus } from "../components/SpeechPlaybackStatus";
import { startRecording, type ActiveRecorder } from "../lib/recorder";
import { startVoiceCall, type CallPhase, type VoiceCall } from "../lib/call";
import { getInteraction } from "../lib/telemetry";
import {
  isMoonshineTranscriptionReady,
  transcribeSpeech,
} from "../lib/transcribe";
import { Buddy, type BuddyMood } from "../components/Buddy";
import { ChatBubble } from "../components/ChatBubble";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { Wordmark } from "../components/Wordmark";
import { cn } from "../lib/utils";

const localOpeners: Record<string, string> = {
  interview:
    "Hi, thanks for coming in! Could you tell me a little about yourself?",
  cafe: "Hi there, welcome in! What can I get started for you today?",
  standup: "Morning! What did you work on yesterday?",
  airport: "Good morning! May I see your passport, please?",
  doctor: "Hello, come on in and take a seat. So, what brings you in today?",
  party: "Hey! I don't think we've met yet — how do you know everyone here?",
};

export default function Conversation() {
  const generation = useRef(getAuthGeneration()).current;
  const { scenarioId } = useParams();
  const isCustom = scenarioId === "custom";
  const customScene = useCustomScene((s) => s.scene);
  const scenario =
    scenarioId && !isCustom ? getScenario(scenarioId) : undefined;
  const id = isCustom ? "custom" : (scenario?.id ?? "");
  const t = {
    ...themeFor(id),
    base: "#ff6251",
    soft: "#fcf4eb",
    deep: "#dc493b",
  };
  const ScenarioIcon = scenario
    ? scenarioIcons[scenario.icon]
    : isCustom
      ? Sparkles
      : null;
  const fallbackOpener =
    (isCustom ? customScene?.opening_line : id ? localOpeners[id] : "") ||
    "Hi! Whenever you're ready, just say hello.";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [turnMeta, setTurnMeta] = useState<UserTurnMetaMap>({});
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false); // awaiting Pip's reply (text)
  const [streaming, setStreaming] = useState(false); // reply is streaming in
  const [booting, setBooting] = useState(true); // fetching the opener
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [callPhase, setCallPhase] = useState<CallPhase | null>(null);
  const [liveCaption, setLiveCaption] = useState(""); // streaming ASR preview while speaking
  const [hints, setHints] = useState<string[] | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [callStarting, setCallStarting] = useState(false);
  const [inputMode, setInputMode] = useState<"voice" | "text">("voice");
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const voiceEngine = useVoice((state) => state.engine);
  const setVoiceEngine = useVoice((state) => state.setEngine);

  const endRef = useRef<HTMLDivElement>(null);
  const speakingRef = useRef<Speaking | null>(null);
  const callQueueRef = useRef<SpeechQueue | null>(null);
  const lastSpokenRef = useRef(-1);
  const autoSpeakAllowedRef = useRef(true);
  const recorderRef = useRef<ActiveRecorder | null>(null);
  const callRef = useRef<VoiceCall | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const turnMetaRef = useRef<UserTurnMetaMap>(turnMeta);
  const goingToReportRef = useRef(false); // true when leaving via 看小结 (report saves)
  const practiceIdRef = useRef(createPracticeId());
  const requestControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const callAttemptRef = useRef(0);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const navigate = useNavigate();
  const setSession = useSession((s) => s.setSession);
  const hasUserTurn = messages.some((m) => m.role === "user");
  const inCall = callPhase !== null;
  const isCurrent = () => mountedRef.current && generation === getAuthGeneration();

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    turnMetaRef.current = turnMeta;
  }, [turnMeta]);

  function finish() {
    if (!id || generation !== getAuthGeneration()) return;
    goingToReportRef.current = true; // the report page will save this session
    callRef.current?.end();
    requestControllerRef.current?.abort();
    callQueueRef.current?.stop();
    speakingRef.current?.stop();
    setSession(id, messages, practiceIdRef.current);
    navigate(`/report/${id}`);
  }

  // Fetch the scene opener once.
  useEffect(() => {
    setBooting(true);
    setError(null);
    setTurnMeta({});
    turnMetaRef.current = {};
    // Custom scenes carry their opener with them — no catalogue / model call.
    if (isCustom) {
      if (!customScene) {
        navigate("/custom", { replace: true });
        return;
      }
      setMessages([{ role: "assistant", content: customScene.opening_line }]);
      setBooting(false);
      return;
    }
    const ctrl = new AbortController();
    if (!id) {
      setMessages([{ role: "assistant", content: fallbackOpener }]);
      setBooting(false);
      return;
    }
    postChat(id, [], ctrl.signal)
      .then((r) => { if (isCurrent() && !ctrl.signal.aborted) setMessages([{ role: "assistant", content: r.reply }]); })
      .catch(() => {
        if (ctrl.signal.aborted || !isCurrent()) return;
        setMessages([{ role: "assistant", content: fallbackOpener }]);
        setError("后端未连接，先看看界面。启动后端后刷新即可与 Pip 对话。");
      })
      .finally(() => {
        if (!ctrl.signal.aborted && isCurrent()) setBooting(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Keep the latest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, callPhase]);

  // Auto-speak Pip's newest line once it's complete. In call mode the call
  // drives speech itself; while a reply is streaming we wait for the full text.
  useEffect(() => {
    const idx = messages.length - 1;
    if (
      idx < 0 ||
      messages[idx].role !== "assistant" ||
      idx <= lastSpokenRef.current
    ) {
      return;
    }
    if (!messages[idx].content || streaming || !autoSpeakAllowedRef.current)
      return;
    lastSpokenRef.current = idx;
    if (callPhase) return;
    if (!muted) void playTts(messages[idx].content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, muted, callPhase, streaming]);

  // Stop audio / recording / call on unmount. If the learner had a real
  // exchange but left without opening the debrief, still save the session in
  // the background so the practice counts.
  useEffect(() => {
    mountedRef.current = true;
    const practiceId = practiceIdRef.current;
    return () => {
      mountedRef.current = false;
      callAttemptRef.current += 1;
      requestControllerRef.current?.abort();
      speakingRef.current?.stop();
      callQueueRef.current?.stop();
      recorderRef.current?.stop().catch(() => undefined);
      callRef.current?.end();
      turnMetaRef.current = {};
      if (!goingToReportRef.current && id && generation === getAuthGeneration()) {
        const msgs = messagesRef.current;
        if (msgs.some((m) => m.role === "user")) {
          const custom = isCustom ? (customScene ?? undefined) : undefined;
          postFeedback(id, msgs, undefined, custom)
            .then((f) => persistSessionOnce(id, msgs, f, practiceId, generation))
            .catch(() => undefined);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Play a line of Pip's speech; resolves when playback finishes.
  function playTts(text: string): Promise<void> {
    if (!isCurrent()) return Promise.resolve();
    speakingRef.current?.stop();
    const s = speakText(text, id);
    speakingRef.current = s;
    return s.done;
  }

  function setLastAssistant(content: string) {
    setMessages((m) => {
      const c = [...m];
      for (let i = c.length - 1; i >= 0; i--) {
        if (c[i].role === "assistant") {
          c[i] = { role: "assistant", content };
          break;
        }
      }
      return c;
    });
  }

  async function send(
    textArg?: string,
    meta: UserTurnMeta = { source: "typed" },
    retry = false,
  ) {
    if (!isCurrent()) return;
    let lastUser = messagesRef.current.length - 1;
    while (lastUser >= 0 && messagesRef.current[lastUser].role !== "user")
      lastUser--;
    const text = (
      retry
        ? (messagesRef.current[lastUser]?.content ?? "")
        : (textArg ?? input)
    ).trim();
    if (
      !text ||
      loading ||
      requestControllerRef.current ||
      booting ||
      !id ||
      inCall
    )
      return;
    const ctrl = new AbortController();
    requestControllerRef.current = ctrl;
    autoSpeakAllowedRef.current = false;
    speakingRef.current?.stop();
    setCanRetry(false);
    const appended = retry
      ? {
          messages: messagesRef.current.slice(0, lastUser + 1),
          meta: turnMetaRef.current,
        }
      : appendUserTurn(messagesRef.current, turnMetaRef.current, text, meta);
    const next = appended.messages;
    messagesRef.current = next;
    turnMetaRef.current = appended.meta;
    setTurnMeta(appended.meta);
    setMessages(next);
    setInput("");
    setError(null);
    setLoading(true);
    const custom = isCustom ? (customScene ?? undefined) : undefined;
    let started = false;
    const onText = (t: string) => {
      if (ctrl.signal.aborted || !isCurrent()) return;
      if (!started) {
        started = true;
        setStreaming(true);
        setMessages((m) => [...m, { role: "assistant", content: t }]);
      } else {
        setLastAssistant(t);
      }
    };
    try {
      // Stream the reply token-by-token for lower perceived latency.
      const full = await streamChat(id, next, onText, ctrl.signal, custom);
      if (ctrl.signal.aborted || !isCurrent()) return;
      autoSpeakAllowedRef.current = true;
      setStreaming(false);
      if (started) setLastAssistant(full);
      else setMessages((m) => [...m, { role: "assistant", content: full }]);
    } catch (err) {
      if (ctrl.signal.aborted || !isCurrent()) return;
      if (started) {
        setStreaming(false);
        setCanRetry(true);
        setError(err instanceof Error ? err.message : "回复中断，请重试。");
        return;
      }
      // Streaming unavailable -> fall back to the plain endpoint.
      try {
        const r = await postChat(id, next, ctrl.signal, custom);
        if (ctrl.signal.aborted || !isCurrent()) return;
        autoSpeakAllowedRef.current = true;
        setStreaming(false);
        if (started) setLastAssistant(r.reply);
        else
          setMessages((m) => [...m, { role: "assistant", content: r.reply }]);
      } catch {
        if (ctrl.signal.aborted || !isCurrent()) return;
        setStreaming(false);
        setCanRetry(true);
        setError("发送失败，请确认后端在运行后重试。");
      }
    } finally {
      if (requestControllerRef.current === ctrl)
        requestControllerRef.current = null;
      if (isCurrent()) setLoading(false);
    }
  }

  // Push-to-talk: record one clip, transcribe into the input box.
  async function handleMic() {
    if (!isCurrent() || transcribing || booting || inCall || loading || callStarting) return;
    if (recording) {
      setRecording(false);
      const rec = recorderRef.current;
      recorderRef.current = null;
      if (!rec) return;
      setTranscribing(true);
      setError(null);
      try {
        const pcm = await rec.stop();
        if (!isCurrent()) return;
        const spokenText = (await transcribeSpeech(pcm)).trim();
        if (!isCurrent()) return;
        if (spokenText) {
          // Speaking app: send the recognized speech right away (combining any
          // already-typed text) instead of making the learner tap send. The box
          // stays for typing / fixing a misheard word. send() clears it.
          const typedPrefix = input.trim();
          const combined = typedPrefix
            ? `${typedPrefix} ${spokenText}`
            : spokenText;
          void send(combined, {
            source: typedPrefix ? "mixed" : "voice",
            spokenText,
            pcm,
          });
        } else {
          setError("没听清，再说一次试试？");
        }
      } catch {
        if (isCurrent()) setError("语音识别失败，请检查麦克风权限或后端，或直接打字。");
      } finally {
        if (isCurrent()) setTranscribing(false);
      }
    } else {
      setError(null);
      try {
        speakingRef.current?.stop();
        recorderRef.current = await startRecording();
        if (!isCurrent()) {
          await recorderRef.current.stop();
          recorderRef.current = null;
          return;
        }
        setRecording(true);
      } catch {
        if (isCurrent()) setError("无法使用麦克风，请允许权限后重试，或直接打字。");
      }
    }
  }

  // Hands-free call mode: listen -> ASR -> reply -> speak -> repeat.
  async function startCall() {
    if (!isCurrent()) return;
    if (
      !id ||
      booting ||
      inCall ||
      callStarting ||
      loading ||
      recording ||
      transcribing
    )
      return;
    const attempt = ++callAttemptRef.current;
    autoSpeakAllowedRef.current = false;
    setCallStarting(true);
    speakingRef.current?.stop();
    setError(null);
    try {
      const call = await startVoiceCall({
        onPhase: (p) => {
          if (!isCurrent() || attempt !== callAttemptRef.current) return;
          setCallPhase(p);
          if (p !== "listening") setLiveCaption(""); // user finished this turn
        },
        preferLocalAsr: isMoonshineTranscriptionReady,
        transcribe: (pcm, engine, signal) => {
          if (!isCurrent()) return Promise.reject(new DOMException("Identity changed", "AbortError"));
          return transcribeSpeech(pcm, signal, engine === "cloud" ? "cloud" : "auto");
        },
        onPartial: (t) => { if (isCurrent()) setLiveCaption(t); },
        reply: async (userText, pcm, onSpeaking, signal) => {
          signal.throwIfAborted();
          if (!isCurrent()) throw new DOMException("Identity changed", "AbortError");
          const appended = appendUserTurn(
            messagesRef.current,
            turnMetaRef.current,
            userText,
            {
              source: "voice",
              spokenText: userText,
              pcm,
            },
          );
          const next = appended.messages;
          messagesRef.current = next;
          turnMetaRef.current = appended.meta;
          setTurnMeta(appended.meta);
          setMessages(next);
          const custom = isCustom ? (customScene ?? undefined) : undefined;

          // Stream the text bubble, then speak the complete final reply once.
          const queue = createSpeechQueue(id, getInteraction(signal));
          callQueueRef.current = queue;
          void queue.started.then(() => {
            if (!signal.aborted && isCurrent()) onSpeaking();
          });
          const cancelSpeech = () => queue.stop();
          signal.addEventListener("abort", cancelSpeech, { once: true });

          let started = false;
          const onText = (txt: string) => {
            if (signal.aborted || !isCurrent()) return;
            if (!started) {
              started = true;
              setMessages((m) => [...m, { role: "assistant", content: txt }]);
            } else {
              setLastAssistant(txt);
            }
            if (!mutedRef.current) queue.feed(txt);
          };
          try {
            const full = await streamChat(id, next, onText, signal, custom);
            signal.throwIfAborted();
            if (!isCurrent()) throw new DOMException("Identity changed", "AbortError");
            if (started) setLastAssistant(full);
            else
              setMessages((m) => [...m, { role: "assistant", content: full }]);
            await queue.end(mutedRef.current ? "" : full);
            if (queue.failed) throw new Error("语音播放失败，请点击回复旁的朗读按钮重试。");
          } catch (err) {
            queue.stop();
            if (signal.aborted || started || !isCurrent()) throw err;
            // Streaming unavailable -> plain endpoint; speak the whole reply.
            const r = await postChat(id, next, signal, custom);
            signal.throwIfAborted();
            if (!isCurrent()) throw new DOMException("Identity changed", "AbortError");
            if (started) setLastAssistant(r.reply);
            else
              setMessages((m) => [
                ...m,
                { role: "assistant", content: r.reply },
              ]);
            const fallback = createSpeechQueue(id, getInteraction(signal));
            callQueueRef.current = fallback;
            const cancelFallback = () => fallback.stop();
            signal.addEventListener("abort", cancelFallback, { once: true });
            void fallback.started.then(() => {
              if (!signal.aborted && isCurrent()) onSpeaking();
            });
            try {
              await fallback.end(mutedRef.current ? "" : r.reply);
              if (fallback.failed) throw new Error("语音播放失败，请点击回复旁的朗读按钮重试。");
            } finally {
              signal.removeEventListener("abort", cancelFallback);
              if (callQueueRef.current === fallback)
                callQueueRef.current = null;
            }
          } finally {
            signal.removeEventListener("abort", cancelSpeech);
            if (callQueueRef.current === queue) callQueueRef.current = null;
          }
        },
        interrupt: () => {
          // User talked over Pip — cut the read-aloud so they can take the turn.
          callQueueRef.current?.stop();
          callQueueRef.current = null;
          speakingRef.current?.stop();
        },
        onError: (msg) => {
          if (isCurrent()) setError(msg);
        },
      });
      if (!isCurrent() || attempt !== callAttemptRef.current) {
        call.end();
        return;
      }
      callRef.current = call;
      setCallPhase("listening");
    } catch {
      if (isCurrent())
        setError("无法开始通话，请允许麦克风权限，或用打字 / 点击录音。");
    } finally {
      if (isCurrent()) setCallStarting(false);
    }
  }

  function endCall() {
    callAttemptRef.current += 1;
    callRef.current?.end();
    callRef.current = null;
    setCallPhase(null);
    setLiveCaption("");
    callQueueRef.current?.stop();
    callQueueRef.current = null;
    speakingRef.current?.stop();
  }

  async function getHints() {
    if (!isCurrent() || !id || hintLoading || booting) return;
    setHintLoading(true);
    setError(null);
    try {
      const custom = isCustom ? (customScene ?? undefined) : undefined;
      const s = await postHint(id, messages, undefined, custom);
      if (!isCurrent()) return;
      setHints(s.length ? s : ["试着先打个招呼或回应上一句～"]);
    } catch {
      if (isCurrent()) setError("获取提示失败，请稍后再试。");
    } finally {
      if (isCurrent()) setHintLoading(false);
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
              : "准备好了就开口，Pip 会陪你聊下去";

  return (
    <div
      className="conversation-page flex h-screen flex-col"
      style={{ height: "100dvh" }}
    >
      <PlayfulBackground accent={t.base} />
      <header className="focus-header">
        <Wordmark />
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/scenes"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5"
          >
            <ArrowLeft className="h-4 w-4" /> 返回
          </Link>
          <button
            type="button"
            onClick={() => {
              if (!muted) {
                speakingRef.current?.stop();
                callQueueRef.current?.stop();
              }
              mutedRef.current = !muted;
              setMuted(!muted);
            }}
            aria-label={muted ? "开启朗读" : "关闭朗读"}
            title={muted ? "开启朗读" : "关闭朗读"}
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface text-ink shadow-soft transition-transform hover:-translate-y-0.5"
          >
            {muted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowVoiceSettings((value) => !value)}
            aria-label="语音设置"
            aria-expanded={showVoiceSettings}
            disabled={inCall || callStarting}
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface text-ink shadow-soft disabled:opacity-40"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="truncate rounded-full px-4 py-2 text-sm font-bold shadow-soft"
            style={{ background: t.soft, color: t.deep }}
          >
            {scenario
              ? `${scenario.titleZh} · ${scenario.title}`
              : isCustom
                ? customScene?.title_zh || "自定义场景"
                : "Practice"}
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

      <div className="conversation-workspace">
        <div className="conversation-chat">
          <div className="conversation-status">
            <div className="relative">
              <Buddy mood={stageMood} size={34} color={t.base} />
              {ScenarioIcon && (
                <span
                  className="hidden absolute bottom-1 right-1 grid h-9 w-9 place-items-center rounded-full border-2 border-bg shadow-soft"
                  style={{ background: t.soft, color: t.deep }}
                >
                  <ScenarioIcon className="h-5 w-5" strokeWidth={2.4} />
                </span>
              )}
            </div>
            <p
              role="status"
              aria-live="polite"
              className="mt-1 font-display text-base font-semibold text-ink"
            >
              {stageStatus}
            </p>
              <SpeechPlaybackStatus />
            {showVoiceSettings && (
              <div className="mt-3 w-full rounded-2xl border border-border bg-surface p-3 text-left shadow-soft">
                <label
                  htmlFor="conversation-voice"
                  className="mb-1 block text-sm font-bold"
                >
                  语音播放方式
                </label>
                <select
                  id="conversation-voice"
                  value={voiceEngine}
                  onChange={(event) =>
                    setVoiceEngine(event.target.value as VoiceEngine)
                  }
                  className="w-full rounded-xl border border-border bg-surface-2 p-2 text-sm"
                >
                  <option value="browser">浏览器语音 · 整段朗读（默认）</option>
                  <option value="iflytek">云端语音 · 整段生成后播放</option>
                  <option value="local">本地模型 · 实验功能，首次需下载</option>
                </select>
                <Link
                  to="/me?tab=voice"
                  className="mt-2 inline-block text-xs font-semibold underline"
                >
                  调整音色与语速
                </Link>
              </div>
            )}
            {inCall && liveCaption && (
              <p
                aria-live="polite"
                aria-atomic="true"
                className="mt-2 max-w-xl rounded-2xl bg-surface px-4 py-2 text-sm italic text-ink/70 shadow-soft"
              >
                {liveCaption}
              </p>
            )}
          </div>

          <main className="practice-log min-h-0 flex-1 space-y-5 overflow-y-auto">
            {messages.map((m, i) => (
              <ChatBubble
                key={i}
                role={m.role}
                text={m.content}
                theme={t}
                onSpeak={
                  m.role === "assistant"
                    ? () => void playTts(m.content)
                    : undefined
                }
                correction={
                  m.role === "user"
                    ? {
                        scenarioId: id,
                        text: m.content,
                        previousPartnerMessage:
                          previousPartnerMessage(messages, i) ?? "",
                        custom: isCustom
                          ? (customScene ?? undefined)
                          : undefined,
                        meta: turnMeta[i] ?? { source: "typed" },
                        onUseSuggestion: (suggestion) => {
                          setInput(suggestion);
                          setInputMode("text");
                        },
                      }
                    : undefined
                }
              />
            ))}
            {((loading && !streaming) || callPhase === "thinking") && (
              <TypingBubble theme={t} />
            )}
            {error && (
              <div
                role="alert"
                className="mx-auto w-fit rounded-full bg-[#ffe8e3] px-4 py-2 text-center text-xs font-semibold text-[#e6503d]"
              >
                {error}
                {canRetry && !inCall && (
                  <button
                    type="button"
                    onClick={() => void send(undefined, undefined, true)}
                    disabled={loading}
                    className="ml-2 font-bold underline"
                  >
                    重试回复
                  </button>
                )}
              </div>
            )}
            <div ref={endRef} />
          </main>

          <footer
            className="practice-composer w-full shrink-0 pt-2"
            style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
          >
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
                <div
                  role="group"
                  aria-label="练习输入方式"
                  className="mb-3 flex justify-center gap-2"
                >
                  {(["voice", "text"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={inputMode === mode}
                      onClick={() => setInputMode(mode)}
                      disabled={recording || transcribing || callStarting}
                      className={cn(
                        "min-h-10 rounded-full px-5 text-sm font-bold",
                        inputMode === mode
                          ? "bg-surface text-ink shadow-soft"
                          : "text-muted",
                      )}
                    >
                      {mode === "voice" ? "语音练习" : "文字练习"}
                    </button>
                  ))}
                </div>
                {inputMode === "voice" && (
                  <button
                    type="button"
                    onClick={startCall}
                    disabled={
                      booting ||
                      loading ||
                      recording ||
                      transcribing ||
                      callStarting
                    }
                    className="mb-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 font-display text-lg font-bold text-[#271a16] shadow-pop disabled:opacity-50"
                    style={{ background: t.base }}
                  >
                    {callStarting ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Phone className="h-5 w-5" />
                    )}
                    {callStarting ? "正在连接麦克风…" : "开始语音对话"}
                  </button>
                )}
                {hints && (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-[0.66rem] font-bold uppercase tracking-wide text-muted">
                      提示
                    </span>
                    {hints.map((h, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setInput(h);
                          setInputMode("text");
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
                    disabled={
                      transcribing || booting || loading || callStarting
                    }
                    aria-label={recording ? "结束录音" : "开始录音"}
                    title={recording ? "结束录音" : "按一下说，再按结束"}
                    className={cn(
                      "grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#271a16] shadow-soft transition-transform active:scale-95 disabled:opacity-50",
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
                  {inputMode === "text" ? (
                    <input
                      aria-label="英文回复"
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
                  ) : (
                    <p className="min-w-0 flex-1 px-2 text-sm text-muted">
                      {recording
                        ? "正在录音，再点一次结束"
                        : transcribing
                          ? "正在识别…"
                          : "也可点击麦克风录一句"}
                    </p>
                  )}
                  {inputMode === "text" && (
                    <button
                      type="button"
                      onClick={() => send()}
                      disabled={
                        loading ||
                        booting ||
                        recording ||
                        transcribing ||
                        !input.trim()
                      }
                      aria-label="发送"
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#271a16] shadow-soft transition-transform active:scale-95 disabled:opacity-40"
                      style={{ background: t.base }}
                    >
                      <Send className="h-5 w-5" strokeWidth={2.4} />
                    </button>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-center gap-3">
                  <p className="text-xs text-muted">
                    {inputMode === "voice"
                      ? "通话自动接话 · 点击录音，再点结束"
                      : "按 Enter 发送 · 点英文可查词"}
                  </p>
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
        <aside className="practice-context">
          <p className="eyebrow">YOUR SCENE</p>
          <h2>
            {ScenarioIcon && <ScenarioIcon />}
            {scenario?.titleZh || customScene?.title_zh || "自由对话"}
          </h2>
          <p>
            {scenario?.subtitle ||
              customScene?.partner_role ||
              "和 Pip 练一段真实对话。"}
          </p>
          <section>
            <h3>这次试着做到</h3>
            <p className="scene-goal">
              {scenario?.goal ||
                customScene?.goal ||
                "用自己的方式展开对话，试着把想法说完整。"}
            </p>
          </section>
          <section>
            <p className="eyebrow">A LITTLE HELP</p>
            <p>遇到卡壳的时候，可以先看一句提示，再用自己的方式接着聊。</p>
            <button
              type="button"
              className="ui-secondary"
              disabled={booting || hintLoading || inCall}
              onClick={getHints}
            >
              <Lightbulb />
              给我一句提示
            </button>
          </section>
          <p>点击英文单词可以查释义、听发音并收藏。</p>
        </aside>
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
            style={{
              background: "var(--muted)",
              animationDuration: "0.9s",
              animationDelay: d,
            }}
          />
        ))}
      </div>
    </div>
  );
}
