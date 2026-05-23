import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { BenchmarkTask } from "@admatix/schemas";
import { findRepoRoot, readJson } from "./paths.js";

export async function loadTasks(
  suite: string,
  opts: { rootDir?: string } = {},
): Promise<BenchmarkTask[]> {
  const root = opts.rootDir ?? findRepoRoot();
  const dir = join(root, "data", "benchmarks", suite, "tasks");
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (cause) {
    throw new Error(
      `loadTasks: cannot read benchmark suite "${suite}" at ${dir} — ${(cause as Error).message}`,
    );
  }

  const tasks: BenchmarkTask[] = [];
  for (const name of entries.sort()) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    if (!statSync(path).isFile()) continue;
    const raw = readJson<unknown>(path);
    const parsed = BenchmarkTask.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `loadTasks: ${path} is not a valid BenchmarkTask — ${parsed.error.message}`,
      );
    }
    if (parsed.data.suite !== suite) {
      throw new Error(
        `loadTasks: ${path} declares suite "${parsed.data.suite}" but lives under "${suite}"`,
      );
    }
    tasks.push(parsed.data);
  }
  if (tasks.length === 0) {
    throw new Error(`loadTasks: suite "${suite}" contains no .json tasks at ${dir}`);
  }
  return tasks;
}
