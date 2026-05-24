import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = resolve(here, "..");
const repoRoot = resolve(dashboardRoot, "..");
const source = join(repoRoot, "docs", "proof", "artifacts");
const target = join(dashboardRoot, "public", "data", "artifacts");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

const entries = await readdir(source, { withFileTypes: true });
let copied = 0;

for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
  await copyFile(join(source, entry.name), join(target, entry.name));
  copied += 1;
}

if (copied === 0) {
  throw new Error(`No proof artifact JSON files found in ${source}`);
}

console.log(`Synced ${copied} proof artifact files into public/data/artifacts.`);
