/**
 * Per-scenario candy colours. Each scenario gets a base (accent), a soft tint
 * (card / bubble background) and a deep shade (text on the soft tint).
 *
 * Applied via inline styles rather than Tailwind classes, because Tailwind's
 * alpha modifiers don't work on CSS-variable-backed colours.
 */
export interface ScenarioTheme {
  base: string;
  soft: string;
  deep: string;
}

export const scenarioThemes: Record<string, ScenarioTheme> = {
  interview: { base: "#57b7e8", soft: "#e6f4fc", deep: "#2c8fc6" },
  cafe: { base: "#ff9f45", soft: "#fff0dd", deep: "#e07f1c" },
  standup: { base: "#41c08c", soft: "#e2f6ee", deep: "#2b9b70" },
  airport: { base: "#ff7aa2", soft: "#ffe8f0", deep: "#e85585" },
  doctor: { base: "#ff6f5e", soft: "#ffe8e3", deep: "#e6503d" },
  party: { base: "#ffc94d", soft: "#fff5d8", deep: "#cf9612" },
};

export const fallbackTheme: ScenarioTheme = {
  base: "#ff6f5e",
  soft: "#ffe8e3",
  deep: "#e6503d",
};

export function themeFor(id: string): ScenarioTheme {
  return scenarioThemes[id] ?? fallbackTheme;
}
