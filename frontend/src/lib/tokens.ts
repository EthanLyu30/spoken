/**
 * Design tokens as plain values, for places that can't read CSS variables
 * (e.g. ECharts option objects). Keep in sync with the CSS variables in
 * src/index.css — this is the JS mirror of the same single source of truth.
 */
export const tokens = {
  bg: "#fffcf7",
  surface: "#fffefa",
  surface2: "#fcf4eb",
  ink: "#342019",
  muted: "#826b5e",
  border: "#eadfd4",
  coral: "#ff6251",
  tangerine: "#ff9f45",
  sunny: "#ffc94d",
  leaf: "#3b816b",
  sky: "#57b7e8",
  berry: "#ff7aa2",
  grape: "#8a7bf0",
  success: "#3b816b",
  warning: "#ffc94d",
  danger: "#f0607a",
} as const;

export type Tokens = typeof tokens;
