# DB Replay Constraints Hardening Report

Status: branch implementation  
Date: 2026-05-25

## What Changed

- Added `warehouse/migrations/0006_diligence_replay_constraints.sql`.
- Added the migration to `scripts/db/apply-migrations.ts`.
- Added opt-in migration replay tests under `tests/db/`.
- Added `tests/db/**/*.test.ts` to the root Vitest include list so DB
  hardening tests are discoverable.

## Hardening Added

- `app.approval_receipts` receives `expires_at` and `signature` columns when the
  table exists.
- Relational app tables get DB-level replay guards:
  - one terminal approval receipt per tenant/action;
  - one terminal receipt per tenant/packet/action tuple;
  - one execution diff per tenant/action.
- Approval receipt constraints check that:
  - `expires_at` is after `decided_at` when both exist;
  - `signature` is either null for legacy rows or a 64-character hex HMAC.
- Generic Store-style `id/body` tables get JSONB unique indexes when those
  columns exist:
  - unique receipt id;
  - unique receipt action id;
  - unique execution-diff action id.

## Compatibility

The migration is introspective because AdMatix currently has two relevant data
shapes:

- canonical relational app tables from the warehouse migration plan;
- generic Supabase Store tables with `id text` and `body jsonb` used by the
  Store implementation and tests.

The migration enforces whichever constraints are possible for the shape present
and avoids assuming both shapes exist.

## Verification

The new DB test is skipped by default and only runs when
`ADMATIX_TEST_POSTGRES_URL` points at a disposable empty Postgres database. It
refuses to run if an `app` schema already exists, so it cannot accidentally
drop a real AdMatix schema.

Commands run locally on this branch:

- `pnpm install` -- passed.
- `pnpm -r typecheck` -- passed.
- `pnpm exec turbo run test --concurrency=1` -- passed.
- `pnpm test` -- passed; 32 files passed, 3 skipped, including the opt-in DB
  replay test.
- `pnpm exec vitest run tests/db/diligence-replay-constraints.test.ts` --
  discovered the DB test and skipped it safely without `ADMATIX_TEST_POSTGRES_URL`.
- `pnpm scan-secrets` -- passed.
- `pnpm audit:prod` -- passed.

The actual duplicate-constraint assertions require a disposable Postgres
database and `psql`; they are intentionally not run against production Supabase
or the existing AdMatix app schema.
