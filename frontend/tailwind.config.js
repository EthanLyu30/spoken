/** @type {import('tailwindcss').Config} */
// "Signal — The Language Journal" design system.
// All color tokens are driven by CSS variables defined in src/index.css so the
// editorial palette has a single source of truth.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--bg)",
        surface: {
          DEFAULT: "var(--surface)",
          alt: "var(--surface-alt)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          fg: "var(--primary-fg)",
        },
        accent: "var(--accent)",
        ink: "var(--text)",
        muted: "var(--muted)",
        border: "var(--border)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
      },
      fontFamily: {
        display: ['"Fraunces Variable"', "Fraunces", '"Noto Serif SC"', "serif"],
        body: ['"Newsreader Variable"', "Newsreader", '"Noto Serif SC"', "serif"],
        meta: ['"Space Grotesk Variable"', '"Space Grotesk"', "ui-monospace", "monospace"],
        sc: ['"PingFang SC"', '"Microsoft YaHei"', '"Noto Sans SC"', "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "calc(var(--radius) * 0.5)",
      },
      boxShadow: {
        clip: "0 1px 0 rgba(28,26,23,0.04), 0 8px 24px -16px rgba(110,26,31,0.18)",
        mic: "0 0 48px -10px rgba(255,90,31,0.45)",
      },
      maxWidth: {
        reading: "42rem",
        page: "78rem",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 250ms ease-out both",
      },
    },
  },
  plugins: [],
};
