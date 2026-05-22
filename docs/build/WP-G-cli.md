# WP-G — CLI

**Owns:** `apps/cli/**`
**Branch:** `wp/g-cli` · **Wave:** 3 · **Depends on:** schemas, core, connectors, evidence, policy, agents, evals
**Suggested agent:** Claude Code · **Size:** medium

## Goal
The `admatix` command-line tool — the product is usable with no web app. Every command
supports `--json`. Read tools and write-shaped tools are clearly separated; nothing
mutates a platform.

## Files to create
- `apps/cli/package.json` — name `admatix`, `bin` → `admatix`, deps on all workspace packages used.
- `apps/cli/tsconfig.json`.
- `apps/cli/src/index.ts` — `commander` program wiring.
- `apps/cli/src/commands/` — `doctor.ts`, `fixtures.ts`, `audit.ts`, `plan.ts`,
  `packet.ts`, `activate.ts`, `approve.ts`, `measure.ts`, `reflect.ts`,
  `benchmark.ts`, `report.ts`.
- `apps/cli/src/*.test.ts` — including a golden-output snapshot test for `audit`.

## Contract
Commands (master plan §7.2): `admatix init|doctor|fixtures seed|audit|plan|packet show|
activate|approve|measure|reflect|rollback|benchmark run|report build`. The CLI is a
thin surface — `audit` calls `runAudit`, `plan` calls `runWorkflow`, `benchmark run`
calls `runSuite`, `packet show` reads the `Store`. Rules:
- `--json` produces machine-readable output on every command.
- `activate` requires `--dry-run`; without it the command refuses and exits non-zero
  (no write path exists in the MVP).
- The process exits non-zero whenever PolicyGuard blocks an action.
- Errors are actionable: name the bad input and how to fix it.

## Acceptance tests
1. `admatix audit --account fixture:agency-demo --json` emits valid JSON with 3-5 findings.
2. `admatix activate h0_001 --dry-run` never writes; without `--dry-run` it refuses.
3. An invalid account ref returns an actionable error and a non-zero exit code.
4. `admatix benchmark run --suite safety-v1` prints a scorecard.
5. A golden-output snapshot test for `admatix audit` is stable across runs.

## Definition of Done
Acceptance tests pass + global DoD. The 5-minute demo flow (Orchestration §1) runs
entirely through this CLI.

## Dispatch
Generic dispatch prompt, `<ID>=G`.
