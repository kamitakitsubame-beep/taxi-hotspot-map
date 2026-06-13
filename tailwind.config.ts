import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        demand: {
          high: "#ef4444",
          medium: "#eab308",
          low: "#22c55e",
        },
      },
      fontSize: {
        base: ["16px", "1.6"],
      },
    },
  },
  plugins: [],
};

export default config;
