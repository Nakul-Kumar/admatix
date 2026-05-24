import { readdir, readFile } from "node:fs/promises";
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

const artifactDir = join(root, "public", "data", "artifacts");
const artifactFiles = (await readdir(artifactDir))
  .filter((name) => name.endsWith(".json"))
  .sort();

if (!artifactFiles.includes("manifest.json")) {
  failures.push("artifacts: manifest.json is required");
}

for (const file of artifactFiles) {
  const path = join(artifactDir, file);
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  const kind = parsed?.origin?.kind;

  if (kind !== "artifact") {
    failures.push(`artifacts/${file}: origin.kind must be artifact`);
  }
  if (typeof parsed?.origin?.label !== "string" || parsed.origin.label.trim() === "") {
    failures.push(`artifacts/${file}: origin.label is required`);
  }
  if (parsed?.status && !["PASS", "READY", "FAIL", "INCONCLUSIVE"].includes(parsed.status)) {
    failures.push(`artifacts/${file}: status must be PASS, READY, FAIL, or INCONCLUSIVE`);
  }
}

const sourceChecks = [
  join(root, "src", "components", "Layout.tsx"),
  join(root, "src", "views", "Overview.tsx"),
  join(root, "src", "views", "Worlds.tsx"),
  join(root, "src", "views", "Benchmark.tsx"),
  join(root, "src", "views", "Validation.tsx"),
  join(root, "src", "views", "Decisions.tsx"),
  join(root, "src", "views", "Artifacts.tsx"),
];

for (const path of sourceChecks) {
  const raw = await readFile(path, "utf8");
  if (/live mock data/i.test(raw)) {
    failures.push(`${path}: must not describe bundled samples as live mock data`);
  }
}

const artifactsView = await readFile(join(root, "src", "views", "Artifacts.tsx"), "utf8");
if (!/not a continuous live ad-account feed/i.test(artifactsView)) {
  failures.push("Artifacts.tsx: must state the proof view is not a continuous live ad-account feed");
}
if (!/No live spend-lift claim/i.test(artifactsView)) {
  failures.push("Artifacts.tsx: must display the no-live-spend-lift claim boundary");
}

const layoutSource = await readFile(join(root, "src", "components", "Layout.tsx"), "utf8");
if (!/Demo Lab/i.test(layoutSource)) {
  failures.push("Layout.tsx: illustrative routes must be grouped under Demo Lab");
}

if (failures.length > 0) {
  console.error("Data-origin validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Data-origin validation passed for ${bundledFiles.length} bundled datasets and ${artifactFiles.length} artifact files.`,
);
