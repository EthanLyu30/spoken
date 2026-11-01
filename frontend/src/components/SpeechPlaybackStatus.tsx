import { useSpeechPlayback } from "../store/speechPlayback";

export function SpeechPlaybackStatus() {
  const playback = useSpeechPlayback(s => s.playback);
  if (!playback || playback.phase === "waiting") return null;
  const engine = playback.effectiveEngine === "browser" ? "浏览器语音"
    : playback.effectiveEngine === "local" ? "本地 AI 语音" : "语音";
  const phase = {waiting:"等待回复",preparing:"正在准备",speaking:"正在播放",completed:"播放完成",cancelled:"已停止",error:"播放失败"}[playback.phase];
  const reason = playback.fallbackReason === "browser-unavailable" ? "此设备暂无可用英文音色，可继续文字练习。"
    : playback.fallbackReason === "browser-start-failed" ? "浏览器朗读未能完成，可继续文字练习。"
    : playback.fallbackReason === "local-unavailable" ? "本地发音尚未就绪，已使用浏览器语音。" : "";
  return <div role={playback.phase === "error" ? "alert" : "status"} className="mt-3 break-words text-xs leading-relaxed text-muted">
    <p>{phase}{playback.effectiveEngine && <> · 实际声音：{engine}{playback.voice ? ` · ${playback.voice}` : ""}</>}</p>
    {reason && <p>{reason}</p>}
    {playback.phase === "error" && <p>请重试或选择其他可用音色。</p>}
  </div>;
}
