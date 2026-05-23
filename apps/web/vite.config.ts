import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env["ADMATIX_WEB_PORT"] ?? 5173),
    host: process.env["ADMATIX_WEB_HOST"] ?? "127.0.0.1",
    strictPort: false,
  },
  test: {
    environment: "jsdom",
    globals: true,
    css: false,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
