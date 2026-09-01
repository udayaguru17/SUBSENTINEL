import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          950: "#0F1215",
          900: "#12151A",
          850: "#14171A",
          800: "#181B1F",
          750: "#1D2126",
          700: "#1F2328",
          border: "#2A2F36",
          borderMuted: "#22262C",
        },
        text: {
          primary: "#E8EAED",
          secondary: "#B8BEC7",
          muted: "#8B93A0",
          faint: "#767E8B",
        },
        status: {
          safe: "#3ECF8E",
          warning: "#F5A623",
          critical: "#EF4E4E",
          info: "#5B8DB8",
        },
        brand: {
          amber: "#F5A623",
          steel: "#5B8DB8",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
