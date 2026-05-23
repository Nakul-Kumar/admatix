import type { BenchmarkTask } from "@admatix/schemas";
import type { BaselineOutput } from "../types.js";

export function noopBaseline(_task: BenchmarkTask): BaselineOutput {
  throw new Error("not implemented");
}
