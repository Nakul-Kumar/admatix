import { defineConfig } from "vitest/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: repoRoot,
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "tests/e2e/**/*.test.ts",
    ],
    globals: false,
    // The e2e demo flow runs the whole orchestration end-to-end and
    // spawns an in-process Fastify instance; give it room to breathe.
    testTimeout: 30_000,
  },
});
