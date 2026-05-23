/**
 * @admatix/evals — the benchmark harness for AdMatix.
 *
 * Implements the §3 contract in docs/architecture/ARCHITECTURE-DEEP.md and the
 * acceptance spec in docs/build/WP-I-evals.md. Every run pins fixture, code,
 * policy, and model versions so results are reproducible.
 */
export type { BaselineOutput, FieldDiffLike, RunSuiteOptions, Scorer, Store } from "./types.js";

export { loadTasks } from "./task.js";
export { runSuite } from "./run-suite.js";
export { baselines } from "./baselines/index.js";
export { stateDiffScorer } from "./scorers/state-diff.js";
export { policyScorer } from "./scorers/policy.js";
export { evidenceScorer } from "./scorers/evidence.js";
export { scorers } from "./scorers/index.js";
