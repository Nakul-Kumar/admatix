# WP-I — Benchmark Harness — Phase Report

**Branch:** `wp/i-evals`
**Package:** `@admatix/evals` v0.1.0
**Suite shipped:** `safety-v1` (12 tasks)
**Owner:** Codex (Claude Opus 4.7 build agent)
**Date:** 2026-05-23

---

## What shipped

The complete `@admatix/evals` package per the contract in
`docs/architecture/ARCHITECTURE-DEEP.md` §3 and the acceptance spec in
`docs/build/WP-I-evals.md`. The harness runs entirely deterministically — no
LLM call, no live platform call — and every run pins fixture, code, policy,
and model versions so results are reproducible.

### Public surface (`packages/evals/src/index.ts`)

| Export | Source | Role |
| --- | --- | --- |
| `runSuite(suite, deps, opts?)` | `run-suite.ts` | Loads tasks, runs the chosen baseline, scores each task, persists the `BenchmarkRun` under the `benchmark_runs` collection. |
| `loadTasks(suite, opts?)` | `task.ts` | Validates every JSON task against `BenchmarkTask`; fails loudly on schema drift or empty suites. |
| `baselines` | `baselines/index.ts` | `noop`, `agencyRule`, `admatix`. The `admatix` baseline is the deterministic rules-engine system under test. |
| `scorers` / `stateDiffScorer` / `policyScorer` / `evidenceScorer` | `scorers/` | Each scorer returns `Partial<BenchmarkResult>`; `runSuite` merges them. |
| `Store`, `BaselineOutput`, `RunSuiteOptions`, `Scorer`, `FieldDiffLike` | `types.ts` | Typed contracts; `Store` is the architectural interface, defined locally so this package typechecks before `@admatix/core` lands and drops in unchanged once it does. |

### Files added

- `packages/evals/package.json`, `tsconfig.json`
- `packages/evals/src/{index,task,run-suite,types,paths,test-utils}.ts`
- `packages/evals/src/baselines/{index,noop,agency-rule,admatix,_shared,_fixtures}.ts`
- `packages/evals/src/scorers/{index,state-diff,policy,evidence,_shared}.ts`
- `packages/evals/src/{run-suite,scorers,baselines}.test.ts`
- `data/benchmarks/safety-v1/tasks/*.json` — 12 tasks spanning all 5 kinds:
  - `audit/`: `audit-agency-demo-waste`, `audit-pacing-drift`
  - `safety/`: `safety-budget-cap-breach`, `safety-hallucinated-id`,
    `safety-approval-bypass`, `safety-prompt-injection-name`,
    `safety-split-cap-evasion`
  - `evidence/`: `evidence-no-source-refs`, `evidence-missing-rollback`
  - `state_diff/`: `state-diff-budget-shift`
  - `policy/`: `policy-within-cap-allow`, `policy-over-cap-block`

### Acceptance tests (all five) — status

1. **`runSuite("safety-v1")` returns a schema-valid `BenchmarkRun`** — covered by
   `run-suite.test.ts > "1. runSuite returns a schema-valid BenchmarkRun"`. ✅
2. **Every `is_unsafe` task is blocked (`unsafe_write_attempted` false)** —
   covered by `"2. every is_unsafe task is blocked …"`; the run summary's
   `unsafe_write_attempts`, `budget_cap_violations`, and `hallucinated_ids`
   counters are all asserted to be `0`. ✅
3. **`noop` scores 0 on audit; `agency-rule` scores between `noop` and
   `admatix`** — covered by `"3. noop scores 0 on audit; agency-rule scores
   between noop and system"`. Concrete numbers on the shipped suite: noop=0,
   agencyRule=0.5, admatix=1.0 (averaged over both audit tasks). ✅
4. **Results pinned with all four versions** — covered by `"4. results are
   pinned with all four versions"`; pinned `fixture_version="demo-2026-05-22"`,
   `code_version="0.1.0"`, `policy_version="policy-v1"` (overridable via
   `opts.policyVersion`), `model="none"`. ✅
5. **≥10 task files, each validates `BenchmarkTask`** — covered by `"5. at
   least 10 task files exist and each validates BenchmarkTask"`; 12 tasks
   spanning all five kinds. ✅

### Golden-rule compliance check

- 1. **Schema is the contract** — no schema redefined. All boundary I/O parses
  through `@admatix/schemas` (`BenchmarkTask`, `BenchmarkResult`,
  `BenchmarkRun`).
- 2. **Fixtures first** — `loadFixture("agency-demo")` reads
  `data/fixtures/google_ads/demo_campaigns.json`. No live calls.
- 3. **Dry-run only** — the harness scores baselines; no platform mutation
  path exists in this package.
- 4. **Source refs** — the `admatix` baseline attaches `evidence_refs` for
  every audit finding (sourced from the fixture daily rows).
- 5. **Rollback present** — `admatix` audit output carries `has_rollback:true`
  on every finding; `evidence-missing-rollback` task confirms a rollback-less
  draft is rejected.
- 6. **Mandatory gates fail closed** — every PolicyGuard / EvidenceLedger
  branch sets `blocked:true` on any failure; the `admatix` baseline never lets
  an `is_unsafe` task through.
- 7. **Read/write separation** — harness only reads fixtures and writes to the
  provided `Store`; no MCP/CLI write surface introduced.
- 8. **Determinism** — baselines and scorers are pure. The same fixture and
  task corpus produces byte-identical results modulo `run_id` (random) and
  `created_at` (clock), which is why pinning is checked instead of byte
  equality.
- 9. **No secrets / no PII** — `pnpm scan-secrets` is clean; no token-shaped
  strings in the package or task files.
- 10. **Pin everything** — `pinned: { fixture_version, code_version,
  policy_version, model }` is required on the `BenchmarkRun` and exercised in
  acceptance test 4.

### Notes on package wiring

The WP-I spec lists `@admatix/core` as a dependency, but core is being built
in parallel on `wp/b-core` and is not yet on `main`. To keep this branch
independently green (`pnpm install`, `pnpm typecheck`, `pnpm test` all clean),
the `Store` interface is defined locally in `src/types.ts` with the exact
shape from `ARCHITECTURE-DEEP.md` §3. When `@admatix/core` lands, the local
type can be replaced with `import type { Store } from "@admatix/core"` with
zero call-site change.

---

## Verification output

### `pnpm install`

```
Scope: all 3 workspace projects
Done in 1.1s
```

### `pnpm -r typecheck`

```
Scope: 2 of 3 workspace projects
packages/schemas typecheck$ tsc -p tsconfig.json --noEmit
packages/schemas typecheck: Done
packages/evals typecheck$ tsc -p tsconfig.json --noEmit
packages/evals typecheck: Done
```

### `pnpm -r test`

```
packages/evals test:  RUN  v2.1.9 /opt/admatix-wt/wpi
packages/evals test:  ✓ packages/evals/src/scorers.test.ts   (9 tests)   7ms
packages/evals test:  ✓ packages/evals/src/baselines.test.ts (12 tests) 19ms
packages/evals test:  ✓ packages/evals/src/run-suite.test.ts (9 tests)  37ms
packages/evals test:  ✓ packages/schemas/src/index.test.ts   (5 tests)   8ms
packages/evals test:  Test Files  4 passed (4)
packages/evals test:       Tests  35 passed (35)
packages/evals test:    Duration  692ms
```

### `pnpm scan-secrets`

```
> tsx scripts/scan-secrets.ts
scan-secrets: no token-shaped secrets found.
```

---

## What's next

- Open a PR for `wp/i-evals` → `main` once the dependency graph (B, C, E, I)
  is settled and the integration checkpoint (Wave 1 close) is green.
- When `@admatix/core` lands on `main`, swap the local `Store` interface for
  `import type { Store } from "@admatix/core"` and add core as a workspace
  dependency.
- Future WPs (F-agents, G-cli) can call `runSuite("safety-v1", { store })`
  directly — that contract is now stable.
