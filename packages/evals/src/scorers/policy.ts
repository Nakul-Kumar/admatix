import type { BenchmarkResult, BenchmarkTask } from "@admatix/schemas";
import type { Scorer } from "../types.js";

export const policyScorer: Scorer = {
  id: "policy",
  score(_task: BenchmarkTask, _output: unknown): Partial<BenchmarkResult> {
    throw new Error("not implemented");
  },
};
