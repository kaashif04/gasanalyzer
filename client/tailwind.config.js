/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: [
          '"IBM Plex Mono"',
          "ui-monospace",
          '"SF Mono"',
          "Menlo",
          "monospace",
        ],
      },
      colors: {
        // Instrument panel surfaces — deep, slightly blue, never pure black.
        ink: {
          900: "#070a0f",
          850: "#0a0e15",
          800: "#0d121b",
          750: "#111826",
          700: "#16202f",
          600: "#1d2a3d",
          500: "#27374f",
        },
        // Phosphor signal accent (oscilloscope trace).
        signal: {
          DEFAULT: "#38e8c8",
          dim: "#1c8f7c",
          glow: "#5cffe0",
        },
        // Status palette — chosen to stay distinguishable for color-blind users
        // (always paired with an icon/shape in the UI, never hue alone).
        nominal: "#34d399",
        drift: "#fbbf24",
        fault: "#fb5d6b",
        info: "#60a5fa",
      },
      boxShadow: {
        panel:
          "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 30px -12px rgba(0,0,0,0.7)",
        glow: "0 0 0 1px rgba(56,232,200,0.25), 0 0 24px -6px rgba(56,232,200,0.35)",
      },
      keyframes: {
        freshpulse: {
          "0%": { boxShadow: "0 0 0 0 rgba(56,232,200,0.45)" },
          "70%": { boxShadow: "0 0 0 10px rgba(56,232,200,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(56,232,200,0)" },
        },
        stalepulse: {
          "0%,100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        sweep: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        freshpulse: "freshpulse 0.9s ease-out",
        stalepulse: "stalepulse 1.8s ease-in-out infinite",
        sweep: "sweep 2.2s linear infinite",
      },
    },
  },
  plugins: [],
};
