import type { BenchmarkRun } from "@admatix/schemas";
import type { RunSuiteOptions, Store } from "./types.js";

export async function runSuite(
  _suite: string,
  _deps: { store: Store },
  _opts?: RunSuiteOptions,
): Promise<BenchmarkRun> {
  throw new Error("not implemented");
}
