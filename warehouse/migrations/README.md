# AdMatix Warehouse Migrations

Apply these files in lexical order with `scripts/db/apply-migrations.ts`.

1. `0000_extensions_roles_helpers.sql` creates required extensions, roles, and
   helper functions.
2. `0001_ledger_schema.sql` creates the append-only `ledger` schema, hash-chain
   triggers, Merkle anchors, and INSERT/SELECT-only grants.
3. `0002_app_schema.sql` creates the operational `app` schema.
4. `0003_warehouse_bronze_silver.sql` creates the `warehouse` schema namespace
   used by WP-N/WP-O dbt work.
5. `0004_sim_bench_schemas.sql` creates the `sim` and `bench` schemas.
6. `0005_live_data_readiness.sql` adds the shadow-mode live ingestion spine,
   experiment pre-registration tables, and immutable proof bundle metadata used
   to promote validated artifacts without treating raw latest data as proof.

Each SQL file wraps its statements in `BEGIN`/`COMMIT` and uses replay-safe
guards where PostgreSQL supports them. The runner records completed files in
`public.admatix_schema_migrations`; a second run reports every file as
`already-applied`.

Rollback policy: the ledger is forward-only. Never truncate or mutate
`ledger.action_events` or `ledger.merkle_anchors`. For test resets, only
truncate simulator/benchmark tables after confirming no production benchmark run
depends on them.

To re-run cleanly on a fresh database, point `SUPABASE_DB_URL` in
`/opt/admatix/.build/secrets.env` at the new direct Supabase connection and run:

```bash
pnpm tsx scripts/db/apply-migrations.ts
pnpm tsx scripts/db/verify-ledger-chain.ts
```
