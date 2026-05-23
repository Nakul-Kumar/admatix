import { mkdir, readFile, writeFile, readdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Persistence abstraction. The MVP implementation writes JSON/JSONL under the
 * filesystem so a Postgres-backed Store can be dropped in later without
 * changing any caller.
 *
 *   put/get/list operate on `<rootDir>/state/<collection>/<id>.json`
 *   append             writes one line to `<rootDir>/events/<stream>.jsonl`
 */
export interface Store {
  put<T>(collection: string, id: string, value: T): Promise<void>;
  get<T>(collection: string, id: string): Promise<T | null>;
  list<T>(collection: string, filter?: Record<string, unknown>): Promise<T[]>;
  append(stream: string, record: unknown): Promise<void>;
}

const SAFE_NAME = /^[a-zA-Z0-9_.-]+$/;

function assertSafe(kind: string, name: string): void {
  if (!SAFE_NAME.test(name)) {
    throw new Error(
      `Store: invalid ${kind} "${name}" — must match ${SAFE_NAME.source}`,
    );
  }
}

export function createStore(rootDir?: string): Store {
  const root = resolve(rootDir ?? "data");
  const statePath = (collection: string, id: string) => {
    assertSafe("collection", collection);
    assertSafe("id", id);
    return join(root, "state", collection, `${id}.json`);
  };
  const collectionDir = (collection: string) => {
    assertSafe("collection", collection);
    return join(root, "state", collection);
  };
  const streamPath = (stream: string) => {
    assertSafe("stream", stream);
    return join(root, "events", `${stream}.jsonl`);
  };

  return {
    async put<T>(collection: string, id: string, value: T): Promise<void> {
      const file = statePath(collection, id);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
    },

    async get<T>(collection: string, id: string): Promise<T | null> {
      const file = statePath(collection, id);
      if (!existsSync(file)) return null;
      const buf = await readFile(file, "utf8");
      return JSON.parse(buf) as T;
    },

    async list<T>(
      collection: string,
      filter?: Record<string, unknown>,
    ): Promise<T[]> {
      const dir = collectionDir(collection);
      if (!existsSync(dir)) return [];
      const entries = await readdir(dir);
      const out: T[] = [];
      const names = entries.filter((n) => n.endsWith(".json")).sort();
      for (const name of names) {
        const buf = await readFile(join(dir, name), "utf8");
        const value = JSON.parse(buf) as T;
        if (filter && !matchesFilter(value, filter)) continue;
        out.push(value);
      }
      return out;
    },

    async append(stream: string, record: unknown): Promise<void> {
      const file = streamPath(stream);
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, JSON.stringify(record) + "\n", "utf8");
    },
  };
}

function matchesFilter(value: unknown, filter: Record<string, unknown>): boolean {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  for (const [k, expected] of Object.entries(filter)) {
    if (obj[k] !== expected) return false;
  }
  return true;
}
