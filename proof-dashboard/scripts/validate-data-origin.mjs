import { readFile } from "node:fs/promises";
import { join } from "node:path";

const allowedKinds = new Set([
  "live",
  "artifact",
  "demo",
  "fixture",
  "unavailable",
]);

const bundledFiles = [
  "benchmark.json",
  "decisions.json",
  "scorecard.json",
  "validation.json",
  "worlds.json",
];

const root = process.cwd();
const failures = [];

for (const file of bundledFiles) {
  const path = join(root, "public", "data", file);
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  const kind = parsed?.origin?.kind;

  if (!allowedKinds.has(kind)) {
    failures.push(`${file}: origin.kind must be one of ${[...allowedKinds].join(", ")}`);
  }

  if (kind === "live") {
    failures.push(`${file}: bundled dashboard samples must not be labelled live`);
  }

  if (typeof parsed?.origin?.label !== "string" || parsed.origin.label.trim() === "") {
    failures.push(`${file}: origin.label is required`);
  }
}

const sourceChecks = [
  join(root, "src", "components", "Layout.tsx"),
  join(root, "src", "views", "Overview.tsx"),
  join(root, "src", "views", "Worlds.tsx"),
  join(root, "src", "views", "Benchmark.tsx"),
  join(root, "src", "views", "Validation.tsx"),
  join(root, "src", "views", "Decisions.tsx"),
];

for (const path of sourceChecks) {
  const raw = await readFile(path, "utf8");
  if (/live mock data/i.test(raw)) {
    failures.push(`${path}: must not describe bundled samples as live mock data`);
  }
}

if (failures.length > 0) {
  console.error("Data-origin validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Data-origin validation passed for ${bundledFiles.length} bundled datasets.`);
