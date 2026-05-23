# WP-O — Gold marts, generated DDL, and the data dictionary (`warehouse/dbt/models/marts/`, `warehouse/ddl/`, `docs/data-dictionary.md`)

**Owns:** `warehouse/dbt/models/marts/<each mart>.sql + .yml`,
`warehouse/ddl/**`, `scripts/db/generate-dictionary.ts`,
`docs/data-dictionary.md`, `docs/runbooks/data-dictionary.md`
**Branch:** `wp/o-marts-dictionary` · **Phase:** 2 · **Wave:** 2
**Depends on:** WP-N (warehouse dbt project) merged
**Suggested agent:** Codex 5.5 · **Size:** medium

## Goal
Land the six denormalized consumer-facing **gold marts** named in master plan
§5.6 on top of the conformed dims and facts WP-N built, then export and
document the resulting warehouse: generate the DDL + an ER diagram into
`warehouse/ddl/` and produce a complete data dictionary at
`docs/data-dictionary.md` covering every model and every column in the
`warehouse`, `sim`, and `bench` schemas. This is the closing work package of
Phase 2 — its acceptance gate is the Phase 2 gate.

## Required reading (in this order)
1. `docs/architecture/PROOF-WAVE-MASTER-PLAN.md` §5.6 (the six marts and what
   each one feeds), §5.7 (sim/bench: the dictionary covers these too), §5.8
   (governance: lineage, dictionary, ER diagram as a due-diligence artifact).
2. `docs/architecture/DATA-LAYER-DDL.md` Parts 3–6 — the authoritative DDL
   the dictionary documents.
3. `docs/build/WP-N-warehouse-dbt.md` and the WP-N branch on `main` — the
   bronze/silver/gold lineage marts read from. WP-O extends WP-N's project,
   it does not duplicate it.
4. `docs/build/WP-L-migrations.md` — the WP-L migrations are the source of
   truth for the DDL the dictionary describes.
5. `docs/build/AUTONOMOUS-WAVE-PLAN.md` Phase 2 section — the Phase 2 gate
   that WP-O must turn green.
6. `AGENTS.md` golden rules — schemas are frozen, ledger is read-only,
   secrets only via `/opt/admatix/.build/secrets.env`, idempotent everywhere.

## Connection — from this work package only
Read **`/opt/admatix/.build/secrets.env`** (ABSOLUTE path — the file is
gitignored and is NOT inside the worktree). Use the `SUPABASE_DB_URL` key.
dbt continues to load the connection string via the `env_var()` pattern WP-N
established. The dictionary generator (`scripts/db/generate-dictionary.ts`)
connects via `pg` using the same env var. Never copy the URL into a tracked
file, log, or commit message.

## Files to create
- `warehouse/dbt/models/marts/mart_campaign_performance.sql + .yml` —
  spend, ROAS, CAC, MER, CTR, CVR by campaign × day. Sourced from
  `fct_spend_daily` ⨝ `fct_conversions` ⨝ `silver_first_party_daily` ⨝
  `dim_campaign` ⨝ `dim_account` ⨝ `dim_platform` ⨝ `dim_date`. Feeds the
  cockpit's campaign performance view. Materialised as `table`, tagged
  `mart`, keyed `(date_key, campaign_key)`.
- `warehouse/dbt/models/marts/mart_pacing.sql + .yml` — budget pacing vs.
  plan, projected overspend by campaign × day. Joins `fct_spend_daily` with
  `dim_campaign` (uses the SCD-2 row valid at the spend date for the budget
  attribute). Feeds the pacing detector. Tagged `mart`, keyed
  `(date_key, campaign_key)`.
- `warehouse/dbt/models/marts/mart_waste.sql + .yml` — identified wasted
  spend: campaigns with non-zero spend and zero conversions over a rolling
  window, "dead" keyword surfaces (where future signals are available),
  zero-conversion creatives. Sourced from `fct_spend_daily` ⨝
  `fct_conversions` ⨝ `dim_campaign` / `dim_creative`. Feeds the waste
  detector and the audit report. Tagged `mart`.
- `warehouse/dbt/models/marts/mart_verification.sql + .yml` — every H0
  outcome with its lift estimate, CI, method, verdict. Sourced from
  `fct_outcome` ⨝ `fct_campaign_action` ⨝ `dim_campaign` ⨝ `dim_account`
  ⨝ `dim_date`. Feeds the `admatix.verify` MCP tool and the Phase 5 proof
  report. Tagged `mart`, keyed `(date_key, h0_packet_id)`.
- `warehouse/dbt/models/marts/mart_agent_safety.sql + .yml` — benchmark /
  safety scoring per agent and per run. Sourced from `app.agent_runs` ⨝
  `app.policy_decisions` ⨝ `bench.runs` ⨝ `bench.results` (declare those as
  dbt sources in `warehouse/dbt/models/sources.yml` if WP-N hasn't already).
  Feeds the safety benchmark dashboard. Tagged `mart`, keyed
  `(run_id, agent_id)`.
- `warehouse/dbt/models/marts/mart_evidence_coverage.sql + .yml` — the
  fraction of proposed actions that ship with a complete H0 packet (the
  Section C comparison metric). Sourced from `app.h0_packets` ⨝
  `app.proposed_actions` ⨝ `app.policy_decisions` and joined against
  ledger-visible totals through `fct_campaign_action`. Tagged `mart`, keyed
  `(date_key, tenant_id)`.
- For each mart `.yml`: a top-level `description:`, a `description:` on
  every column, and `tests:` — at minimum `not_null` on key columns,
  `unique` on the natural key, `accepted_values` on enum columns, and one
  custom singular test per mart asserting a domain invariant (e.g. for
  `mart_waste`, `wasted_spend >= 0`; for `mart_verification`,
  `lift_ci_high >= lift_ci_low` or both null; for `mart_evidence_coverage`,
  `coverage_pct` between 0 and 1).
- `warehouse/ddl/generated.sql` — concatenated, schema-qualified DDL for
  every table in `warehouse`, `sim`, and `bench`. Generated from the live
  database via `pg_dump --schema-only --schema=warehouse --schema=sim
  --schema=bench` (or, equivalently, dbt's
  `dbt run-operation generate_source` + `dbt-codegen` macros). Whichever
  approach the agent picks, it MUST be reproducible from a documented
  script under `scripts/db/` and rerunnable as part of the dictionary
  refresh.
- `warehouse/ddl/erd.md` — Mermaid `erDiagram` block (or multiple, grouped
  by subject area: medallion bronze, silver, gold star, sim, bench) listing
  every table and the FKs between them. Generated from the same script that
  produces `generated.sql`; the README explains how to regenerate.
- `scripts/db/generate-dictionary.ts` — a single Node entry point
  (`pnpm tsx scripts/db/generate-dictionary.ts`) that:
  1. Reads `/opt/admatix/.build/secrets.env` and connects via `pg`.
  2. Queries `information_schema.tables` + `information_schema.columns` +
     `pg_description` (for `COMMENT ON` text) for the `warehouse`, `sim`,
     and `bench` schemas, plus the `app` and `ledger` tables that WP-N's
     dbt sources document.
  3. Cross-references the dbt `target/manifest.json` produced by
     `dbt docs generate` so each documented column inherits its lineage
     (the model + the source it ultimately derives from) and its test list.
  4. Emits `docs/data-dictionary.md` deterministically (sorted by schema,
     then table, then ordinal column position) so re-runs only change the
     file when the DDL or dbt descriptions have changed.
  5. Calls into the `pg_dump`-style script (or an embedded equivalent) to
     refresh `warehouse/ddl/generated.sql` and `warehouse/ddl/erd.md` in
     the same run.
  Exits non-zero (with a diff-style message) if any table or any column in
  the covered schemas has an empty description. Exit 0 means every column is
  documented.
- `docs/data-dictionary.md` — the generated artifact. Top-of-file frontmatter
  records: timestamp generated, source database (label only, never the URL),
  the script used to generate, and a "regenerate with" command. Body is
  sorted as above; for every column documents: type, nullability, default,
  description, source lineage (model / upstream source), and the dbt tests
  attached to it.
- `docs/runbooks/data-dictionary.md` — operator runbook: how to source the
  env file, how to run `pnpm tsx scripts/db/generate-dictionary.ts`, how to
  read the diff, how to add a missing description (fix it in the dbt
  `.yml` and re-run), how the file relates to `warehouse/ddl/generated.sql`
  and `warehouse/ddl/erd.md`.

## Contract (must hold)
- The six marts are additive: WP-O does not touch any bronze, silver, dim,
  fact, snapshot, or source declared by WP-N. It adds new `.sql + .yml`
  files under `warehouse/dbt/models/marts/` and extends
  `warehouse/dbt/models/sources.yml` only with `bench.*` / `app.agent_runs`
  entries WP-N may not yet have declared.
- Every mart materialises as a `table` (read-optimised, denormalised), is
  tagged `mart`, has a top-level description, has a column-level description
  on every column, and has at least one test (per the spec above).
- `dbt build --select tag:mart` builds only the marts (no upstream rebuild
  required when WP-N's models are already materialised).
- `warehouse/ddl/generated.sql` and `warehouse/ddl/erd.md` are regenerable
  by a documented script; both must be regenerated before merge so they
  reflect the post-WP-O state.
- `docs/data-dictionary.md` is **complete**: every table and every column in
  `warehouse`, `sim`, and `bench` schemas has a non-empty description. The
  generator script asserts this and exits non-zero otherwise.
- Never edit `packages/schemas/**`. Never modify any file under
  `warehouse/migrations/**`. Never modify any file owned by WP-N
  (bronze/silver/dim/fact models, snapshots, sources WP-N declared) except
  to ADD new source entries to `sources.yml`.
- Never UPDATE/INSERT/DELETE/TRUNCATE on `ledger.*` — `fct_campaign_action`
  reads `ledger.action_events` via WP-N's fact; WP-O's marts read from
  WP-N's facts, never from `ledger.*` directly.
- No secrets in any committed file. `SUPABASE_DB_URL` reaches code only via
  `/opt/admatix/.build/secrets.env`.

## Acceptance tests
1. The six marts exist as dbt models under
   `warehouse/dbt/models/marts/`: `mart_campaign_performance`,
   `mart_pacing`, `mart_waste`, `mart_verification`, `mart_agent_safety`,
   `mart_evidence_coverage`. From the worktree root, with
   `/opt/admatix/.build/secrets.env` sourced:
   `cd warehouse/dbt && dbt build --select tag:mart` exits 0.
2. `warehouse/ddl/generated.sql` exists, is non-empty, and contains a
   `CREATE TABLE` entry for every table in `warehouse`, `sim`, and `bench`.
   `warehouse/ddl/erd.md` exists with at least one Mermaid `erDiagram` block.
   Both are regenerable via the documented script
   (`scripts/db/generate-dictionary.ts` or its companion); running the
   script a second time produces a no-op diff (idempotency).
3. `docs/data-dictionary.md` exists. The generator script
   (`pnpm tsx scripts/db/generate-dictionary.ts`) exits 0, proving every
   table and every column in `warehouse`, `sim`, and `bench` schemas has a
   non-empty description. A grep for blank descriptions over the file
   returns nothing.
4. `cd warehouse/dbt && dbt test --select tag:mart` exits 0; every mart
   has at least one passing test attached.
5. The Phase 1 demo (`pnpm tsx scripts/demo.ts` with
   `ADMATIX_STORE=supabase`) still passes end-to-end — the cockpit/API
   queries marts and is not broken by the new layer.
6. **Phase 2 gate:**
   - `cd warehouse/dbt && dbt build && dbt test` (both WP-N and WP-O models)
     exits 0.
   - `pnpm tsx scripts/db/verify-ledger-chain.ts` (from WP-L) exits 0
     end-to-end — the ledger chain is unbroken and untouched by WP-N/WP-O.
   - `pnpm -r typecheck && pnpm exec turbo run test --concurrency=1` is
     green on `main` after merge.
   - `pnpm tsx scripts/demo.ts` with `ADMATIX_STORE=supabase` exits 0.

## Definition of Done
All six acceptance tests pass + golden DoD from `AGENTS.md`. The Phase 2 gate
is green: the data layer is fully landed, fully tested, the marts feed the
consumer-facing surfaces, the warehouse is fully self-documenting (DDL + ERD
+ dictionary), and the Phase 1 demo still runs end-to-end with
`ADMATIX_STORE=supabase`. The orchestrator can close Phase 2 and open
Phase 3.

## Dispatch
Generic dispatcher, `<ID>=O`, model `codex`. Run after WP-N is merged
to `main` in Phase 2 Wave 2.

```bash
bash /opt/admatix/scripts/dispatch-wp.sh \
  O \
  wp/o-marts-dictionary \
  warehouse/dbt/models/marts \
  docs/build/WP-O-marts-dictionary.md \
  codex
```
