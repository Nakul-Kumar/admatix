import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  BenchmarkResult,
  BenchmarkRun,
  type BenchmarkTask,
} from "@admatix/schemas";
import { baselines } from "./baselines/index.js";
import { findRepoRoot, readJson } from "./paths.js";
import { evidenceScorer } from "./scorers/evidence.js";
import { policyScorer } from "./scorers/policy.js";
import { stateDiffScorer } from "./scorers/state-diff.js";
import { loadTasks } from "./task.js";
import type { RunSuiteOptions, Scorer, Store } from "./types.js";

const DETERMINISTIC_FALLBACK_CREATED_AT = "1970-01-01T00:00:00.000Z";

const POLICY_VERSION_FALLBACK = "policy-v1";
const FIXTURE_VERSION_FALLBACK = "unknown";
const MODEL_FALLBACK = "none";

export async function runSuite(
  suite: string,
  deps: { store: Store },
  opts: RunSuiteOptions = {},
): Promise<BenchmarkRun> {
  const root = opts.rootDir ?? findRepoRoot();
  const baselineId = opts.baseline ?? "admatix";
  const runner = baselines[baselineId];
  if (!runner) {
    throw new Error(`runSuite: unknown baseline "${baselineId}" (have: ${Object.keys(baselines).join(", ")})`);
  }

  const tasks = await loadTasks(suite, { rootDir: root });
  const results: BenchmarkResult[] = [];
  for (const task of tasks) {
    const output = runner(task);
    const partial = mergeScorers(task, output);
    const result = BenchmarkResult.parse({
      task_id: task.task_id,
      passed: false,
      score: 0,
      unsafe_write_attempted: false,
      budget_cap_violation: false,
      hallucinated_id: false,
      evidence_coverage: 0,
      rollback_coverage: 0,
      notes: [],
      ...partial,
    });
    results.push(result);
  }

  const pinned = resolvePinned(root, suite, opts);
  const summary = summarise(results);
  // Determinism: same fixture + code + policy + model + results → same id.
  // AGENTS.md §10 (pin everything in evals) and #8 (deterministic where
  // possible). Reruns yield a byte-stable persisted file.
  const run_id = makeRunId(suite, pinned, results);
  const created_at = opts.clock ? opts.clock() : new Date().toISOString();
  const run = BenchmarkRun.parse({
    run_id,
    suite,
    results,
    pinned,
    summary,
    created_at,
  });
  await deps.store.put("benchmark_runs", run.run_id, run);
  return run;
}

function mergeScorers(task: BenchmarkTask, output: unknown): Partial<BenchmarkResult> {
  const partials = scorerOrder(task.kind).map((s) => s.score(task, output));
  let merged: Partial<BenchmarkResult> = { task_id: task.task_id };
  const notes: string[] = [];
  for (const p of partials) {
    if (Array.isArray(p.notes)) notes.push(...p.notes);
    const { notes: _ignored, ...rest } = p;
    merged = { ...merged, ...rest };
  }
  if (notes.length > 0) merged.notes = notes;
  return merged;
}

function scorerOrder(kind: BenchmarkTask["kind"]): Scorer[] {
  switch (kind) {
    case "audit":
      return [evidenceScorer];
    case "safety":
      return [policyScorer];
    case "evidence":
      return [evidenceScorer];
    case "state_diff":
      return [stateDiffScorer];
    case "policy":
      return [policyScorer];
  }
}

function summarise(results: BenchmarkResult[]): Record<string, number> {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const unsafeAttempts = results.filter((r) => r.unsafe_write_attempted).length;
  const budgetCapViolations = results.filter((r) => r.budget_cap_violation).length;
  const hallucinatedIds = results.filter((r) => r.hallucinated_id).length;
  const meanScore = total === 0 ? 0 : results.reduce((acc, r) => acc + r.score, 0) / total;
  const meanEvidence = total === 0 ? 0 : results.reduce((acc, r) => acc + r.evidence_coverage, 0) / total;
  const meanRollback = total === 0 ? 0 : results.reduce((acc, r) => acc + r.rollback_coverage, 0) / total;
  return {
    total,
    passed,
    failed: total - passed,
    unsafe_write_attempts: unsafeAttempts,
    budget_cap_violations: budgetCapViolations,
    hallucinated_ids: hallucinatedIds,
    mean_score: round(meanScore, 4),
    mean_evidence_coverage: round(meanEvidence, 4),
    mean_rollback_coverage: round(meanRollback, 4),
  };
}

function resolvePinned(
  root: string,
  suite: string,
  opts: RunSuiteOptions,
): BenchmarkRun["pinned"] {
  return {
    fixture_version: opts.fixtureVersion ?? readFixtureVersion(root),
    code_version: opts.codeVersion ?? readPackageVersion(root),
    policy_version: opts.policyVersion ?? readPolicyVersion(root, suite),
    model: opts.model ?? MODEL_FALLBACK,
  };
}

function readFixtureVersion(root: string): string {
  const path = join(root, "data", "fixtures", "google_ads", "demo_campaigns.json");
  if (!existsSync(path)) return FIXTURE_VERSION_FALLBACK;
  try {
    const json = readJson<{ fixture_version?: string }>(path);
    return json.fixture_version ?? FIXTURE_VERSION_FALLBACK;
  } catch {
    return FIXTURE_VERSION_FALLBACK;
  }
}

function readPackageVersion(root: string): string {
  const path = join(root, "packages", "evals", "package.json");
  if (!existsSync(path)) return "0.0.0";
  try {
    const json = readJson<{ version?: string }>(path);
    return json.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readPolicyVersion(root: string, suite: string): string {
  const path = join(root, "data", "benchmarks", suite, "policy-version");
  if (!existsSync(path)) return POLICY_VERSION_FALLBACK;
  try {
    return readJson<{ version?: string }>(path).version ?? POLICY_VERSION_FALLBACK;
  } catch {
    return POLICY_VERSION_FALLBACK;
  }
}

function makeRunId(
  suite: string,
  pinned: BenchmarkRun["pinned"],
  results: BenchmarkResult[],
): string {
  // Deterministic fingerprint of the run (suite + pins + results). Same
  // inputs → same id; rerunning produces an idempotent write.
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ suite, pinned, results }))
    .digest("hex");
  return `run_${suite}_${fingerprint.slice(0, 16)}`;
}

// Exposed for tests / future callers that want a stable timestamp.
export { DETERMINISTIC_FALLBACK_CREATED_AT };

function round(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
