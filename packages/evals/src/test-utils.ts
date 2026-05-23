import type { Store } from "./types.js";

/** In-memory Store for harness tests. Pure, no I/O. */
export function memoryStore(): Store & { dump(): Record<string, Map<string, unknown>>; streams(): Record<string, unknown[]> } {
  const collections = new Map<string, Map<string, unknown>>();
  const streams = new Map<string, unknown[]>();
  const col = (name: string) => {
    const existing = collections.get(name);
    if (existing) return existing;
    const fresh = new Map<string, unknown>();
    collections.set(name, fresh);
    return fresh;
  };
  return {
    async put<T>(collection: string, id: string, value: T) {
      col(collection).set(id, value);
    },
    async get<T>(collection: string, id: string) {
      return (col(collection).get(id) as T | undefined) ?? null;
    },
    async list<T>(collection: string) {
      return Array.from(col(collection).values()) as T[];
    },
    async append(stream: string, record: unknown) {
      const list = streams.get(stream) ?? [];
      list.push(record);
      streams.set(stream, list);
    },
    dump() {
      return Object.fromEntries(collections);
    },
    streams() {
      return Object.fromEntries(streams);
    },
  };
}
