import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSpeechPlayback, type SpeechPlayback } from "../store/speechPlayback";

function PlaybackMessage({ playback }: { playback: SpeechPlayback }) {
  if (playback.phase === "error") {
    return <p>朗读暂时不可用，可继续文字练习。</p>;
  }
  if (playback.phase === "preparing") return <p>正在准备朗读…</p>;
  if (playback.phase === "speaking") return <p>正在朗读…</p>;
  return null;
}

export function SpeechPlaybackStatus({suppressInlineErrors=false}:{suppressInlineErrors?:boolean}) {
  const playback = useSpeechPlayback(s => s.playback);
  if (!playback || playback.phase === "waiting" || playback.phase === "completed" || playback.phase === "cancelled" || (suppressInlineErrors && playback.phase === "error")) return null;
  return <div role={playback.phase === "error" ? "alert" : "status"} className="mt-3 break-words text-xs leading-relaxed text-muted">
    <PlaybackMessage playback={playback}/>
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
    <PlaybackMessage playback={playback}/>
    <button type="button" aria-label="关闭朗读错误提示" onClick={()=>setDismissedId(playback.id)} className="mt-2 rounded-full border border-border px-3 py-1 text-xs font-bold">关闭提示</button>
  </section>,host);
}
