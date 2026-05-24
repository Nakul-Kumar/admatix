# Evidence Live Roadmap Report

Status: ready for merge from `codex/evidence-live-roadmap`
Commit: `b9a07b7` plus README/report/schema-hardening follow-up on this branch
Date: 2026-05-24

## What Shipped

- The proof dashboard now makes `/` and `/artifacts` the primary accepted
  evidence view and labels the rest of the dashboard as Demo Lab.
- The artifact view states that it is not a continuous live ad-account feed and
  shows "What this proves / What this does not prove" above the fold.
- `proof-dashboard/scripts/validate-data-origin.mjs` now checks for the critical
  dashboard honesty copy and Demo Lab separation.
- `docs/architecture/LIVE-DATA-EVIDENCE-ARCHITECTURE.md` documents the evidence
  hierarchy, H0 doctrine, dataset roadmap, KPI taxonomy, ER map, and live pilot
  path.
- `warehouse/migrations/0005_live_data_readiness.sql` adds the live-data bridge:
  connector syncs, raw platform reports, raw entity snapshots, raw conversion
  events, pre-registered experiment designs, and immutable proof bundles.
- `scripts/db/apply-migrations.ts` now includes
  `0005_live_data_readiness.sql`.
- `scripts/db/apply-migrations.ts` and
  `scripts/db/generate-dictionary.ts` can validate against disposable databases
  through `SUPABASE_DB_URL` and `ADMATIX_DB_SSL=0`, so migration tests do not
  need production Supabase secrets.

## Data Integrity Fixes From Review

The first schema draft had three risks. They were fixed before merge:

- Raw landing tables now have unique indexes to prevent connector retry
  duplicates.
- `app.proof_bundles` is append-only by privilege and trigger. `admatix_app`
  receives only `INSERT,SELECT` on proof bundles. Draft bundles are not allowed
  in this immutable table; bundles must be inserted with a final public status.
- `app.experiment_designs` blocks updates/deletes after pre-registration,
  versions superseding designs through `design_version`, and records
  `supersedes_experiment_design_id` instead of mutating pre-registered plans.
- The base migration now creates the `extensions` schema and sets helper
  function search paths so `pgcrypto.digest()` resolves in both Supabase-style
  and vanilla PostgreSQL 17 databases.

## Disposable Postgres Validation

The migration stack was validated on the VPS in a disposable Postgres 17 Docker
container. This did not touch Supabase production data.

Evidence from the final successful run:

```text
REMOTE_FILES
0000_extensions_roles_helpers.sql 3739
0001_ledger_schema.sql 16551
0002_app_schema.sql 59593
0003_warehouse_bronze_silver.sql 755
0004_sim_bench_schemas.sql 26761
PASS:1
APPLY:0000_extensions_roles_helpers.sql
APPLY:0001_ledger_schema.sql
APPLY:0002_app_schema.sql
APPLY:0003_warehouse_bronze_silver.sql
APPLY:0004_sim_bench_schemas.sql
APPLY:0005_live_data_readiness.sql
PASS:2
APPLY:0000_extensions_roles_helpers.sql
APPLY:0001_ledger_schema.sql
APPLY:0002_app_schema.sql
APPLY:0003_warehouse_bronze_silver.sql
APPLY:0004_sim_bench_schemas.sql
APPLY:0005_live_data_readiness.sql
table_count=31
proof_bundles_exists=true
raw_platform_reports_exists=true
proof_bundles_admatix_app_grants=INSERT,SELECT
proof_status_allows_draft=false
experiment_key_version_unique=true
experiment_supersedes_column=true
IMMUTABILITY_OK
MIGRATIONS_OK
```

The disposable gate caught one real portability bug before merge: the base
migration assumed Supabase's `extensions.digest` location. The final migration
fix creates the `extensions` schema explicitly and sets helper-function
`search_path = public, extensions`, so a clean PostgreSQL 17 clone reproduces
the schema.

## Dashboard Verification

Commands run locally:

```bash
cd proof-dashboard
npm ci
npm run validate:origin
npm run check:data
npm run typecheck
npm run build
```

Repository gates run locally after the final README/schema hardening:

```text
pnpm install                                     PASS
pnpm -r typecheck                               PASS
pnpm test                                       PASS, 31 files / 227 tests, 2 skipped
pnpm scan-secrets                               PASS
pnpm audit:prod                                 PASS
pnpm demo                                       PASS, 8/8 demo steps green
git diff --check                                PASS
```

Python note: `pnpm run test:python` was attempted from the laptop's global
Python 3.13 environment. The ingest/simulator/evidence core subset passed
`45/45`, but verifier/validation suites that require optional science
dependencies failed because the global environment is missing `econml`,
`causalml`, and `arviz`. This branch does not change verifier/validation code;
the final proof artifacts remain the accepted CX-2/CX-3/CX-4 outputs already
merged on `main`.

Live checks:

- `https://admatix.tech/artifacts` returned `200`.
- `https://www.admatix.tech/artifacts` returned `200`.
- `https://admatix.tech/data/artifacts/manifest.json` returned `200` with
  `origin.kind = "artifact"`.
- The live bundle contains the new copy: "Artifact-backed proof snapshot",
  "not a continuous live ad-account feed", "No live spend-lift claim", "Demo
  Lab", and "Simulated head-to-head benchmark deltas".

## Claim Boundary

Allowed: AdMatix has an artifact-backed proof package showing a deterministic
dry-run control loop, calibrated simulator/verifier behavior, public aggregate
RCT/backtest recovery, and real LLM lane accounting inside a simulated
benchmark.

Not allowed: AdMatix has proven live paid-media lift, guarantees ROAS, or
autonomously mutates customer spend.

## Remaining Work

- Apply `0005_live_data_readiness.sql` to Supabase only when the team is ready
  to start shadow live-data ingestion.
- Add real connector implementations behind read-only OAuth/CSV imports.
- Run a pre-registered live geo/holdout pilot before making any live spend-lift
  claim.
