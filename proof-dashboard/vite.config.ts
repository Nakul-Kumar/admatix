import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const base = process.env.VITE_BASE_PATH ?? process.env.BASE_PATH ?? "./";

export default defineConfig({
  plugins: [react()],
  base,
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1024,
  },
});
