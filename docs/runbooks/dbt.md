# dbt Runbook

This runbook is for the Phase 2 Supabase warehouse dbt project at
`warehouse/dbt`.

## Prerequisites

- Python 3.11+.
- Supabase direct Postgres URL stored only at `/opt/admatix/.build/secrets.env`
  as `SUPABASE_DB_URL`.
- WP-L migrations applied successfully.

```bash
cd /opt/admatix-wt/N/warehouse/dbt
python3 -m venv .venv
. .venv/bin/activate
pip install "dbt-postgres==1.8.*"
set -a
. /opt/admatix/.build/secrets.env
set +a
export DBT_PROFILES_DIR=profiles
dbt deps
```

## Build

Run in this order:

```bash
dbt seed
dbt snapshot
dbt build
dbt test
dbt docs generate
```

`dbt docs generate` writes `target/index.html`, `target/manifest.json`, and
`target/catalog.json`. Serve locally with:

```bash
dbt docs serve
```

## Clean Rebuild

Silver and gold warehouse relations are rebuildable. The ledger is forward-only
and must never be truncated or rewritten.

For a clean warehouse rebuild:

```bash
dbt seed --full-refresh
dbt snapshot
dbt build --full-refresh
dbt test
```

If SCD-2 fixture snapshots must be reset in a disposable development database,
drop only the three warehouse snapshot tables and rerun `dbt snapshot`:

```sql
drop table if exists warehouse.dim_campaign_snapshot cascade;
drop table if exists warehouse.dim_ad_set_snapshot cascade;
drop table if exists warehouse.dim_creative_snapshot cascade;
```

Do not drop, truncate, update, or delete from `ledger.action_events` or
`ledger.merkle_anchors`.

## Interpreting Failures

- `assert_spend_non_negative`: a bronze/silver/fact row contains negative spend
  or cost; inspect the upstream bronze row and reject or correct the ingest.
- `assert_conversions_le_clicks`: a row reports more conversions than clicks;
  inspect attribution and deduplication before shipping the model.
- `assert_scd2_no_overlap` / `assert_scd2_one_current`: snapshot validity windows
  are inconsistent; reset only the warehouse snapshot tables in development, then
  rerun `dbt snapshot`.
- `assert_ledger_not_mutated`: the WP-L append-only ledger protection triggers
  are missing; stop and reapply migrations before running warehouse builds.

## Fresh Database Procedure

1. Apply WP-L migrations.
2. Run `dbt deps`.
3. Run `dbt seed && dbt snapshot && dbt build && dbt test`.
4. Run `pnpm tsx scripts/db/verify-ledger-chain.ts` from the repo root to prove
   the dbt run did not break the ledger chain.
