import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // AdMatix accent — used sparingly for the gate/blocked banner.
        gate: {
          DEFAULT: "#dc2626",
          soft: "#fee2e2",
        },
      },
    },
  },
  plugins: [],
};

export default config;
