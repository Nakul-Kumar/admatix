import type { BenchmarkResult, BenchmarkTask } from "@admatix/schemas";
import type { Scorer } from "../types.js";

export const evidenceScorer: Scorer = {
  id: "evidence",
  score(_task: BenchmarkTask, _output: unknown): Partial<BenchmarkResult> {
    throw new Error("not implemented");
  },
};
