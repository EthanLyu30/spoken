import { useSyncExternalStore } from "react";
import { localSpeechCoordinator } from "../lib/localSpeech/runtime";
import { useVoice } from "../store/voice";
import type { LocalSpeechModelState } from "../lib/localSpeech/coordinator";

const labels:Record<LocalSpeechModelState,string> = {
  idle:"尚未准备", queued:"等待另一模型准备完成", loading:"下载 / 预热中",
  ready:"已就绪", error:"加载或运行失败", unavailable:"此设备暂不可用",
};

export function LocalSpeechStatus() {
  const snapshot = useSyncExternalStore(localSpeechCoordinator.subscribe,localSpeechCoordinator.getSnapshot);
  const models = [
    {id:"kokoro" as const,label:"本机朗读 · Kokoro · Heart"},
    {id:"moonshine" as const,label:"本机识别 · Moonshine"},
  ];
  const states = models.map(({id})=>snapshot[id].state);
  const hasError = states.includes("error");
  const busy = states.some(state=>state === "queued" || state === "loading");
  const canPrepare = hasError || (!busy && states.includes("idle"));
  return <section aria-label="本地语音模型状态" className="mb-5 rounded-2xl border border-border bg-surface-2 p-4">
    <p className="mb-3 text-xs leading-relaxed text-muted">
      实验功能，仅负责本机英文朗读和录音识别；对话与评分仍需联网。
      首次下载和预热可能较久，文件会缓存在浏览器中，建议使用 Wi-Fi。
      发音未就绪时优先使用浏览器，再使用云端；识别未就绪时使用云端。
    </p>
    <div className="space-y-3">
      {models.map(({id,label})=>{
        const model=snapshot[id];
        return <div key={id} className="text-xs">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="font-bold text-ink">{label}</span>
            <span aria-live="polite" className={model.state === "error" ? "text-coral" : "text-muted"}>{labels[model.state]}</span>
          </div>
          {model.state === "loading" && model.downloadedBytes > 0 &&
            <p className="mt-1 text-muted">本次已下载 {(model.downloadedBytes/1024/1024).toFixed(1)} MB；完整大小随运行方式而异。</p>}
          {model.state === "unavailable" && <p className="mt-1 text-muted">
            {model.error === "save-data" ? "设备启用了节省流量模式，不下载模型。" : "当前设备能力受限，将使用备用语音。"}
          </p>}
        </div>;
      })}
    </div>
    {canPrepare && <button type="button" onClick={()=>{
      void localSpeechCoordinator.preload({includeKokoro:true,priority:"kokoro",shouldContinue:()=>useVoice.getState().engine === "local"});
    }} className="mt-3 rounded-full border border-border bg-surface px-3 py-2 text-xs font-bold text-ink">
      {hasError ? "重试未就绪模型" : "准备本地模型"}
    </button>}
  </section>;
}
