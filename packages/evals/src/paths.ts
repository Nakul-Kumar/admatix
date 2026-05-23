import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT_MARKER = "pnpm-workspace.yaml";

/** Walk up from `start` until we find the workspace root. Throws if not found. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ROOT_MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `findRepoRoot: could not locate ${ROOT_MARKER} walking up from ${start}`,
      );
    }
    dir = parent;
  }
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
