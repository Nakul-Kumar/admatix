# WP-K — Integration & demo

**Owns:** `tests/e2e/**`, `scripts/demo.ts`, `docs/runbooks/demo-script.md`, README status section
**Branch:** `wp/k-integration` · **Wave:** 4 · **Depends on:** all work packages
**Suggested agent:** Claude Code · **Size:** medium

## Goal
Wire the whole system into one runnable demo, prove it end-to-end, and write the
walkthrough. This work package is the day's finish line.

## Files to create
- `tests/e2e/demo-flow.test.ts` — the 8-step demo flow (Orchestration §1) as one test.
- `scripts/demo.ts` — a single command that runs audit → plan → packet → dry-run →
  block-an-unsafe-action → benchmark → ROI and prints a clean, narratable transcript.
- `docs/runbooks/demo-script.md` — the 5-minute walkthrough narration, timestamped,
  matching the actual `scripts/demo.ts` output.
- Update the README "Status" section to reflect what shipped.

## Contract
Imports only the public surfaces of the workspace packages and apps. Adds no domain
logic. If a wiring gap forces a change in another package, open a tiny separate PR
against that package's owner — never edit another WP's files inside `wp/k-integration`.

## Acceptance tests
1. `pnpm tsx scripts/demo.ts` runs the full flow on fixtures and exits 0.
2. `tests/e2e/demo-flow.test.ts` asserts all 8 demo steps and is green.
3. The demo blocks at least one unsafe action with a visible reason.
4. `docs/runbooks/demo-script.md` matches the real transcript line for line.
5. `pnpm typecheck && pnpm test` is green across the whole workspace.

## Definition of Done
Acceptance tests pass + global DoD. The demo is recordable in one take.

## Dispatch
Generic dispatch prompt, `<ID>=K`. Run last, after all other WPs are merged to `main`.
