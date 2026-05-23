# WP-O Report — Gold marts, DDL, and data dictionary

Branch: `wp/o-marts-dictionary`

## Shipped

- Added six table-materialized, `mart`-tagged dbt marts:
  - `mart_campaign_performance`
  - `mart_pacing`
  - `mart_waste`
  - `mart_verification`
  - `mart_agent_safety`
  - `mart_evidence_coverage`
- Added mart `.yml` descriptions, column descriptions, key tests, enum tests,
  and one singular invariant test per mart.
- Added `bench.*` dbt sources required by `mart_agent_safety`.
- Added `scripts/db/generate-dictionary.ts`, which reads
  `/opt/admatix/.build/secrets.env`, connects to Supabase via `SUPABASE_DB_URL`,
  cross-references `warehouse/dbt/target/manifest.json`, and regenerates:
  - `docs/data-dictionary.md`
  - `warehouse/ddl/generated.sql`
  - `warehouse/ddl/erd.md`
- Added `docs/runbooks/data-dictionary.md`.
- Fixed the Phase 2 ledger verifier ordering bug so it checks numeric `seq`
  order once the ledger has 10+ rows.

Note: local `pg_dump` is version 16 while Supabase is Postgres 17. The generator
uses the documented embedded `information_schema` fallback and remains
idempotent.

## Verification

```text
pnpm install
Done in 1.8s

pnpm -r typecheck
Scope: 11 of 12 workspace projects
All workspace typechecks passed.

pnpm typecheck
Tasks: 18 successful, 18 total
tsc -p tsconfig.json passed.

pnpm -r test
All workspace test runs passed.

pnpm exec turbo run test --concurrency=1
Tasks: 18 successful, 18 total
Cached: 18 cached, 18 total

cd warehouse/dbt && dbt build --select tag:mart
Done. PASS=42 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=42

cd warehouse/dbt && dbt test --select tag:mart
Done. PASS=36 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=36

cd warehouse/dbt && dbt build && dbt test
dbt build: PASS=149 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=149
dbt test:  PASS=104 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=104

cd warehouse/dbt && dbt docs generate
Catalog written to warehouse/dbt/target/catalog.json

pnpm tsx scripts/db/generate-dictionary.ts
data-dictionary-ok: documented 73 tables and 1022 columns
Second run idempotency diff line count: 0

pnpm tsx scripts/db/verify-ledger-chain.ts
ledger-chain-ok: checked 25 rows

ADMATIX_STORE=supabase pnpm tsx scripts/demo.ts
Demo complete — 8/8 steps green, 1 unsafe action blocked, 3 findings, 3 H0 packets.

python3 -m venv .venv && . .venv/bin/activate && python -m pip install -q pytest && pytest
1 passed in 0.18s

pnpm scan-secrets
scan-secrets: no token-shaped secrets found.
```
