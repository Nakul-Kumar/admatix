# AdMatix Warehouse dbt

This dbt project materialises the Phase 2 warehouse on Supabase Postgres:
bronze fixture views, silver conformed tables, SCD-2 Kimball dimensions, and
gold facts. The marts layer is reserved for WP-O.

## Setup

```bash
cd warehouse/dbt
python3 -m venv .venv
. .venv/bin/activate
pip install "dbt-postgres==1.8.*"
set -a
. /opt/admatix/.build/secrets.env
set +a
export DBT_PROFILES_DIR=profiles
dbt deps
```

The tracked `profiles/profiles.yml` parses `SUPABASE_DB_URL` at runtime. Do not
copy the connection string into this repo.

## Standard Commands

```bash
dbt seed
dbt snapshot
dbt build
dbt test
dbt docs generate
dbt docs serve
```

Generated docs live under `warehouse/dbt/target/`:

- `target/index.html` for the browsable lineage graph
- `target/manifest.json` for machine-readable lineage
- `target/catalog.json` for relation and column metadata

`target/`, `dbt_packages/`, and local profile overrides are build output and are
gitignored.

## Notes

- `ledger.*`, `app.*`, and `sim.*` are declared as sources. Warehouse models only
  read them; no dbt model mutates the ledger.
- Criteo, Hillstrom, Avazu, iPinYou, and simulator bronze views are zero-row-safe
  in Phase 2. WP-P/WP-Q can land data later without changing downstream names.
- `dim_campaign`, `dim_ad_set`, and `dim_creative` read dbt snapshots and expose
  `valid_from`, `valid_to`, and `is_current` for SCD-2 history.
