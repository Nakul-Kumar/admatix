# Data Dictionary Runbook

The generated dictionary documents the `warehouse`, `sim`, and `bench` schemas,
plus the `app` and `ledger` tables that dbt uses as sources.

## Prerequisites

```bash
pnpm install
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

Never paste `SUPABASE_DB_URL` into a tracked file or shell transcript.

## Refresh

Build the marts and generate the dbt manifest first:

```bash
cd warehouse/dbt
dbt build --select tag:mart
dbt docs generate
cd ../..
pnpm tsx scripts/db/generate-dictionary.ts
```

The generator refreshes all three artifacts in one pass:

- `docs/data-dictionary.md`
- `warehouse/ddl/generated.sql`
- `warehouse/ddl/erd.md`

Run the command a second time before committing. A clean second run should
produce no diff.

## Fixing Missing Descriptions

The generator exits non-zero if a covered table or column has no description.
For dbt models, add the missing text in the model or source `.yml` file and run
`dbt docs generate` again. For physical source tables, add or fix `COMMENT ON`
text in the owning migration or DDL source, then rerun the generator.

## Reading Diffs

- Dictionary diffs should reflect real schema, description, lineage, or test
  changes.
- `generated.sql` is schema-only output from `pg_dump` for `warehouse`, `sim`,
  and `bench`.
- `erd.md` is generated from PostgreSQL foreign keys and column metadata.

The dictionary is a due-diligence artifact. Do not hand-edit generated outputs;
fix the dbt metadata or database comments and regenerate.
