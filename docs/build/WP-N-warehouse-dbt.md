# WP-N — Warehouse dbt project (`warehouse/dbt`)

**Owns:** `warehouse/dbt/**`, `docs/runbooks/dbt.md`
**Branch:** `wp/n-warehouse-dbt` · **Phase:** 2 · **Wave:** 2
**Depends on:** WP-L (migrations applied to Supabase) and WP-M (Store on
Supabase) merged
**Suggested agent:** Codex 5.5 · **Size:** large

## Goal
Stand up the AdMatix dbt project against the live Supabase Postgres 17 project
(Solenode) on top of the schemas WP-L created (`warehouse`, `app`, `ledger`,
`sim`, `bench`). Materialise the medallion (bronze → silver → gold) on top of
the physical tables already defined in `docs/architecture/DATA-LAYER-DDL.md`
Parts 3–5, with conformed Kimball dimensions (SCD-2 on
`dim_campaign`/`dim_ad_set`/`dim_creative`) and fact tables that bridge the
analytical warehouse to the governance ledger. The marts layer
(`mart_campaign_performance`, etc.) is owned by WP-O and is out of scope here;
WP-N must leave the folders, naming, and lineage ready for WP-O to extend.

This is the **first** Phase 2 Wave 2 work package and must merge before WP-O.

## Required reading (in this order)
1. `docs/architecture/PROOF-WAVE-MASTER-PLAN.md` §5.4 (medallion bronze/silver),
   §5.5 (the Kimball star: dimensions + facts, with explicit SCD-2 on
   campaign / ad set / creative), §5.7 (sim/bench schemas — these are read-only
   sources for the warehouse), §5.8 (governance: lineage, tests, dictionary).
2. `docs/architecture/DATA-LAYER-DDL.md` Parts 3, 4, 5, 6 — the physical bronze,
   silver, gold dim, gold fact, and sim/bench tables. The dbt models MUST
   materialise into the table names and column shapes defined there; do not
   invent columns, types, or relations.
3. `docs/build/WP-L-migrations.md` and the migrations themselves at
   `warehouse/migrations/0000_extensions_roles_helpers.sql`,
   `0001_ledger_schema.sql`, `0002_app_schema.sql`,
   `0003_warehouse_bronze_silver.sql`, `0004_sim_bench_schemas.sql` — the
   already-created schemas and the source tables WP-N reads from.
4. `docs/build/WP-M-store-supabase.md` — confirms `app.h0_packets`,
   `app.proposed_actions`, `app.policy_decisions`, `app.outcome_measurements`
   etc. are populated through the Store backend; `fct_campaign_action` and
   `fct_outcome` read from those tables plus `ledger.action_events`.
5. `docs/build/AUTONOMOUS-WAVE-PLAN.md` Phase 2 section — the one-line scope
   for WP-N and the Phase 2 gate.
6. `AGENTS.md` golden rules — especially: never edit `packages/schemas`, never
   mutate `ledger.*`, idempotent everywhere, no live platform calls, no
   secrets committed.

## Connection — from this work package only
Read **`/opt/admatix/.build/secrets.env`** (ABSOLUTE path — the file is
gitignored and is NOT inside the worktree). Use the `SUPABASE_DB_URL` key
(direct connection string, IPv6, `sslmode=require`). The dbt `profiles.yml`
loads this connection string at runtime from the env (it MUST NOT hard-code
the URL). Never copy the URL into a tracked file, log, or commit message.

Recommended Phase 2 source-data baseline: Phase 2 does not yet ingest the
public datasets (those land in Phase 3 / WP-P). For bronze sources WP-N
materialises, where the real data lives only in `packages/connectors/fixtures`
(i.e. `data/fixtures/{google_ads,meta_ads,dv360,first_party}`), seed a small
dbt seed CSV under `warehouse/dbt/seeds/` that mirrors the fixture rows so the
bronze → silver → gold pipeline has non-empty inputs end-to-end. Real
public-dataset bronze tables (`warehouse.bronze_criteo_uplift`,
`bronze_hillstrom`, `bronze_avazu`, `bronze_ipinyou`, `bronze_first_party_orders`)
remain empty in Phase 2 — the dbt source declarations exist for them, and
silver/gold models that depend on them must degrade gracefully (zero rows in,
zero rows out, all tests still pass).

## Files to create
- `warehouse/dbt/dbt_project.yml` — project name `admatix_warehouse`, profile
  `admatix_supabase`, model paths under `models/`, snapshot path under
  `snapshots/`, seed path under `seeds/`. Materialisations: bronze = `view`,
  silver = `table`, marts/dims = `table`, marts/facts = `incremental` keyed on
  the natural identity column. Tags: `bronze`, `silver`, `dim`, `fact`,
  `mart` (mart tag is reserved for WP-O; WP-N attaches `bronze`/`silver`/
  `dim`/`fact` only).
- `warehouse/dbt/packages.yml` — declare `dbt-labs/dbt_utils` (latest 1.x) and
  `dbt-labs/codegen` (latest 0.x) as packages.
- `warehouse/dbt/profiles/profiles.yml` — TEMPLATE only (no secrets). Target
  `dev` reads `host`, `user`, `pass`, `dbname`, `port` from `SUPABASE_DB_URL`
  via dbt's `env_var()` macro pattern. Document in
  `docs/runbooks/dbt.md` exactly how the operator sources
  `/opt/admatix/.build/secrets.env` before running dbt. The repo's
  `.gitignore` must already cover any local `profiles.yml` overrides; if it
  doesn't, add the rule.
- `warehouse/dbt/models/sources.yml` — declare every WP-L-created table that
  bronze/silver read from as a dbt `source`:
  - Schema `warehouse` (bronze): `bronze_criteo_uplift`, `bronze_hillstrom`,
    `bronze_avazu`, `bronze_ipinyou`, `bronze_sim_events`,
    `bronze_platform_metrics`, `bronze_first_party_orders`. Mark sources with
    `loaded_at_field: _loaded_at` so `dbt source freshness` works once Phase 3
    ingestion runs.
  - Schema `app`: `h0_packets`, `proposed_actions`, `policy_decisions`,
    `execution_diffs`, `approval_receipts`, `outcome_measurements`,
    `agent_runs`, `ad_accounts`, `tenants`, `policies`.
  - Schema `ledger`: `action_events`, `merkle_anchors` — declared **read-only**
    in the source description; no model may UPDATE/INSERT these (the dbt role
    is `admatix_readonly` for the ledger schema anyway, but be explicit).
  - Schema `sim`: `scenarios`, `campaigns`, `true_effects`, `events`.
- `warehouse/dbt/seeds/*.csv` — small CSV seeds derived from
  `data/fixtures/{google_ads,meta_ads,dv360,first_party}` so bronze has
  rows to flow downstream in Phase 2 (a handful of rows is enough — the goal
  is shape, not volume). Document each seed in `warehouse/dbt/seeds/seeds.yml`
  with column types and descriptions.
- `warehouse/dbt/models/bronze/*.sql + *.yml` — one model per source where
  Phase 2 adds value (e.g. a `bronze_platform_metrics_fixture` view union-ing
  fixture seeds into the same shape as `warehouse.bronze_platform_metrics`).
  Bronze models materialise as **views** over the physical source tables and
  preserve the four ingest-metadata columns (`_loaded_at`, `_source`,
  `_batch_id`, `_row_hash`).
- `warehouse/dbt/models/silver/*.sql + *.yml` — cleaned/typed/deduplicated,
  conformed to the schema names already in the contract:
  - `silver_campaign_daily` (conformed to `CampaignDailyMetric`).
  - `silver_creative_daily`.
  - `silver_first_party_daily` (conformed to `FirstPartyRevenueDaily`).
  - `silver_conversions`.
  - `silver_treatment_assignment` (unified treatment/control/exposure from
    Criteo Uplift, Hillstrom, and simulator; empty until those bronzes have
    rows — Phase 3).
  - `silver_auctions` (from iPinYou; same caveat).
  Each silver model materialises as a `table` into the `warehouse` schema and
  is keyed by the unique constraint already defined in the physical table.
- `warehouse/dbt/snapshots/dim_campaign_snapshot.sql`,
  `dim_ad_set_snapshot.sql`, `dim_creative_snapshot.sql` — dbt snapshot
  configs producing SCD-2 history with `valid_from`, `valid_to`, `is_current`
  columns. Strategy: `check` on the mutable attribute set (e.g. for
  `dim_campaign`: `name`, `objective`, `status`, `budget`, `bid_strategy`).
  Source is the corresponding `app` table (e.g. `app.campaigns` once it
  exists; for Phase 2, source from the seed-derived bronze + silver so the
  snapshot mechanic is exercised end-to-end). Snapshots write to the
  `warehouse` schema with a `_snapshot` suffix; the conformed `dim_*` model
  reads the snapshot.
- `warehouse/dbt/models/marts/dims/*.sql + *.yml` — the conformed Kimball
  dimensions named in master plan §5.5 and physically defined in DATA-LAYER
  Part 4: `dim_date`, `dim_account`, `dim_campaign`, `dim_ad_set`,
  `dim_creative`, `dim_geo`, `dim_audience`, `dim_platform`, `dim_device`.
  - `dim_date` is materialised from a generated date-range macro
    (`dbt_utils.date_spine`) seeded with the project's reporting window
    (default: 2020-01-01 → 2030-12-31; configurable via `vars`).
  - `dim_campaign` / `dim_ad_set` / `dim_creative` SELECT from their
    snapshots and project `valid_from`, `valid_to`, `is_current`.
  - All other dims are Type 1: materialise as `table` keyed by the surrogate
    key column defined in DATA-LAYER Part 4 (e.g. `dim_account.account_key`).
  - All dim models tagged `dim`.
- `warehouse/dbt/models/marts/facts/*.sql + *.yml` — the conformed fact
  tables from DATA-LAYER Part 5: `fct_impressions`, `fct_clicks`,
  `fct_conversions`, `fct_spend_daily`, `fct_campaign_action`, `fct_outcome`.
  - All fact models materialise as `incremental` keyed on the surrogate
    identity column from the physical table.
  - `fct_campaign_action` JOINs `app.h0_packets` ⨝ `app.proposed_actions` ⨝
    `app.policy_decisions` ⨝ `app.approval_receipts` ⨝ `app.outcome_measurements`
    and additionally enriches with `ledger.action_events` via `tx_id` to
    populate `tx_id`/risk/policy-result columns. `ledger.action_events` is
    SELECT-only.
  - `fct_outcome` SELECTs from `app.outcome_measurements` and (for
    simulator-sourced rows only) joins to `sim.true_effects` on
    `scenario_id` to populate `ground_truth_lift`.
  - All fact models tagged `fact`.
- `warehouse/dbt/tests/*.sql` — custom singular tests, at minimum:
  - `assert_spend_non_negative.sql` — every silver / fact model with a spend
    or cost column has `spend >= 0` / `cost >= 0`.
  - `assert_conversions_le_clicks.sql` — for any silver/fact row that has
    both, `conversions <= clicks`.
  - `assert_scd2_no_overlap.sql` — for each SCD-2 snapshot, no two rows for
    the same business key have overlapping `[valid_from, valid_to)` windows.
  - `assert_scd2_one_current.sql` — for each SCD-2 snapshot, at most one row
    per business key has `is_current = true`.
  - `assert_ledger_not_mutated.sql` — sanity probe: the dbt role can only
    SELECT from `ledger.*` (an attempted UPDATE/INSERT raises). This may be
    implemented as a dbt `run-operation` rather than a model test if simpler;
    document the choice.
- `warehouse/dbt/models/*.yml` (schema files alongside each layer) — every
  model has a `description:`, every column has a `description:`, and every
  model has at least one `test:` (a mix of `not_null`, `unique`,
  `relationships`, `accepted_values`, plus the custom tests above).
- `warehouse/dbt/README.md` — how to install, how to source secrets, the
  commands an operator runs (`dbt deps`, `dbt seed`, `dbt snapshot`,
  `dbt build`, `dbt test`, `dbt docs generate`, `dbt docs serve`), and the
  documented artifact path for the generated lineage (e.g.
  `warehouse/dbt/target/index.html` + `manifest.json`). Note that the
  `target/` directory is build output and must not be committed except for the
  `manifest.json`/`catalog.json` pair the README points to as the
  due-diligence artifact (or, alternatively, document publishing them to a
  `warehouse/dbt/docs-site/` path under git).
- `docs/runbooks/dbt.md` — operator runbook: prerequisites
  (`python3 -m venv`, `pip install dbt-postgres==1.8.*`), how to source
  `/opt/admatix/.build/secrets.env`, the standard commands, how to re-run
  cleanly on a fresh database, how to interpret a failing test, and the
  rebuild-from-empty procedure (silver/gold are rebuildable; `ledger` is
  forward-only and NEVER touched).

## Contract (must hold)
- Every dbt model is **idempotent**: `dbt build` followed immediately by a
  second `dbt build` is a no-op the second time (incremental models with the
  `unique_key` set; SCD-2 snapshots converge with no new rows when the source
  is unchanged).
- Bronze/silver/gold materialise into the existing physical table names from
  DATA-LAYER-DDL Parts 3, 4, 5. Where dbt's default materialisation would
  conflict with the WP-L-created physical table, configure the model with the
  `pre_hook`/`post_hook` and `alias` so dbt writes INTO that table rather than
  dropping and recreating it.
- `ledger.action_events` and `ledger.merkle_anchors` are **read-only**. No
  model, snapshot, hook, or operation may UPDATE, INSERT, DELETE, or TRUNCATE
  them. The dbt connection runs as `admatix_app` (or `admatix_readonly` if
  the operator chooses to restrict further), but the rule is enforced in
  review, not only by privileges.
- SCD-2 snapshots for `dim_campaign`, `dim_ad_set`, `dim_creative` produce
  rows with non-null `valid_from`, monotonically advancing `valid_to`, and
  exactly one `is_current = true` row per business key at any time.
- Every model has at least one test. Every column on every model has a
  description.
- No code or commit may contain a Supabase connection string. `profiles.yml`
  reads it from `SUPABASE_DB_URL` via `env_var()`.
- Never edit `packages/schemas/**`. Never modify any file under
  `warehouse/migrations/**` — WP-N reads what WP-L created and adds dbt
  models alongside.
- `pnpm -r typecheck && pnpm exec turbo run test --concurrency=1` on the
  TypeScript monorepo stays green after merge (this WP touches no TS).

## Acceptance tests
1. From the worktree root, with `/opt/admatix/.build/secrets.env` sourced:
   `cd warehouse/dbt && dbt deps && dbt seed && dbt snapshot && dbt build`
   against `SUPABASE_DB_URL` exits 0.
2. `cd warehouse/dbt && dbt test` exits 0; **every** model registered in the
   project has at least one passing test (verified by `dbt test --select
   '*' --output json` — no model appears with zero tests).
3. The three SCD-2 snapshots (`dim_campaign_snapshot`, `dim_ad_set_snapshot`,
   `dim_creative_snapshot`) exist in `warehouse` schema and each has rows
   with non-null `valid_from`, `valid_to` (nullable only on `is_current=true`
   rows), and `is_current`. The snapshot-overlap and one-current custom tests
   pass.
4. `cd warehouse/dbt && dbt docs generate` exits 0 and produces a navigable
   lineage graph under `warehouse/dbt/target/` (`manifest.json`,
   `catalog.json`, `index.html`). The path is documented in
   `warehouse/dbt/README.md` as the published artifact.
5. Running `dbt build` a second time immediately after the first exits 0 and
   reports zero rows changed for incremental models and snapshots
   (idempotency).
6. `pnpm -r typecheck && pnpm exec turbo run test --concurrency=1` is green
   on the merge branch (Phase 1 / Phase 2 Wave 1 demo unaffected).
7. `pnpm tsx scripts/db/verify-ledger-chain.ts` (from WP-L) still exits 0
   end-to-end — the dbt run has not mutated the ledger.
8. The Phase 1 demo (`pnpm tsx scripts/demo.ts` with `ADMATIX_STORE=supabase`)
   still passes end-to-end after the dbt build.

## Definition of Done
All eight acceptance tests pass + golden DoD from `AGENTS.md`. The runbook is
accurate (a reviewer can follow it from a clean shell and reproduce a green
`dbt build && dbt test`). The dbt lineage graph is generated and its
location is documented. WP-O can extend `models/marts/` without touching any
of the bronze/silver/dim/fact models WP-N landed.

## Dispatch
Generic dispatcher, `<ID>=N`, model `codex`. Run first in Phase 2 Wave 2 (WP-O
depends on WP-N being merged).

```bash
bash /opt/admatix/scripts/dispatch-wp.sh \
  N \
  wp/n-warehouse-dbt \
  warehouse/dbt \
  docs/build/WP-N-warehouse-dbt.md \
  codex
```
