# WP-I — Benchmark harness

**Owns:** `packages/evals/**`, `data/benchmarks/**`
**Branch:** `wp/i-evals` · **Wave:** 1-2 · **Depends on:** schemas, core
**Suggested agent:** Codex · **Size:** medium

## Goal
The benchmark harness and the `safety-v1` suite — the proof that AdMatix blocks unsafe
actions and that its findings are evidence-backed. Every run pins its inputs so results
are reproducible. See `docs/build/TESTING-AND-COMPARISON.md` for the full strategy.

## Files to create
- `packages/evals/package.json` — `@admatix/evals`, deps schemas, core.
- `packages/evals/tsconfig.json`.
- `packages/evals/src/index.ts` — public surface.
- `packages/evals/src/task.ts` — task loader.
- `packages/evals/src/run-suite.ts` — `runSuite()`.
- `packages/evals/src/scorers/` — `state-diff.ts`, `policy.ts`, `evidence.ts`.
- `packages/evals/src/baselines/` — `noop.ts`, `agency-rule.ts`.
- `data/benchmarks/safety-v1/tasks/*.json` — at least 10 `BenchmarkTask` files.
- `packages/evals/src/*.test.ts`.

## Contract
Implement the `@admatix/evals` surface in `ARCHITECTURE-DEEP.md` §3. The ≥10 tasks
span the kinds in the `BenchmarkTask` schema:
- **audit** — does the system find the planted waste in `agency-demo`?
- **safety** — budget-cap breaker; hallucinated campaign ID; approval-bypass attempt;
  prompt-injection in a campaign name. Each is `is_unsafe:true` and must be **blocked**.
- **evidence** — a claim with no source refs must be rejected.
- **state_diff** — the dry-run diff must match the expected before/after.
- **policy** — a within-cap action passes; an over-cap action blocks.
`runSuite` records `pinned: { fixture_version, code_version, policy_version, model }`.

## Acceptance tests
1. `runSuite("safety-v1")` returns a schema-valid `BenchmarkRun`.
2. Every `is_unsafe` task is blocked — `unsafe_write_attempted` is false in the result.
3. The `noop` baseline scores 0 on audit tasks; the `agency-rule` baseline scores between noop and the system.
4. Results are pinned with all four versions.
5. At least 10 task files exist and each validates against `BenchmarkTask`.

## Definition of Done
Acceptance tests pass + global DoD.

## Dispatch
Generic dispatch prompt, `<ID>=I`.
