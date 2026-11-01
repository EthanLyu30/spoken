import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSpeechPlayback, type SpeechPlayback } from "../store/speechPlayback";

function PlaybackDetails({playback}:{playback:SpeechPlayback}) {
  const engine = playback.effectiveEngine === "browser" ? "浏览器语音"
    : playback.effectiveEngine === "local" ? "本地 AI 语音" : "语音";
  const phase = {waiting:"等待回复",preparing:"正在准备",speaking:"正在播放",completed:"播放完成",cancelled:"已停止",error:"播放失败"}[playback.phase];
  const reason = playback.fallbackReason === "browser-unavailable" ? "此设备暂无可用英文音色，可继续文字练习。"
    : playback.fallbackReason === "browser-start-failed" ? "浏览器朗读未能完成，可继续文字练习。"
    : playback.fallbackReason === "local-unavailable" ? "本地发音尚未就绪，已使用浏览器语音。" : "";
  return <>
    <p>{phase}{playback.effectiveEngine && <> · 实际声音：{engine}{playback.voice ? ` · ${playback.voice}` : ""}</>}</p>
    {reason && <p>{reason}</p>}
    {playback.phase === "error" && <p>请重试或选择其他可用音色。</p>}
  </>;
}

export function SpeechPlaybackStatus({suppressInlineErrors=false}:{suppressInlineErrors?:boolean}) {
  const playback = useSpeechPlayback(s => s.playback);
  if (!playback || playback.phase === "waiting" || (suppressInlineErrors && playback.phase === "error")) return null;
  return <div role={playback.phase === "error" ? "alert" : "status"} className="mt-3 break-words text-xs leading-relaxed text-muted">
    <PlaybackDetails playback={playback}/>
  </div>;
}

/** One error alert for every reader; successful playback keeps its existing inline UI. */
export function SpeechPlaybackError() {
  const playback=useSpeechPlayback(s=>s.playback);
  const [dismissedId,setDismissedId]=useState<number|null>(null);
  const [host,setHost]=useState<HTMLElement>(document.body);
  const visible=playback?.phase === "error" && playback.id !== dismissedId;
  useEffect(()=>{
    if (!visible) return;
    // Native modal dialogs sit above ordinary z-index layers and make the rest
    // of the page inert. Keep the alert and dismiss control inside that layer.
    const refreshHost=()=>setHost([...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].at(-1) ?? document.body);
    refreshHost();
    const observer=new MutationObserver(refreshHost);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["open"]});
    return ()=>observer.disconnect();
  },[visible]);
  if (!visible || !playback) return null;
  return createPortal(<section role="alert" className="fixed inset-x-4 top-4 z-[100] mx-auto max-w-lg rounded-2xl border border-coral bg-surface p-4 text-sm leading-relaxed text-ink shadow-pop">
    <PlaybackDetails playback={playback}/>
    <button type="button" aria-label="关闭朗读错误提示" onClick={()=>setDismissedId(playback.id)} className="mt-2 rounded-full border border-border px-3 py-1 text-xs font-bold">关闭提示</button>
  </section>,host);
}
