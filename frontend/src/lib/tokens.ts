/**
 * Design tokens as plain values, for places that can't read CSS variables
 * (e.g. ECharts option objects). Keep in sync with the CSS variables in
 * src/index.css — this is the JS mirror of the same single source of truth.
 */
export const tokens = {
  bg: "#f4efe6",
  surface: "#fbf8f1",
  surfaceAlt: "#ece5d6",
  primary: "#6e1a1f",
  accent: "#ff5a1f",
  text: "#1c1a17",
  muted: "#7a7264",
  border: "#d8cfbe",
  success: "#2f6b4f",
  warning: "#c98a12",
  danger: "#b23a2e",
} as const;

export type Tokens = typeof tokens;
