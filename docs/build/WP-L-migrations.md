# WP-L — Supabase migrations (`warehouse/migrations`)

**Owns:** `warehouse/migrations/**`, `scripts/db/apply-migrations.ts`,
`scripts/db/verify-ledger-chain.ts`, `docs/runbooks/db-migrations.md`
**Branch:** `wp/l-migrations` · **Phase:** 2 · **Wave:** 1 · **Depends on:** Phase 1 merged
**Suggested agent:** Codex 5.5 · **Size:** medium

## Goal
Land the AdMatix data layer on the live Supabase Postgres 17 project (Solenode).
This is the **first** Phase 2 work package and must be applied before any other
Phase 2 work can land. Translates `docs/architecture/DATA-LAYER-DDL.md` into a
versioned, replayable, idempotent migration set, applies it against
`SUPABASE_DB_URL`, and verifies the result.

## Required reading (in this order)
1. `docs/architecture/DATA-LAYER-DDL.md` — the **authoritative** DDL. Apply it
   top-to-bottom; do not invent columns, types, or constraints.
2. `docs/architecture/PROOF-WAVE-MASTER-PLAN.md` §5.2–5.3 (`ledger`, `app` schemas).
3. `docs/build/AUTONOMOUS-WAVE-PLAN.md` Phase 2 section.
4. `AGENTS.md` golden rules — especially: never edit `packages/schemas`, no live
   mutations, idempotent everywhere.

## Connection — from this work package only
Read **`/opt/admatix/.build/secrets.env`** (ABSOLUTE path — the file is gitignored
and is NOT inside the worktree). Use the `SUPABASE_DB_URL` key (direct connection
string, IPv6, `sslmode=require`). Apply migrations via `psql "$SUPABASE_DB_URL"
-v ON_ERROR_STOP=1 -f <file.sql>`. Never copy the URL into a tracked file, log,
or commit message.

## Files to create
- `warehouse/migrations/0000_extensions_roles_helpers.sql` — Part 0 of the DDL.
- `warehouse/migrations/0001_ledger_schema.sql` — Part 1 (ledger: `action_events`,
  `merkle_anchors`, hash-chain triggers, INSERT/SELECT-only grants).
- `warehouse/migrations/0002_app_schema.sql` — Part 2 (`tenants`, `accounts`,
  `h0_packets`, `proposed_actions`, `policy_decisions`, `execution_diffs`,
  `approval_receipts`, `rollback_checkpoints`, `outcome_measurements`,
  `trust_scores`, `agent_runs`).
- `warehouse/migrations/0003_warehouse_bronze_silver.sql` — Part 3 stub schemas
  (tables filled by WP-N; this file creates `warehouse` schema + extensions).
- `warehouse/migrations/0004_sim_bench_schemas.sql` — Part 6 (`sim`, `bench`).
- `warehouse/migrations/README.md` — order of application, rollback policy
  (ledger is forward-only; truncate only sim/bench), how to re-run cleanly on a
  fresh database.
- `scripts/db/apply-migrations.ts` — single Node entry point (`pnpm tsx
  scripts/db/apply-migrations.ts`). Reads `/opt/admatix/.build/secrets.env`, runs
  each migration file in order via `psql`, idempotent (each script wraps in
  `BEGIN; … COMMIT;` and uses `CREATE … IF NOT EXISTS` / `CREATE OR REPLACE`).
  Prints `applied: 0000_…`, `already-applied: …`, exits non-zero on failure.
- `scripts/db/verify-ledger-chain.ts` — independent verifier. Connects via `pg`,
  walks `ledger.action_events` in order, recomputes each row's `entry_hash` from
  the documented chain material, and asserts `entry_hash == expected` and
  `prev_hash == previous.entry_hash`. Exits 0 if the chain verifies on an empty
  table or after inserts. Used by Phase 2 gate.
- `docs/runbooks/db-migrations.md` — how to apply, how to verify, how to recover
  from a partial apply, the **never-truncate-ledger** rule.

## Contract (must hold)
- Every migration file is **idempotent and replayable**: applying twice is a
  no-op, never an error.
- `ledger` rows are append-only. The role `admatix_app` must have `INSERT,
  SELECT` on `ledger.*` and `UPDATE/DELETE` REVOKED. Verify with a test that
  attempts UPDATE and expects a permission error.
- All comments from `DATA-LAYER-DDL.md` are preserved (`COMMENT ON …`).
- All hash-chain triggers from Part 1 are present and active.
- The DDL applies cleanly to an empty database AND to a database that has
  already been partially migrated (idempotent guards everywhere).
- No live ad-platform calls; nothing in this work package touches external APIs
  beyond the Supabase Postgres endpoint.
- `pnpm install` adds runtime deps `pg` and `dotenv` at the root only if absent;
  no new TypeScript packages.

## Acceptance tests
1. `pnpm tsx scripts/db/apply-migrations.ts` exits 0 against the live Supabase
   project; running it a **second** time also exits 0 and reports every file as
   `already-applied`.
2. `psql "$SUPABASE_DB_URL" -c "\dn"` lists `ledger`, `app`, `warehouse`, `sim`,
   `bench`.
3. `psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM information_schema.tables
   WHERE table_schema IN ('ledger','app','sim','bench')"` matches the count
   implied by the DDL (≥ 13 — count is `ledger.action_events,
   ledger.merkle_anchors,` plus every `app.*` and `sim.*`/`bench.*` table named
   in DATA-LAYER-DDL.md).
4. `pnpm tsx scripts/db/verify-ledger-chain.ts` exits 0 on an empty ledger, and
   continues to exit 0 after a deterministic insertion-and-verify smoke run.
5. A direct `UPDATE ledger.action_events SET …` as `admatix_app` is **rejected**
   with a permission error (proves append-only enforcement).
6. `pnpm typecheck` is green for the two new TS scripts.

## Definition of Done
All six acceptance tests pass + golden DoD. The runbook is accurate. The
Phase 2 ledger-verifier exists and is wired in.

## Dispatch
Generic dispatcher, `<ID>=L`, model `codex`. Run first in Phase 2 Wave 1.
