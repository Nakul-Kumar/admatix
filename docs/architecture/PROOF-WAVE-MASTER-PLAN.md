# AdMatix — The Proof Wave: Master Architecture & Execution Plan

**Date:** 2026-05-22
**Prepared for:** Nakul Kumar
**Status:** Plan for review and approval. Execution starts when you greenlight + paste the two creds in §11.
**Companion docs:** `AdMatix_Strategy_Markets_Moat_OpenSource_2026-05-22.md` (the strategy), and the existing in-repo build corpus at `admatix/docs/`.

---

## 0. How to read this

This is the plan for one large wave — the **Proof Wave** — whose job is to take AdMatix from "a scaffold + a strategy" to "a production-grade system that can simulate ad campaigns on real datasets and demonstrate, research-grade, that evidence-gated verification actually works" — the proof you take into the YC application.

Sections 1–8 are the **architecture** (what we are building). Sections 9–13 are the **execution plan** (how I drive the build with Claude Code + Codex, in phases, and what I need from you). If you only read two things, read §2 (what "proof" means) and §9 (the phased plan).

---

## 1. Where things actually stand — recon findings

I inspected the real state before planning. Five findings shape everything below:

1. **`admatix/` already exists as a strong scaffold — but it lives *inside* the ChappieForge monorepo.** The folder `Agentic AI Project/admatix/` has a git remote pointing at `github.com/Nakul-Kumar/ChappieForge.git`. It is not its own repo yet.

2. **`github.com/Nakul-Kumar/admatix` is empty.** The standalone repo you created has nothing pushed to it. Phase 0 extracts the scaffold into it cleanly.

3. **Only the schema contract is built.** `packages/schemas` is implemented and tested (8 Zod schema files). The other 11 work packages (WP-A…WP-K — core, connectors, evidence, policy, agents, CLI, MCP, evals, API/web, integration) are **specced but not coded**. The product is ~10% built.

4. **The existing plan is a deliberately narrow 72-hour MVP.** It is excellent, but its own `ARCHITECTURE-DEEP.md` §9 explicitly scopes *out* the four things this wave needs: **Postgres, causal-lift claims, real datasets, and an LLM in the loop.** The MVP is TypeScript, fixtures-only, dry-run-only. That is the right floor — but it is a floor, not the proof.

5. **The testing methodology is already half-Python.** `TESTING-AND-COMPARISON.md` is genuinely strong and already names the real tools — OBP, GeoLift, CausalImpact, Criteo Uplift, AuctionNet, `pytest`. The verification science was always going to be Python. This wave makes that explicit and builds it.

**Conclusion:** we do **not** restart. We extract the scaffold, execute the MVP work packages, and then extend the system with the three things that turn an MVP into proof — a real **data layer**, a **simulation + verification engine**, and a **research-grade validation harness**. The strategy doc's "Mode 1 = read-only / observe" maps exactly onto this: the proof wave is Mode 1, run against simulated and public data, no live ad spend anywhere.

---

## 2. The wave goal — and what "proof" means for YC

**Goal of the Proof Wave:** a production-grade AdMatix that can (a) ingest real public ad datasets, (b) simulate ad campaigns where the true incremental effect is *known by construction*, (c) run the full evidence-gated loop — agent proposes → AdMatix gates → logs → independently verifies — and (d) produce a reproducible, honestly-caveated demonstration that the verification engine recovers truth.

**What YC actually counts as proof** (from the research — YC sources, 2025-26):

- ~40% of funded YC companies are funded as "just an idea." Pre-revenue is normal. The real bar is **clarity** (who is the customer, what have you built) — not traction.
- For *software*, YC expects a **live, working product or demo** — not a mockup. A Figma-style prototype is acceptable for hardware; software is expected to run.
- The single highest-signal thing is **what each founder has built** — one concrete, impressive artifact beats any claim. A 2-person technical team should make it unambiguous that the founders build the product themselves.
- The most reliable lever is **visible progress between application and interview** — ship, then ship more.
- An application **video** (≈1 min, both founders, unscripted) materially raises interview odds; for a product that can't be in the room, a **demo video** is the substitute.

**What makes a verification-engine demo "research-grade"** (from the research — SBC, Haus, Meridian):

The credible validation stack — and our Phase 4 acceptance bar — is:

1. **Ground-truth recovery on a generative simulator** — simulate campaigns where the true incremental lift is known; check the engine recovers it.
2. **Simulation-Based Calibration (SBC)** — rank-statistic uniformity; proves the Bayesian estimator is correctly implemented.
3. **Confidence-interval coverage** — an 80% interval must contain truth ~80% of the time.
4. **RMSE + bias** on point estimates.
5. **Qini / AUUC** for heterogeneous (uplift) effects.
6. **Placebo / negative-control tests** — no treatment → engine estimates ~zero lift.
7. **Multi-seed runs** with reported variance.
8. **Back-test against a real known-answer dataset** — recover the published incrementality result on **Criteo Uplift v2.1** and **Hillstrom**. This is the strongest single move (it is exactly how Haus validates synthetic control).

**The proof artifact** (the deliverable that ends the wave) is therefore: a reproducible report + demo video showing the engine passing 1–8 above, plus the end-to-end gated loop catching an unsafe agent action and independently grading a good one — every claim carrying its **claim limit** (the honesty discipline already baked into `TESTING-AND-COMPARISON.md`). That honesty is itself a signal to a technical partner (Ankit Gupta, ex-Reverie Labs).

**Explicit non-goals of this wave:** no live ad spend, no Meta/Google ad-account writes, no real customer, no paid pilot. Those are the *next* wave. This wave needs zero ad-platform credentials — a major de-risking.

---

## 3. Strategic shape — build on the MVP, extend into proof

The wave is the MVP **plus three extensions**, sequenced:

```
  EXISTING SCAFFOLD            THE PROOF WAVE
  packages/schemas    ──►  Phase 0  Ground & Rig   (standalone repo, CI, build rig, VPS recon)
                           Phase 1  Product Core   (WP-A..K — the TS MVP: gate loop, CLI, MCP)
                           Phase 2  Data Layer     (Postgres ledger+app, DuckDB+dbt warehouse)
                           Phase 3  Sim + Verifier (Python: campaign simulator + lift engine)
                           Phase 4  Validation     (SBC, coverage, Qini, placebo, backtests)
                           Phase 5  Proof Package  (end-to-end demo, report, YC materials)
```

The product surface (CLI / MCP / API / web / schemas / core) stays **TypeScript**, as already designed. The verification science (simulator, causal inference, benchmarks, validation) is **Python** — because every serious tool in the space (OBP, GeoLift, CausalImpact, scikit-uplift, PyMC/Stan for SBC) is Python. The **H0 packet schema is the contract** between the two halves. This polyglot split is normal and clean; §4.2 nails the boundary.

---

## 4. Product architecture

### 4.1 The standalone repo

AdMatix becomes its own repo at `github.com/Nakul-Kumar/admatix`, default branch `main`. Top-level layout (extends the existing scaffold; **new** items marked):

```
admatix/
  apps/
    cli/                  TypeScript — the `admatix` command-line tool
    mcp-server/           TypeScript — the MCP server (read-only tools for agents)
    api/                  TypeScript (Fastify) — the HTTP API
    web/                  TypeScript (React/Vite) — the cockpit
  packages/
    schemas/              TypeScript — the FROZEN shared contract (built)
    core/                 TypeScript — normalization, impact math, the Store
    connectors/           TypeScript — platform + dataset adapters (read-only)
    evidence/             TypeScript — detectors, H0 builder, audit report
    policy/               TypeScript — PolicyGuard, EvidenceLedger, events
    agents/               TypeScript — the 9-agent runtime + orchestrator
    evals/                TypeScript — benchmark harness, scorers, baselines
    ui/                   TypeScript — shared React components
  services/               ★ NEW — the Python science layer
    verifier/             ★ Python (FastAPI) — the independent verification engine
    simulator/            ★ Python — the generative campaign simulator
    validation/           ★ Python — SBC, coverage, Qini, placebo, backtests
    ingest/               ★ Python — dataset ingestion (Criteo, Hillstrom, ...)
  warehouse/              ★ NEW — the data layer
    migrations/           ★ SQL — Postgres schema migrations (ledger + app)
    dbt/                  ★ dbt project — bronze → silver → gold/marts
    ddl/                  ★ generated DDL reference + ER diagrams
  data/
    fixtures/             demo ad-account data (built)
    datasets/             ★ downloaded public datasets (git-ignored, DVC-tracked)
    benchmarks/           frozen benchmark tasks + runs
  docs/
    architecture/         ARCHITECTURE-DEEP.md + ★ DATA-LAYER.md, ★ VERIFIER.md
    build/                WP specs, orchestration, ★ proof-wave WP specs
    phase-reports/        ★ one report per completed slice (the context surface)
    runbooks/             demo script, ops runbooks
  infra/                  ★ docker-compose (Postgres, the services), CI config
  scripts/                doctor, seed-fixtures, scan-secrets, ★ download-datasets
  .github/workflows/      ★ CI: typecheck, test, pytest, scan-secrets, dbt build
```

`packages/schemas` stays frozen and is the only cross-cutting dependency. The repo is **open-core**: per the existing decision, `schemas` / `cli` / `mcp-server` / connector interfaces are Apache-2.0; `core` is source-available (FSL-1.1); `verifier` / `evals` / `validation` / `api` / `web` are proprietary. We make that split physical via per-directory `LICENSE` files from day one so the open/closed line is never ambiguous.

### 4.2 The polyglot boundary

| Concern | Language | Why |
| --- | --- | --- |
| Product surface — CLI, MCP, API, web, schemas, core, detectors, policy, agent runtime | TypeScript | Already designed; one type system end-to-end; the MCP TS SDK |
| Verification science — simulator, causal inference, uplift, SBC, OPE, benchmarks | Python | Every credible tool (OBP, GeoLift, CausalImpact, scikit-uplift, PyMC) is Python |
| Data layer — warehouse transforms | SQL + dbt | Standard; dbt gives lineage/tests/docs for free |

**The boundary contract:** the TS side and the Python side communicate **only** through (a) the H0 packet JSON (schema-validated both sides — we generate Python Pydantic models from the Zod schemas so there is one source of truth), and (b) the Postgres database. The Python `verifier` exposes a small FastAPI: `POST /verify` (H0 packet + post-period window → estimate, CI, causal_status, verdict), `POST /simulate`, `GET /healthz`. `packages/agents` calls it over HTTP. No other coupling. This means Codex can own the Python services and Claude Code can own the TS product with a single frozen contract between them.

### 4.3 MCPs, connectors, and DSP integration

Three distinct things people lump together — kept separate:

**(a) The MCP server AdMatix *exposes* (`apps/mcp-server`)** — this is the "software for agents" surface. Any agent (Claude, Codex, Gemini, a custom LangGraph agent) connects and gets read-only tools:

| Tool | Class | Returns |
| --- | --- | --- |
| `admatix.audit_account` | read | An `AuditReport` — evidence-backed findings |
| `admatix.plan` | propose | `H0Packet[]` — hypothesis-backed proposals |
| `admatix.packet_show` | read | One H0 packet — hypothesis, evidence, guardrails, rollback |
| `admatix.activate` | propose | An `ExecutionDiff` (dry-run only — **never a mutation**) |
| `admatix.verify` | read | The independent verification verdict for a packet |
| `admatix.benchmark_run` | read | A safety/competence scorecard |

Capability-gated: a write-class tool cannot be invoked without an approval receipt in the call path. In the proof wave every tool is read/propose only — there is no write tool in the codebase.

**(b) The connectors AdMatix *consumes* (`packages/connectors`)** — the adapter layer to data sources. One interface, three adapter families:

- **Fixture connectors** — read `data/fixtures/` (built; the MVP runs on these).
- **Dataset connectors** ★ — read the ingested public datasets (Criteo, Hillstrom, Avazu, iPinYou) from the warehouse. New for this wave; this is how we "use datasets."
- **Live DSP connectors** — Google Ads, Meta, TikTok, DV360, Amazon. **Architected, not built this wave.** Important design point: Meta now ships an official **Ads MCP** and Google ships an **Ads MCP** — so a live connector is an adapter *over a platform MCP*, not raw REST. We define the `Connector` interface so a platform-MCP-backed adapter slots in later with zero change to callers. The MVP rule holds: the `Connector` interface exposes **read methods only** — there is no write method to call.

**(c) The credential vault** — architected (the `app.connections` table, encrypted token storage, the OAuth flow design) but **not populated** this wave, because no live DSP is connected. It is the forcing function from the strategy doc (whoever holds the credential path holds the gate) — so it is designed now and switched on in the next wave.

**DSPs / platforms considered, and when:** Meta, Google (Search + PMax), TikTok, DV360, Amazon Ads — all modelled in `dim_platform` and the connector interface from the start; none connected live this wave. The proof runs entirely on simulated + public data.

---

## 5. The data layer — deep architecture

This is the section you specifically asked to be exhaustive. The data layer has **four stores**, each with a clear job. The guiding principle: the **action ledger** is transactional and tamper-evident; the **warehouse** is analytical and rebuildable; never mix them.

### 5.1 The four stores

| Store | Tech (this wave) | Tech (later) | Holds |
| --- | --- | --- | --- |
| **Ledger** | Postgres schema `ledger` | same (it is the system of record) | Hash-chained, append-only event log of every decision |
| **App / operational** | Postgres schema `app` | same | Tenants, accounts, H0 packets, approvals, trust, runs |
| **Warehouse** | DuckDB + dbt | Postgres or ClickHouse | Medallion bronze/silver/gold; star schema; marts |
| **Sim / benchmark** | DuckDB (+ DVC for raw files) | same | Simulated worlds, ground truth, benchmark tasks/runs |

Why this mix: Postgres for anything transactional and audited (the ledger must be a real ACID DB with revoked UPDATE/DELETE grants); DuckDB for the analytical/simulation workload (zero-infra, reads Parquet, ideal for the millions of rows from Criteo and the simulator); dbt for the transforms (lineage, tests, and docs come free — and dbt-generated docs are themselves a credibility artifact). The `Store` interface in `packages/core` already abstracts persistence, so swapping the MVP's JSON files for Postgres is a drop-in (Phase 2).

### 5.2 Postgres `ledger` schema — tamper-evident, append-only

The ledger is the moat made physical: every decision, hash-chained so any deletion or edit is detectable.

**`ledger.action_events`** — grain: one event. Write-once.

| Column | Type | Notes |
| --- | --- | --- |
| `event_id` | ULID PK | sortable, time-ordered |
| `seq` | bigserial | monotonic global sequence — the chain order |
| `tx_id` | text | correlation id across task/cost/route/trace (AgentForge convention) |
| `workflow_id` | text | the Plan→Activate→Measure→Reflect run |
| `trace_id` | text | observability trace |
| `tenant_id` | text | FK → `app.tenants` |
| `event_type` | enum | `proposal` `gate_decision` `approval` `execution_diff` `measurement` `reflection` `flag` |
| `step` | enum | `plan` `activate` `measure` `reflect` |
| `actor_agent_id` | text | which agent emitted it |
| `subject_id` | text | the packet/action/account this is about |
| `payload` | jsonb | the full event body |
| `payload_hash` | char(64) | sha256 of the canonicalized payload |
| `prev_hash` | char(64) | `entry_hash` of `seq-1` |
| `entry_hash` | char(64) | sha256(`payload_hash` ‖ `prev_hash` ‖ `seq` ‖ `created_at`) |
| `signature` | text | optional Ed25519 signature of `entry_hash` |
| `created_at` | timestamptz | server clock |

Integrity: `UPDATE`/`DELETE` are revoked at the DB-role level; the app role can only `INSERT`. A nightly job verifies the chain end-to-end.

**`ledger.merkle_anchors`** — periodic Merkle roots over event ranges: `anchor_id`, `from_seq`, `to_seq`, `merkle_root`, `event_count`, `anchored_at`, `external_anchor` (optional — a public timestamp). This is what lets us say "tamper-evident" without hand-waving.

### 5.3 Postgres `app` schema — operational

These are the MVP's `Store` collections, promoted to real tables in Phase 2.

| Table | Grain | Key columns |
| --- | --- | --- |
| `app.tenants` | one customer | `tenant_id` PK, `name`, `plan_tier`, `created_at` |
| `app.users` | one user | `user_id` PK, `tenant_id` FK, `email`, `role`, `created_at` |
| `app.ad_accounts` | one connected account | `account_id` PK, `tenant_id` FK, `platform`, `external_ref`, `connection_status`, `created_at` |
| `app.connections` | one credential (vault) | `connection_id` PK, `account_id` FK, `oauth_scope`, `token_ciphertext`, `expires_at` — **empty this wave** |
| `app.h0_packets` | one H0 packet | `packet_id` PK, `tenant_id` FK, `account_id` FK, `goal`, `hypothesis`, `null_hypothesis`, `causal_status`, `state` (`draft`/`validated`/`pending_approval`/`approved`/`rejected`/`measured`/`reflected`), `body` jsonb (full validated packet), `body_hash`, `created_by_agent`, `trace_id`, `created_at`, `updated_at` |
| `app.proposed_actions` | one proposed action | `action_id` PK, `packet_id` FK, `action_type`, `target_entity_id`, `params` jsonb, `dry_run_only` bool, `rollback` jsonb, `created_at` |
| `app.policy_decisions` | one gate evaluation | `decision_id` PK, `action_id` FK, `policy_version`, `decision` (`allow`/`deny`/`needs_approval`), `reasons` jsonb, `created_at` |
| `app.execution_diffs` | one dry-run diff | `diff_id` PK, `action_id` FK, `before` jsonb, `after` jsonb, `diff` jsonb, `dry_run` bool (always true this wave), `created_at` |
| `app.approval_receipts` | one approval | `receipt_id` PK, `packet_id` FK, `status`, `required_role`, `approved_by`, `approved_at`, `packet_hash` (binds approval to a packet version), `created_at` |
| `app.rollback_checkpoints` | one snapshot | `checkpoint_id` PK, `account_id` FK, `entity_id`, `snapshot` jsonb, `created_at` |
| `app.outcome_measurements` | one verified outcome | `measurement_id` PK, `packet_id` FK, `metric`, `estimate`, `ci_low`, `ci_high`, `method`, `verdict` (`validated`/`invalidated`/`inconclusive`), `verifier_version`, `measured_at` |
| `app.trust_scores` | current trust per entity | `entity_kind` (`agent`/`skill`/`connector`), `entity_id`, `score` [0,1], `tier`, `updated_at` (PK = kind+id) |
| `app.trust_score_history` | append-only trust changes | `id` PK, `entity_kind`, `entity_id`, `old_score`, `new_score`, `reason`, `created_at` |
| `app.policies` | one policy version | `policy_id` PK, `version`, `rules` jsonb, `effective_from` |
| `app.agent_runs` | one agent invocation | `run_id` PK, `agent_id`, `workflow_id`, `model`, `input_hash`, `output_hash`, `status`, `cost_usd`, `started_at`, `ended_at` |

Provenance is universal: every row that derives from data carries `evidence_refs` (already in the schema) or an `input_hash`. The trust-ledger algorithm (from `ARCHITECTURE-DEEP.md` §5 — slow rise, fast decay) writes to `trust_score_history`; `ReflectionAgent` is the only writer.

### 5.4 The warehouse — medallion (bronze → silver → gold)

A dbt project under `warehouse/dbt/`, three layers, mapping cleanly to dbt model folders:

**Bronze** (`models/bronze/` — raw, as-ingested, immutable + load metadata): `bronze_criteo_uplift`, `bronze_criteo_attribution`, `bronze_hillstrom`, `bronze_avazu`, `bronze_ipinyou`, `bronze_sim_events` (raw simulator output), `bronze_platform_metrics` (raw fixture/connector imports), `bronze_first_party_orders`. Every bronze row carries `_loaded_at`, `_source`, `_batch_id`, `_row_hash`.

**Silver** (`models/silver/` — cleaned, typed, deduplicated, conformed to the schema contract): `silver_campaign_daily` (conformed to `CampaignDailyMetric`), `silver_creative_daily`, `silver_first_party_daily` (→ `FirstPartyRevenueDaily`), `silver_conversions`, `silver_treatment_assignment` (unified treatment/control/exposure from Criteo Uplift, Hillstrom, and the simulator), `silver_auctions` (from iPinYou).

**Gold / marts** (`models/marts/` — the star schema + denormalized marts; §5.5–5.6).

dbt gives us, free: column-level lineage, `not_null`/`unique`/`relationships`/`accepted_values` tests on every model, and auto-generated docs — all of which double as due-diligence artifacts.

### 5.5 The star schema — facts & dimensions (gold)

Kimball dimensional model. **Dimensions** (conformed, shared across facts):

| Dimension | Key columns | SCD |
| --- | --- | --- |
| `dim_date` | `date_key`, `date`, `dow`, `week`, `month`, `quarter`, `year`, `is_weekend` | static |
| `dim_account` | `account_key` (surrogate), `account_id`, `tenant_id`, `platform`, `name` | Type 1 |
| `dim_campaign` | `campaign_key`, `campaign_id`, `account_key`, `name`, `objective`, `status`, `budget`, `bid_strategy`, `valid_from`, `valid_to`, `is_current` | **Type 2** |
| `dim_ad_set` | `ad_set_key`, `ad_set_id`, `campaign_key`, `name`, `targeting`, `budget`, `valid_from`, `valid_to`, `is_current` | **Type 2** |
| `dim_creative` | `creative_key`, `creative_id`, `ad_set_key`, `format`, `headline_hash`, `asset_ref`, `valid_from`, `valid_to`, `is_current` | **Type 2** |
| `dim_geo` | `geo_key`, `country`, `region`, `dma` | static |
| `dim_audience` | `audience_key`, `segment`, `definition_hash` | Type 1 |
| `dim_platform` | `platform_key`, `platform`, `channel_type` (search/social/programmatic) | static |
| `dim_device` | `device_key`, `device_type`, `os` | static |

**Type 2 on campaign / ad-set / creative is non-negotiable** — the verifier must judge an agent action against the campaign config *as it was at action time*, which means querying the historical row, not the current one. Implemented with dbt snapshots.

**Fact tables** (grain-separated):

| Fact | Grain | Measures | Key FKs |
| --- | --- | --- | --- |
| `fct_impressions` | one impression (or hourly rollup) | `impressions`, `cost` | date, campaign, ad_set, creative, geo, platform, device |
| `fct_clicks` | one click | `clicks`, `cost` | date, campaign, ad_set, creative, geo, platform, device |
| `fct_conversions` | one conversion | `conversions`, `revenue`, `conversion_value`, `attributed_fraction` | date, campaign, creative, geo, platform |
| `fct_spend_daily` | campaign × ad_set × date (periodic snapshot) | `spend`, `budget`, `impressions`, `clicks`, `conversions`, `platform_revenue` | date, campaign, ad_set, account |
| `fct_campaign_action` | one agent action | `budget_delta`, `dry_run` flag | date, campaign, `packet_id`, `action_id` — joins to `ledger.action_events` |
| `fct_outcome` | one measured H0 outcome | `estimate`, `ci_low`, `ci_high`, `is_validated` | date, campaign, `packet_id` |

`fct_campaign_action` and `fct_outcome` are the bridge between the operational ledger and the analytical warehouse — they let us answer "did gated actions outperform ungated ones" in one query.

### 5.6 Marts (gold subject areas)

Denormalized, read-optimized, one per consumer:

- `mart_campaign_performance` — spend, ROAS, CAC, MER, CTR, CVR by campaign × day (feeds the cockpit).
- `mart_pacing` — budget pacing vs. plan, projected overspend (feeds pacing detectors).
- `mart_waste` — identified wasted spend: zero-conversion spend, dead keywords (feeds the waste detector and the audit report).
- `mart_verification` — every H0 outcome with its lift estimate, CI, method, verdict (feeds `admatix.verify` and the proof report).
- `mart_agent_safety` — benchmark/safety scoring per agent and per run (feeds the safety benchmark).
- `mart_evidence_coverage` — fraction of actions with a complete H0 packet (the Section C comparison metric).

### 5.7 Simulation & benchmark stores

Schema `sim` and `bench` (DuckDB this wave):

| Table | Grain | Key columns |
| --- | --- | --- |
| `sim.scenarios` | one simulated world | `scenario_id`, `seed`, `params` jsonb (baseline CVR, true lift, budget, audience size, noise, seasonality, confounder strength), `created_at` |
| `sim.campaigns` | one simulated campaign | `sim_campaign_id`, `scenario_id`, `config` jsonb |
| `sim.true_effects` | **ground truth** per scenario | `scenario_id`, `true_incremental_lift`, `true_iroas`, `true_cate` jsonb — *the number the verifier must recover; never shown to the verifier* |
| `sim.events` | simulated impressions/clicks/conversions | standard event columns + `treatment` flag |
| `bench.tasks` | one benchmark task | `task_id`, `suite`, `kind`, `fixture`, `expected` jsonb, `is_unsafe` bool (the `BenchmarkTask` schema) |
| `bench.runs` | one benchmark run | `run_id`, `suite`, `pinned` jsonb (fixture/code/policy/model versions), `summary` jsonb, `created_at` |
| `bench.results` | one task result | `task_id`, `run_id`, `passed`, `score`, `unsafe_write_attempted`, `evidence_coverage`, `rollback_coverage` |
| `bench.ground_truth` | known answers | `task_id`, `truth` jsonb |

`sim.true_effects` is the heart of the proof: we generate worlds with a known answer, hide the answer, and measure whether the verifier finds it.

### 5.8 Metadata, lineage, governance

- **Lineage:** dbt provides column-level lineage and a navigable docs site (`dbt docs generate`). Committed to the repo and published — it is a due-diligence asset.
- **Data dictionary:** every model and column gets a dbt `description`; `warehouse/ddl/` holds the generated DDL + an ER diagram (`dbt-erdiagram` or a generated mermaid). This is the "every column documented" artifact.
- **Data tests:** dbt `not_null`, `unique`, `relationships`, `accepted_values`, plus custom tests (e.g. `spend >= 0`, conversion ≤ clicks). These run in CI.
- **Versioning:** raw datasets in `data/datasets/` are tracked with **DVC** (not git — they are large) so the warehouse is reproducible from a pinned dataset version. Schema migrations are versioned SQL in `warehouse/migrations/` (one forward + one rollback per migration).
- **Provenance:** every bronze row carries source + hash + load batch; this is what makes the warehouse itself auditable.

---

## 6. The simulation & verification engine (`services/`)

This is the part that turns AdMatix from "a governed workflow" into "a thing that can prove it works."

### 6.1 `services/simulator` — the generative campaign simulator

A parameterized generator of ad-campaign worlds with **known ground truth**. Given a scenario spec (baseline conversion rate, true incremental lift, budget, audience size, seasonality, noise level, confounder strength, treatment fraction) it emits a realistic stream of impressions/clicks/conversions with treatment/control assignment, and records the *true* effect into `sim.true_effects`. It supports: clean A/B worlds, geo-structured worlds (for geo-holdout testing), worlds with confounders (to test whether naive methods fail and the verifier doesn't), and "placebo" worlds with zero true lift. Calibrated so its marginal CTR/CVR distributions resemble the real datasets (Avazu/Criteo) — realism without sacrificing known truth.

### 6.2 `services/verifier` — the independent verification engine

The independent grader. A FastAPI service; input = an H0 packet + the post-period data window; output = `{ estimate, ci_low, ci_high, method, causal_status, verdict, confounders[] }`. It is **independent by construction** — a separate service, separate process, never the agent that proposed the action; it only ever reads data. Methods, layered by available evidence (this is the honest version of the claim — see the strategy doc's §1 correction):

1. **Guardrail-compliance proof** — deterministic, 100% verifiable: did the action stay within budget/pacing/policy. Always available.
2. **Pre/post with synthetic control** — CausalImpact-style Bayesian structural time series; a confidence-scored estimate with named confounders.
3. **Uplift / CATE** — when treatment/control data exists (simulator, Criteo Uplift, Hillstrom): meta-learners (T/S/X-learner) + Qini/AUUC.
4. **Geo-holdout** — GeoLift-style synthetic control + a power/MDE calculator.
5. **Off-policy evaluation** — IPS/SNIPS/DR via OBP, for "would this plan have beaten what ran."

The verifier **never** returns a bare "causal lift per decision" — it returns an estimate **with its interval, its method, and its confounder caveats**, and labels low-evidence cases `inconclusive`. That restraint is the credibility.

### 6.3 `services/validation` — the research-grade harness

The harness that runs the §2 stack and produces the proof: SBC (rank histograms), CI coverage curves, RMSE/bias tables, Qini/AUUC, placebo runs, multi-seed variance, and the backtests against Criteo Uplift v2.1 and Hillstrom. Output is a set of figures + a metrics table + a reproducible notebook — the raw material of the proof report.

### 6.4 `services/ingest` — datasets

Downloads and lands the public datasets into bronze. Confirmed targets (from research):

| Dataset | Use | License note |
| --- | --- | --- |
| **Hillstrom** (64K, 3-arm randomized) | Fast CI-grade lift ground truth | Public, freely usable |
| **Criteo Uplift v2.1** (~14M, treatment/control/exposure) | At-scale lift backtest | **CC BY-NC-SA — non-commercial**: R&D/benchmark only, not a product feature |
| **Criteo Attribution** (~16.5M, 700 campaigns) | Realistic campaign simulation inputs | CC BY-NC-SA — non-commercial |
| **Avazu CTR** (~40M) | Realistic impression/click structure | Kaggle research terms |
| **iPinYou RTB** | Auction/bidding simulation | Public research |

The CC BY-NC-SA restriction is real and I have flagged it: Criteo data is fine for the proof/benchmark (research use) but cannot ship inside a commercial product feature without separate licensing. Hillstrom carries no such restriction and is the safe default for anything that needs to be permissive.

---

## 7. The build orchestration architecture

How the system actually gets built — using Claude Code (Opus 4.7) and Codex (5.5), with me (Cowork) driving.

### 7.1 Roles

- **Cowork (me)** — the orchestrator. I own: the plan, the work-package specs, dispatching build agents, verifying every slice against its acceptance criteria, writing phase reports, gating phase transitions, and reporting to you. I do not hand-write the product code; I direct and verify it.
- **Claude Code (Opus 4.7)** — the integrative builder. Best for judgment-heavy, cross-package work: detectors, the orchestrator wiring, the simulator design, the verifier methods, integration, the proof writeup.
- **Codex (5.5)** — the contained builder. Best for crisp, well-specified, heavily-tested packages: schemas tweaks, core, connectors, policy, the data-layer DDL/migrations, dbt models, the deterministic verifier math, unit-test-heavy modules.
- **You** — review at phase gates; jump in with Codex interactively to "check in / continue / improve" any slice (the repo is structured so Codex can pick up cold — §7.3).

Routing heuristic: **Codex for deterministic + spec-complete; Claude Code for integrative + judgment.** Both produce the same artifact (a branch + PR + acceptance output) and pass the same gate.

### 7.2 The dispatch rig

The build runs **headless on the VPS**, dispatched by me, per the pattern proven in your AgentForge sessions:

1. I write each work-package spec to `docs/build/` and a dispatch prompt to a file.
2. I `scp` the prompt to the VPS and launch the agent headless — Claude Code via `claude -p --agent <role> --model claude-opus-4-7 --dangerously-skip-permissions` (run as the non-root build user), or Codex via its CLI with the 5.5 model. Each writes a status log.
3. I poll the status log + `git log` every 5–10 min.
4. When the agent finishes, I verify (§7.3) before greenlighting the next slice.

Parallelism: independent work packages run as parallel headless agents (the existing DAG already defines what is parallelizable). The VPS has the headroom (96 GB disk, and the build is I/O-light); cost is the real constraint, not compute (§12).

You can also run any slice yourself with Codex interactively on the laptop — same repo, same specs.

### 7.3 Git workflow & verification gates

- **Branch per slice:** `wp/<id>-<slug>`. Conventional commits. PR into `main`.
- **Interface-first:** the first commit of every package publishes `src/index.ts` (or the Python module's signatures) with stub bodies, pushed immediately, so dependents typecheck against it and parallel work overlaps.
- **The verification gate (this is the "high accuracy, everything checked" you asked for):** when an agent reports a slice done, *I do not trust the report*. I clone the repo fresh into my sandbox, and run: `pnpm typecheck`, `pnpm test`, `pytest`, `dbt build` + `dbt test` (as applicable), `scan-secrets`, and the slice's named acceptance tests. I diff what shipped against the spec. Only if it actually passes do I merge and greenlight the next slice. If it drifted, I either dispatch a fix or escalate to you.
- **Phase gate:** at the end of each phase, the full suite must be green on `main` and the phase's Definition of Done met, before the next phase starts. Phases are the rollback points.
- **The repo is the context surface:** every slice ends with a phase report in `docs/phase-reports/`. `AGENTS.md` + `ARCHITECTURE-DEEP.md` + `DATA-LAYER.md` + the WP specs + the phase reports are the *complete* context any agent needs. This is what lets you (or Codex) "check in and continue" cold — the agent reads the repo, not my memory.
- **Credential self-heal:** every dispatch prompt opens with the git-credential self-heal preamble (the recurring VPS ownership-drift bug — already a known pattern from AgentForge).

### 7.4 The build-time agent roster

Not 30 agents — a small set of **roles**, scaled by parallel runs (the same discipline as AdMatix's own runtime):

| Build role | Engine | Owns |
| --- | --- | --- |
| `bootstrap` | Codex | repo extraction, CI, infra, doctor |
| `ts-package` | Codex ×N | core, connectors, policy, evals (parallel runs) |
| `ts-integrator` | Claude Code | evidence/detectors, agent runtime, CLI/MCP/API/web wiring |
| `data-engineer` | Codex | migrations, dbt models, the warehouse |
| `science` | Claude Code | simulator, verifier methods, validation harness |
| `sdet` | Codex | test suites, benchmark harness, acceptance tests |
| `critic` | Claude Code | adversarial review before each phase gate |
| `docs` | Codex | phase reports, runbooks, the data dictionary |

`critic` is deliberately a separate pre-gate review pass — an adversarial read of the diff before I run the gate.

### 7.5 Reusing the AgentForge skills/MCP database

You mentioned the VPS has a database of skills and MCPs that `agentbuilder` uses. **I could not inspect it — I need the VPS SSH key (§11).** As soon as I have it, Phase 0 step 1 is: SSH in, survey that database, and decide what to reuse. The likely wins: the dispatch/headless-CC harness, the cost-logging, the cred self-heal sudoers, possibly MCP server scaffolds and skill templates. Reusing the proven dispatch rig instead of rebuilding it could save a meaningful chunk of Phase 0. I will report what is there and what we adopt before building anything new.

---

## 8. AdMatix's own runtime agent architecture

Distinct from the build agents above — these are the agents *inside the product*. The existing design is sound and I am keeping it: **9 agent types**, scaled by parallel runs, with the evidence/policy layer as deterministic non-LLM code (the agent proposes, deterministic code disposes). The roster — Orchestrator, PolicyGuard, EvidenceLedger, ApprovalCoordinator (control); MediaAnalyst (intelligence); MeasurementScientist (measurement); PlatformAdapter, DiffBuilder (execution); Reflection (control) — is already specified in `ARCHITECTURE-DEEP.md` §6 and does not change. The one wave addition: `MeasurementScientistAgent` becomes the client of the new Python `verifier` service — it calls `/verify` rather than hand-waving causal claims. For the proof wave the agents remain a deterministic rules engine (no LLM required to run the demo); the `Agent` interface is LLM-ready for later.

---

## 9. The phased wave plan

Six phases. Each phase = a set of slices (work packages) dispatched to CC/Codex, then a gate. Durations are agent-build calendar time assuming I drive daily; they compress with parallelism and stretch with review latency.

**Confirmed 2026-05-22 — execution decisions.** Full wave: all six phases, run to completion. Autonomy: I dispatch and verify slices autonomously *within* a phase and stop for your review at each of the six phase gates. Sequencing: per your "stand up the simulation/testing infrastructure first" priority, the build is parallelised so the *ability to simulate and test* arrives as early as dependencies allow — `services/simulator` depends only on the frozen schemas, so it is built alongside Phases 1–2 rather than waiting, and the target is a minimal working **simulate → gate → verify** loop the moment the data layer can receive its output, with the exhaustive research-grade validation (Phase 4) following. The phase numbering below is the dependency-and-gating order; calendar overlap between phases is expected and intended.

### Phase 0 — Ground & Rig  (~1 day)

**Goal:** a clean standalone repo, CI, the build rig, and VPS recon done.

Slices: **0.1** SSH to VPS, survey the agentbuilder skills/MCP DB, report what we reuse. **0.2** Extract `admatix/` from ChappieForge into a clean tree **on the VPS** — all git, repo, and build operations run on the VPS (a clean Linux host), never inside the OneDrive-synced workspace folder, whose sandbox mount permits file creation but not deletion and therefore must not host a git repo — then `git init`, commit, and push to `github.com/Nakul-Kumar/admatix` (`main`). **0.3** CI workflows (typecheck, vitest, pytest, scan-secrets, dbt build) — green on the scaffold. **0.4** `infra/docker-compose` for Postgres + the Python services; confirm Codex CLI + Claude Opus 4.7 on the VPS; dataset-download script. **0.5** Author the proof-wave work-package specs into `docs/build/`.
**Gate:** repo is standalone and pushed; CI green; I can dispatch a headless agent and verify a round-trip.

### Phase 1 — Product Core  (~2–3 days)

**Goal:** the 72-hour MVP, executed — the deterministic evidence-gated loop end to end on fixtures.

Slices: the existing **WP-A…WP-K** — bootstrap, core, connectors, evidence/detectors, policy, agent runtime, CLI, MCP server, evals harness, API/web, integration. Dispatched per the existing DAG (Wave 1: B/C/E/I parallel → D → F → G/H/J → K).
**Gate (the existing "5-minute demo"):** `admatix audit` → findings; `admatix plan` → H0 packets; `admatix activate --dry-run` → a diff, never a mutation; PolicyGuard blocks an unsafe action; `benchmark run` → a scorecard; an agent drives it through the MCP server. Plus the `TESTING-AND-COMPARISON.md` §E "today checklist" all green.

### Phase 2 — Data Layer  (~2 days)

**Goal:** the real data layer; the MVP's JSON `Store` swapped for Postgres; the warehouse standing.

Slices: **2.1** Postgres `ledger` + `app` schemas — migrations, the hash-chain triggers, revoked UPDATE/DELETE grants. **2.2** Implement the `Store` interface against Postgres; migrate the MVP's collections; zero call-site changes. **2.3** The dbt project — bronze/silver/gold, the star schema, SCD2 snapshots, dbt tests. **2.4** The marts. **2.5** `warehouse/ddl/` — generated DDL, ER diagram, the data dictionary.
**Gate:** `dbt build && dbt test` green; the ledger hash-chain verifier passes; the full Phase 1 demo still works on Postgres; the data dictionary is published.

### Phase 3 — Simulation & Verification Engine  (~3 days)

**Goal:** the Python science layer — we can simulate campaigns and independently verify outcomes.

Slices: **3.1** `services/ingest` — land Hillstrom, Criteo Uplift v2.1, Criteo Attribution, Avazu, iPinYou into bronze (DVC-tracked). **3.2** `services/simulator` — the generative campaign simulator with `sim.true_effects` ground truth. **3.3** `services/verifier` — the FastAPI verification engine, methods 1–5 (§6.2), Pydantic models generated from the Zod schemas. **3.4** Wire `MeasurementScientistAgent` → the verifier; the `admatix.verify` MCP tool.
**Gate:** the simulator emits worlds with hidden known truth; the verifier returns estimate + CI + method + verdict over HTTP; the end-to-end loop (agent proposes → gate → log → verify) runs on a simulated campaign.

### Phase 4 — Research-Grade Validation  (~2–3 days)

**Goal:** prove the engine is correct, to the §2 standard.

Slices: **4.1** `services/validation` — SBC, CI-coverage, RMSE/bias, multi-seed harness. **4.2** Uplift evaluation — Qini/AUUC on the simulator and on Criteo Uplift. **4.3** Placebo / negative-control suite (zero-lift worlds → ~zero estimate). **4.4** The backtests — recover the known result on Criteo Uplift v2.1 and Hillstrom; reproduce published Qini/AUUC. **4.5** Benchmark lanes B.1–B.6 from `TESTING-AND-COMPARISON.md` (CTR, uplift, RTB, OPE, agent-task, safety) + the safety benchmark (≥99% block rate, 0% false-accept).
**Gate:** SBC ranks ~uniform; CI coverage ~nominal; placebo ~zero; backtests within tolerance of published results; safety benchmark passes. Each result carries its claim limit.

### Phase 5 — Proof Package  (~1–2 days)

**Goal:** the artifact you take to YC.

Slices: **5.1** The end-to-end demo script + recording — a simulated agent proposes a budget move; AdMatix gates, blocks an unsafe variant, logs it tamper-evident, and the independent verifier grades the good one; the cockpit shows it. **5.2** The proof report — the validation figures + metrics, each with its claim limit, written for a technical reader. **5.3** The YC application materials — the "what we built" answer, the 1-minute video script, the demo video. **5.4** Publish the dbt docs + the benchmark suite for external scrutiny.
**Gate:** a fresh clone reproduces the demo and the validation results; the proof report is honest and complete; the YC materials are drafted.

**Total:** ~11–14 agent-build days. With aggressive parallelism and prompt review turnaround, ~8–10. I will give you a running burn-down at every gate.

---

## 10. Schedules & routines

I can set these up as scheduled tasks once we start (you can also mirror them on your side):

- **Daily build digest** — each morning during the wave: what shipped, what is in flight, what is gated, what is blocked, cost to date. One message.
- **Phase-gate checkpoint** — at each phase boundary: the full verification suite result + the go/no-go for the next phase.
- **Nightly CI + benchmark run** — from Phase 4: the benchmark lanes run nightly, results into `data/benchmarks/`, regressions flagged.
- **Nightly ledger-integrity check** — from Phase 2: verify the hash chain end-to-end; alert on any break.
- **Weekly cost + progress report** — burn-down vs. the ~11–14 day estimate, Opus/Codex spend.

---

## 11. What I need from you

**To start (blocking):**

1. **VPS SSH key** — paste the `ed25519` private key (the `nakul@LAPTOP-I41I309U` key) into the chat. Without it I cannot recon the agentbuilder skills DB or dispatch headless build agents. It stays only in the sandbox `/tmp` and is gone at session end.
2. **A GitHub PAT scoped to `Nakul-Kumar/admatix`** — fine-grained, **Contents: Read and write** (the existing PAT is scoped to AgentForge only and expires ~May 24 — please generate a fresh one covering `admatix`). Paste when I reach Phase 0.2. I will not save the token to memory.

**To confirm (not blocking — defaults in brackets):**

3. Models — Claude Code on **Opus 4.7** (`claude-opus-4-7`) and **Codex 5.5** for the build, as you specified. I will verify exact model strings on the VPS in Phase 0 and flag cost (§12). [proceed]
4. The VPS has **Codex CLI + Anthropic + OpenAI credentials** available for headless runs. [you confirm in Phase 0; Kaggle creds already exist in the AgentForge `.env`]
5. The proof wave uses **simulated + public datasets only — no live ad accounts, no ad spend.** No Meta/Google/TikTok credentials needed this wave. [proceed]

**Not needed this wave:** any ad-platform login, any payment rail, any hosting cred. Those belong to the next wave.

---

## 12. Risks & how the plan handles them

| Risk | Mitigation |
| --- | --- |
| **Opus-4.7-everywhere cost.** Running every build slice on Opus is expensive. | Route deterministic, spec-complete slices to Codex; reserve Opus for integrative work. I report spend at every gate; you can dial the Opus/Codex mix. |
| **Per-decision causal lift is not statistically defensible** (the strategy doc's correction). | The verifier never claims it. It returns estimate + CI + method + confounders, labels low-evidence cases `inconclusive`, and leans on the deterministic guardrail-compliance proof. Phase 4 enforces this with coverage tests. |
| **Criteo non-commercial license.** | Criteo data is used for the proof/benchmark only (research use). Hillstrom (unrestricted) is the default for anything that must be permissive. Flagged in `services/ingest`. |
| **Headless agent drift** — an agent over-builds or wanders. | Disjoint work-package ownership; "STOP after X" in every prompt; the `critic` pre-gate review; I verify against the spec, not the agent's self-report. |
| **VPS credential / OAuth drift** (a known recurring AgentForge bug). | The self-heal preamble in every dispatch prompt; the invariant checks from `reference_vps_access` memory. |
| **Scope creep into the next wave** (live connectors, payments). | The phase gates are hard. Live DSP writes are architected but a `critic` flag if any write path appears in code. |
| **Large generated files corrupting on edit** (a known tooling bug). | Big files (DDL, dbt) are generated via heredoc/scripts, not batched edits. |
| **The proof overclaims and a technical YC partner punctures it.** | Every result ships with its claim limit (already the discipline in `TESTING-AND-COMPARISON.md`); honesty is treated as a feature, not a weakness. |

---

## 13. Immediate next actions

1. **You:** review this plan; paste the **VPS SSH key** and confirm you will generate the **`admatix` PAT**.
2. **Me, on your go:** Phase 0.1 — SSH to the VPS, survey the agentbuilder skills/MCP DB, and report what we reuse before building anything.
3. **Me:** Phase 0.2 — extract `admatix/` into the standalone repo and push to `github.com/Nakul-Kumar/admatix`.
4. **Me:** stand up CI + the dispatch rig, author the proof-wave work-package specs, and dispatch the Phase 1 build.
5. **Gate.** I verify Phase 1 against the 5-minute demo, send you the phase report, and we greenlight Phase 2.

I drive; you review at gate