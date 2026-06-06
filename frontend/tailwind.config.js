/** @type {import('tailwindcss').Config} */
// "Pip" playful-buddy design system. All color tokens are CSS variables defined
// in src/index.css so the warm palette has a single source of truth.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces (warm peach paper)
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        // Ink
        ink: "var(--ink)",
        muted: "var(--muted)",
        border: "var(--border)",
        // Brand + candy accents
        primary: "var(--coral)",
        "primary-fg": "var(--coral-fg)",
        coral: "var(--coral)",
        "coral-deep": "var(--coral-deep)",
        tangerine: "var(--tangerine)",
        sunny: "var(--sunny)",
        leaf: "var(--leaf)",
        "leaf-deep": "var(--leaf-deep)",
        sky: "var(--sky)",
        berry: "var(--berry)",
        grape: "var(--grape)",
        // Semantic (mapped onto the candy palette)
        success: "var(--leaf)",
        warning: "var(--sunny)",
        danger: "var(--danger)",
      },
      fontFamily: {
        display: [
          '"Fredoka Variable"',
          '"Fredoka"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          "sans-serif",
        ],
        body: [
          '"Nunito Variable"',
          '"Nunito"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          "sans-serif",
        ],
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        soft: "var(--radius-sm)",
        chunk: "1.75rem",
        huge: "2.5rem",
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        pop: "var(--shadow-pop)",
        pressed: "var(--shadow-pressed)",
        sticker: "var(--shadow-sticker)",
      },
      keyframes: {
        bob: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-7px)" },
        },
        blink: {
          "0%,92%,100%": { transform: "scaleY(1)" },
          "95%": { transform: "scaleY(0.08)" },
        },
        talk: {
          "0%,100%": { transform: "scaleY(0.45)" },
          "50%": { transform: "scaleY(1)" },
        },
        floaty: {
          "0%,100%": { transform: "translate(0,0)" },
          "50%": { transform: "translate(0,-22px)" },
        },
        rise: {
          "0%": { opacity: "0", transform: "translateY(16px) scale(0.96)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        pulsering: {
          "0%": { transform: "scale(0.85)", opacity: "0.5" },
          "100%": { transform: "scale(1.7)", opacity: "0" },
        },
        sparkle: {
          "0%,100%": { transform: "scale(0.5) rotate(0deg)", opacity: "0.25" },
          "50%": { transform: "scale(1) rotate(25deg)", opacity: "1" },
        },
        wiggle: {
          "0%,100%": { transform: "rotate(-3deg)" },
          "50%": { transform: "rotate(3deg)" },
        },
        drift: {
          "0%,100%": { transform: "translate(0,0)" },
          "33%": { transform: "translate(22px,-18px)" },
          "66%": { transform: "translate(-16px,14px)" },
        },
        fall: {
          "0%": { transform: "translateY(-12vh) rotate(0deg)", opacity: "0" },
          "12%": { opacity: "1" },
          "100%": { transform: "translateY(112vh) rotate(380deg)", opacity: "0.9" },
        },
      },
      animation: {
        bob: "bob 3.4s ease-in-out infinite",
        blink: "blink 5s ease-in-out infinite",
        talk: "talk 0.32s ease-in-out infinite",
        floaty: "floaty 9s ease-in-out infinite",
        rise: "rise 0.6s cubic-bezier(0.34,1.56,0.64,1) both",
        pulsering: "pulsering 1.8s ease-out infinite",
        sparkle: "sparkle 2.6s ease-in-out infinite",
        wiggle: "wiggle 0.5s ease-in-out infinite",
        drift: "drift 16s ease-in-out infinite",
        fall: "fall 4s linear infinite",
      },
    },
  },
  plugins: [],
};
