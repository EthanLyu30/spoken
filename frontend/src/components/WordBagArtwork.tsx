import { Pause, Play } from "lucide-react";
import { createContext, useContext, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import studyArt from "../assets/pip-speaking-practice.webp";
import cafeArt from "../assets/cafe-hero-768.webp";
import { rehearsalScene } from "../data/rehearsalScenes";
import { RehearsalAtmosphere } from "./RehearsalAtmosphere";

const motionPreference = "(prefers-reduced-motion: reduce)";
const MotionControl = createContext<{ paused: boolean; toggle: () => void } | null>(null);

function subscribeMotion(listener: () => void) {
  const preference = window.matchMedia?.(motionPreference);
  preference?.addEventListener?.("change", listener);
  return () => preference?.removeEventListener?.("change", listener);
}

export function WordBagMotionProvider({ children }: { children: ReactNode }) {
  const inherited = useContext(MotionControl);
  const [paused, setPaused] = useState(false);
  return <MotionControl.Provider value={inherited ?? { paused, toggle: () => setPaused(value => !value) }}>
    {children}
  </MotionControl.Provider>;
}

export function WordBagArtwork({ scenarioId = "", compact = false }: { scenarioId?: string; compact?: boolean }) {
  const reduced = useSyncExternalStore(subscribeMotion, () => Boolean(window.matchMedia?.(motionPreference).matches), () => true);
  const motion = useContext(MotionControl);
  const [localPaused, setLocalPaused] = useState(false);
  const paused = motion?.paused ?? localPaused;
  const scene = scenarioId && scenarioId !== "cafe" ? rehearsalScene(scenarioId) : null;
  const position = scene ? `${(scene.cell % 3) * 50}% ${Math.floor(scene.cell / 3) * 50}%` : undefined;
  const image = scene?.atlas ?? (scenarioId === "cafe" ? cafeArt : studyArt);
  const style = { "--wordbag-art": `url(${image})`, "--wordbag-position": position } as CSSProperties;
  return <div className={`wordbag-artwork${compact ? " wordbag-artwork-compact" : ""}`} data-paused={paused || undefined}>
    <div key={scenarioId} className={`wordbag-art-image${scene ? " wordbag-art-atlas" : ""}`} style={style} aria-hidden="true" />
    {!reduced && <>
      <RehearsalAtmosphere still={paused} effect={scene?.air ?? "daylight"} />
      <button className="wordbag-art-motion" type="button" aria-label={paused ? "播放场景动效" : "暂停场景动效"}
        onClick={motion?.toggle ?? (() => setLocalPaused(value => !value))}>
        {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
      </button>
    </>}
  </div>;
}
