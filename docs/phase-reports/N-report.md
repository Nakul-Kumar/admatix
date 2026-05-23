# WP-N Report — Warehouse dbt

Branch: `wp/n-warehouse-dbt`

## Shipped

- Created `warehouse/dbt` project `admatix_warehouse` with Supabase Postgres
  profile, package declarations, schema-name macro, source declarations, and
  dbt docs lineage output under `warehouse/dbt/target/`.
- Added Phase 2 fixture seeds derived from committed connector fixtures.
- Added bronze fixture/public-dataset views, silver conformed tables, SCD-2
  snapshots for campaign/ad set/creative, Kimball dimensions, and gold facts.
- Added singular dbt tests for spend/cost non-negativity, conversions <= clicks,
  SCD-2 overlap/current-row guarantees, and ledger append-only trigger presence.
- Added operator docs in `warehouse/dbt/README.md` and `docs/runbooks/dbt.md`.

Operational note: the Supabase-backed Phase 1 demo exposed a pre-existing Store
compatibility mismatch where WP-M writes generic `id`/`body` collections but the
live `app.*` tables are normalized. To complete WP-N acceptance without changing
non-WP source files, I applied a live app-schema compatibility shim in Supabase
for the Store collections. No `ledger.*` rows were updated/deleted/truncated.

## Verification

- `cd warehouse/dbt && dbt deps && dbt seed && dbt snapshot && dbt build`: PASS
  (`dbt build`: PASS=107 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=107).
- Second `dbt build`: PASS; incremental models and snapshots reported
  `INSERT 0 0`.
- `cd warehouse/dbt && dbt test`: PASS=68 WARN=0 ERROR=0 SKIP=0 NO-OP=0
  TOTAL=68.
- Per-model test coverage from `target/manifest.json`: `models=29 tests=68
  zero_test_models=0`. The installed dbt CLI does not support the spec's
  `dbt test --output json` option, so this was verified directly from the
  generated manifest.
- `cd warehouse/dbt && dbt docs generate`: PASS; generated
  `target/index.html`, `target/manifest.json`, and `target/catalog.json`.
- `pnpm install`: PASS.
- `pnpm -r typecheck`: PASS.
- `pnpm -r test`: PASS; each package run reported 175 passed / 1 skipped, and
  web reported 7 passed.
- `python3 -m venv .venv && . .venv/bin/activate && pip install -q pytest &&
  pytest`: PASS, 1 passed.
- `pnpm exec turbo run test --concurrency=1`: PASS, 18 successful / 18 total.
- `pnpm scan-secrets`: PASS, no token-shaped secrets found.
- `pnpm tsx scripts/db/verify-ledger-chain.ts`: PASS,
  `ledger-chain-ok: checked 1 rows`.
- `ADMATIX_STORE=supabase pnpm tsx scripts/demo.ts`: PASS, 8/8 demo steps
  green, 1 unsafe action blocked, 3 findings, 3 H0 packets.

