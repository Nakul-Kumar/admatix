import { describe, expect, it } from "vitest";
import { BenchmarkRun, BenchmarkTask } from "@admatix/schemas";
import { baselines } from "./baselines/index.js";
import { runSuite } from "./run-suite.js";
import { loadTasks } from "./task.js";
import { memoryStore } from "./test-utils.js";

const SUITE = "safety-v1";

describe("WP-I acceptance — safety-v1", () => {
  it("1. runSuite returns a schema-valid BenchmarkRun", async () => {
    const store = memoryStore();
    const run = await runSuite(SUITE, { store });
    expect(() => BenchmarkRun.parse(run)).not.toThrow();
    expect(run.suite).toBe(SUITE);
    expect(run.results.length).toBeGreaterThanOrEqual(10);
    // Run was persisted under the right collection key.
    const persisted = await store.get<unknown>("benchmark_runs", run.run_id);
    expect(persisted).not.toBeNull();
  });

  it("2. every is_unsafe task is blocked — unsafe_write_attempted is false", async () => {
    const tasks = await loadTasks(SUITE);
    const taskById = new Map(tasks.map((t) => [t.task_id, t]));
    const run = await runSuite(SUITE, { store: memoryStore() });

    for (const result of run.results) {
      const task = taskById.get(result.task_id);
      expect(task, `task ${result.task_id} must be loaded`).toBeDefined();
      if (task && task.is_unsafe) {
        expect(
          result.unsafe_write_attempted,
          `is_unsafe task ${task.task_id} must not attempt an unsafe write`,
        ).toBe(false);
      }
    }
    expect(run.summary["unsafe_write_attempts"]).toBe(0);
    expect(run.summary["budget_cap_violations"]).toBe(0);
    expect(run.summary["hallucinated_ids"]).toBe(0);
  });

  it("3. noop scores 0 on audit; agency-rule scores between noop and system", async () => {
    const tasks = await loadTasks(SUITE);
    const auditTasks = tasks.filter((t) => t.kind === "audit");
    expect(auditTasks.length).toBeGreaterThan(0);

    const scoreFor = (baselineId: "noop" | "agencyRule" | "admatix") => {
      const runner = baselines[baselineId]!;
      let total = 0;
      for (const t of auditTasks) {
        const out = runner(t) as { estimated_waste_usd: number; findings: { detector: string; entity_id: string }[] };
        const expectedDetectors = (t.expected["expected_finding_detectors"] as string[] | undefined) ?? [];
        const wasteFloor = (t.expected["planted_waste_min_usd"] as number | undefined) ?? 0;
        const found = expectedDetectors.filter((d) => out.findings.some((f) => f.detector === d)).length;
        const detectorCoverage = expectedDetectors.length === 0 ? 1 : found / expectedDetectors.length;
        const wasteMet = out.estimated_waste_usd >= wasteFloor ? 1 : 0;
        total += detectorCoverage * wasteMet;
      }
      return total / auditTasks.length;
    };

    const noop = scoreFor("noop");
    const rule = scoreFor("agencyRule");
    const sys = scoreFor("admatix");

    expect(noop).toBe(0);
    expect(rule).toBeGreaterThan(noop);
    expect(rule).toBeLessThan(sys);
    expect(sys).toBeGreaterThan(0);
  });

  it("4. results are pinned with all four versions", async () => {
    const run = await runSuite(SUITE, { store: memoryStore() });
    expect(run.pinned.fixture_version).toMatch(/.+/);
    expect(run.pinned.code_version).toMatch(/.+/);
    expect(run.pinned.policy_version).toMatch(/.+/);
    expect(run.pinned.model).toMatch(/.+/);
    // The fixture version threads through from data/fixtures/.
    expect(run.pinned.fixture_version).toBe("demo-2026-05-22");
    // The code version threads through from packages/evals/package.json.
    expect(run.pinned.code_version).toBe("0.1.0");
    // No LLM in the MVP loop.
    expect(run.pinned.model).toBe("none");
  });

  it("5. at least 10 task files exist and each validates BenchmarkTask", async () => {
    const tasks = await loadTasks(SUITE);
    expect(tasks.length).toBeGreaterThanOrEqual(10);
    for (const task of tasks) {
      expect(() => BenchmarkTask.parse(task)).not.toThrow();
      expect(task.suite).toBe(SUITE);
    }
    // The suite must span all five BenchmarkTask kinds per the WP-I spec.
    const kinds = new Set(tasks.map((t) => t.kind));
    expect(kinds.has("audit")).toBe(true);
    expect(kinds.has("safety")).toBe(true);
    expect(kinds.has("evidence")).toBe(true);
    expect(kinds.has("state_diff")).toBe(true);
    expect(kinds.has("policy")).toBe(true);
  });
});

describe("runSuite — supporting invariants", () => {
  it("admatix baseline passes every task by its scorer", async () => {
    const run = await runSuite(SUITE, { store: memoryStore() });
    const failures = run.results.filter((r) => !r.passed);
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    expect(run.summary["mean_score"]).toBe(1);
  });

  it("policy_version override is honored", async () => {
    const run = await runSuite(SUITE, { store: memoryStore() }, { policyVersion: "policy-v9-test" });
    expect(run.pinned.policy_version).toBe("policy-v9-test");
  });

  it("rejects an unknown baseline id", async () => {
    await expect(
      // @ts-expect-error — deliberate runtime check.
      runSuite(SUITE, { store: memoryStore() }, { baseline: "does-not-exist" }),
    ).rejects.toThrow(/unknown baseline/);
  });

  it("propagates a clear error when the suite directory is missing", async () => {
    await expect(runSuite("not-a-suite", { store: memoryStore() })).rejects.toThrow(
      /cannot read benchmark suite/,
    );
  });

  // QA finding #10 (HIGH): two runs against the same fixtures/policy must
  // produce a byte-comparable persisted file. Previously run_id used
  // Math.random() and created_at used wall-clock, so reruns drifted.
  it("F10: run_id is deterministic for the same suite + pins + results", async () => {
    const fixedClock = () => "2026-05-22T12:00:00.000Z";
    const a = await runSuite(
      SUITE,
      { store: memoryStore() },
      { clock: fixedClock },
    );
    const b = await runSuite(
      SUITE,
      { store: memoryStore() },
      { clock: fixedClock },
    );
    expect(b.run_id).toBe(a.run_id);
    expect(b.created_at).toBe(a.created_at);
    // The full persisted shape should be byte-identical.
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
