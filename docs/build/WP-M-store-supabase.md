# WP-M — Store on Supabase (`packages/core` Store implementation)

**Owns:** `packages/core/src/store-supabase.ts`,
`packages/core/src/store-supabase.test.ts`, the `createStore` factory in
`packages/core/src/store.ts` (extend, do not break), `packages/core/package.json`
(add `pg` dep)
**Branch:** `wp/m-store-supabase` · **Phase:** 2 · **Wave:** 1
**Depends on:** WP-L migrations applied to Supabase
**Suggested agent:** Claude Opus 4.7 · **Size:** medium

## Goal
Add a **Supabase Postgres** implementation of the existing `Store` interface
defined in `packages/core/src/store.ts`. Zero call-site changes anywhere else in
the repo: every existing consumer (agents, evidence ledger, policy events, API,
CLI) continues to use `createStore(...)` exactly as today. Selection between the
filesystem and Postgres backends is driven by environment, not by changing
callers.

## Required reading
1. `packages/core/src/store.ts` — the current `Store` interface and the
   filesystem implementation. The Postgres implementation must satisfy the
   SAME interface, byte-for-byte semantics where they matter (ordering of
   `list`, append-only behavior of `append`).
2. `docs/architecture/DATA-LAYER-DDL.md` Part 2 (`app` schema) — the target
   tables (`app.h0_packets`, `app.proposed_actions`, `app.policy_decisions`,
   `app.execution_diffs`, `app.approval_receipts`, `app.rollback_checkpoints`,
   `app.outcome_measurements`, `app.trust_scores`, `app.agent_runs`,
   `app.audits`).
3. `docs/architecture/PROOF-WAVE-MASTER-PLAN.md` §5.2.
4. `docs/build/WP-L-migrations.md` — schemas must be applied before this WP can
   pass tests.
5. `AGENTS.md` — golden rules.

## Connection
Tests and runtime read `/opt/admatix/.build/secrets.env` (ABSOLUTE path) for
`SUPABASE_DB_URL`. **Tests skip** with a clear message if the env var is missing
(so contributors without credentials can still run the rest of the suite). On
the VPS the var is present and the tests run against the real Supabase project.

## Files to create / modify
- `packages/core/src/store-supabase.ts` — `createSupabaseStore(opts: {
  connectionString: string })` returning a `Store`.
  - `put(collection, id, value)`: `INSERT … ON CONFLICT (id) DO UPDATE …`
    against the table corresponding to the collection. Maps logical collection
    names (`h0_packets`, `proposed_actions`, `policy_decisions`,
    `execution_diffs`, `approval_receipts`, `rollback_checkpoints`,
    `outcome_measurements`, `trust_scores`, `agent_runs`, `audits`) to the
    matching `app.*` table.
  - `get(collection, id)`: `SELECT body FROM app.<collection> WHERE id = $1`.
  - `list(collection, filter?)`: `SELECT body FROM app.<collection>` with
    JSON-path filter pushdown for simple equality filters; falls back to
    in-memory filter when the filter shape isn't a plain `{ key: value }`.
    Result order matches the filesystem store (id ascending).
  - `append(stream, record)`: routes to `ledger.action_events` via the existing
    insert path defined in `DATA-LAYER-DDL.md` Part 1 — the trigger computes
    `entry_hash` / `prev_hash` server-side. The TypeScript code only supplies
    `tenant_id`, `stream`, `payload_jsonb`, and `payload_hash`.
- `packages/core/src/store.ts` — extend (do **not** break) the existing
  `createStore` so it returns the filesystem Store by default and the Supabase
  Store when called as `createStore({ backend: "supabase", connectionString })`
  OR when `process.env.ADMATIX_STORE === "supabase"` and `SUPABASE_DB_URL` is
  set. Keep all existing call sites green.
- `packages/core/src/store-supabase.test.ts` — vitest. Uses a clean
  per-test-run tenant prefix to isolate from prior runs (no truncates of the
  live DB). Round-trip tests: put/get, list with and without filter, list
  ordering, append-then-read-back via a small SELECT helper, and one test that
  proves the trigger refused a mismatched `payload_hash` (negative case).
- `packages/core/package.json` — add `pg` to dependencies; add `@types/pg` to
  devDependencies. No other workspace package changes.

## Contract
- Public type `Store` is unchanged. The Supabase implementation MUST satisfy
  the existing interface — no new methods, no method signature changes.
- `createStore()` with no args continues to return the filesystem store rooted
  at `./data`. Existing tests must still pass without `SUPABASE_DB_URL`.
- Never edit `packages/schemas/**`.
- Never UPDATE/DELETE on `ledger.*` (the role can't, but be explicit in code too).
- Connection pool is created lazily, closed on `process.exit`/`SIGINT`.

## Acceptance tests
1. `pnpm -r typecheck` green.
2. `pnpm -r test` green when `SUPABASE_DB_URL` is unset (Supabase suite skips
   with a clear `it.skip` message; existing 175+ tests stay green).
3. With `SUPABASE_DB_URL` set, `pnpm --filter @admatix/core test` runs the
   Supabase suite and all round-trip + ordering + filter + append tests pass.
4. Toggling `ADMATIX_STORE=supabase` and re-running the existing Phase 1 demo
   (`pnpm tsx scripts/demo.ts`) still exits 0 and produces the same logical
   transcript (timestamps may differ; H0 packet ids and policy decisions match).
5. No file in `packages/schemas/**` is modified.

## Definition of Done
Acceptance tests pass + golden DoD. A reviewer can prove this is a drop-in
backend swap by reading one diff in `store.ts` and one new file
`store-supabase.ts`.

## Dispatch
Generic dispatcher, `<ID>=M`, model `opus`. Dispatch in Phase 2 Wave 1 in
parallel with WP-L; if WP-L hasn't merged yet, the Supabase tests will skip and
acceptance #3 will run after WP-L lands. WP-M must merge **after** WP-L.
