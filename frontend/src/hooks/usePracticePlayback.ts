import { useCallback, useEffect, useRef, useState } from "react";
import { speakText, type Speaking } from "../lib/speech";
import { useSpeechPlayback } from "../store/speechPlayback";

export function usePracticePlayback(scenarioId: string) {
  const player = useRef<Speaking | null>(null);
  const [clip, setClip] = useState<{ key: string; id: number } | null>(null);
  const phase = useSpeechPlayback(({ playback }) => {
    if (!clip || playback?.id !== clip.id) return null;
    return playback.phase === "waiting" || playback.phase === "preparing" || playback.phase === "speaking"
      ? playback.phase : null;
  });
  const activeKey = phase ? clip?.key : undefined;
  const stop = useCallback(() => { player.current?.stop(); player.current = null; }, []);
  useEffect(() => stop, [scenarioId, stop]);

  function toggle(key: string, text: string) {
    stop();
    if (activeKey === key) return;
    const playback = speakText(text, scenarioId);
    player.current = playback;
    setClip(playback.status ? { key, id: playback.status.id } : null);
  }

  return { activeKey, phase, stop, toggle };
}
