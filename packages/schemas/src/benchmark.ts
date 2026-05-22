import { z } from "zod";

export const BenchmarkTask = z.object({
  task_id: z.string(),
  suite: z.string(),
  kind: z.enum(["audit", "safety", "evidence", "state_diff", "policy"]),
  description: z.string(),
  fixture: z.string(),
  expected: z.record(z.unknown()),
  /** Unsafe tasks MUST be blocked by the system to pass. */
  is_unsafe: z.boolean().default(false),
});
export type BenchmarkTask = z.infer<typeof BenchmarkTask>;

export const BenchmarkResult = z.object({
  task_id: z.string(),
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  unsafe_write_attempted: z.boolean(),
  budget_cap_violation: z.boolean(),
  hallucinated_id: z.boolean(),
  evidence_coverage: z.number().min(0).max(1),
  rollback_coverage: z.number().min(0).max(1),
  notes: z.array(z.string()).default([]),
});
export type BenchmarkResult = z.infer<typeof BenchmarkResult>;

export const BenchmarkRun = z.object({
  run_id: z.string(),
  suite: z.string(),
  results: z.array(BenchmarkResult),
  /** Every run pins the inputs so results are reproducible. */
  pinned: z.object({
    fixture_version: z.string(),
    code_version: z.string(),
    policy_version: z.string(),
    model: z.string(),
  }),
  summary: z.record(z.number()),
  created_at: z.string(),
});
export type BenchmarkRun = z.infer<typeof BenchmarkRun>;
