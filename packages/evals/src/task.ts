import type { BenchmarkTask } from "@admatix/schemas";

export async function loadTasks(_suite: string, _opts?: { rootDir?: string }): Promise<BenchmarkTask[]> {
  throw new Error("not implemented");
}
