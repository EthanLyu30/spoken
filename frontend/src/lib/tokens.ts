/**
 * Design tokens as plain values, for places that can't read CSS variables
 * (e.g. ECharts option objects). Keep in sync with the CSS variables in
 * src/index.css — this is the JS mirror of the same single source of truth.
 */
export const tokens = {
  bg: "#fff3e6",
  surface: "#fffdf9",
  surface2: "#fff6ec",
  ink: "#43302b",
  muted: "#b0897a",
  border: "#f1ddc6",
  coral: "#ff6f5e",
  tangerine: "#ff9f45",
  sunny: "#ffc94d",
  leaf: "#41c08c",
  sky: "#57b7e8",
  berry: "#ff7aa2",
  grape: "#8a7bf0",
  success: "#41c08c",
  warning: "#ffc94d",
  danger: "#f0607a",
} as const;

export type Tokens = typeof tokens;
