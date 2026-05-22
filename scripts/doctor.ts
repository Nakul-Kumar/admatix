/**
 * `pnpm doctor` — environment + workspace health check.
 * Extended by WP-A. Fails non-zero on a broken setup.
 */
import { existsSync } from "node:fs";
import process from "node:process";

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

const major = Number(process.versions.node.split(".")[0]);
check("Node >= 20", major >= 20, `found ${process.versions.node}`);
check("pnpm-workspace.yaml", existsSync("pnpm-workspace.yaml"), "workspace root");
check("packages/schemas", existsSync("packages/schemas/src/index.ts"), "shared contract");
check(
  "fixtures seeded",
  existsSync("data/fixtures/google_ads/demo_campaigns.json"),
  "run `pnpm seed-fixtures` if missing",
);
check(
  ".env.local present (optional for MVP)",
  existsSync(".env.local"),
  "MVP runs on fixtures; .env.local is optional",
);

let failed = 0;
for (const c of checks) {
  const mark = c.ok ? "PASS" : "FAIL";
  if (!c.ok && !c.name.includes("optional")) failed++;
  console.log(`[${mark}] ${c.name} — ${c.detail}`);
}

if (failed > 0) {
  console.error(`\ndoctor: ${failed} required check(s) failed.`);
  process.exit(1);
}
console.log("\ndoctor: all required checks passed.");
