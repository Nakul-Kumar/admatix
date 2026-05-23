# AdMatix — Autonomous Wave Plan

**This is the authoritative plan the build orchestrator follows.** It lists every
work package across all five phases, the model that builds it, the dependency
waves, and the gate that closes each phase. The orchestrator (`scripts/
orchestrator-prompt.md`, run every ~20 min by cron) reads this file every tick and
advances the build by it. Full architecture detail lives in
`docs/architecture/PROOF-WAVE-MASTER-PLAN.md` and `ARCHITECTURE-DEEP.md`.

---

## How the autonomous build works

Two pieces, both on the always-on VPS:

1. **The build agents** — headless Claude Code (Opus 4.7) and Codex (5.5) runs,
   one per work package, each in its own git worktree under `/opt/admatix-wt/`.
   Each reads its spec, implements its package, runs typecheck + tests, commits,
   and pushes its branch to GitHub.
2. **The orchestrator** — a cron job (`*/20 * * * *`) that runs Claude Opus as a
   "tick": it polls the agents, verifies finished branches (`pnpm -r test`),
   merges the green ones into `main`, dispatches the next wave, advances across
   phase gates, and writes `.build/STATUS.md`.

A separate Cowork scheduled task reads `.build/STATUS.md` and surfaces it to Nakul
— that is the notification layer. The build itself does not depend on the laptop
being on; only the notifications do.

**Model split.** Opus 4.7 builds integrative / judgement-heavy packages (domain
logic, orchestrator, API + cockpit, the simulator and verifier, the proof). Codex
5.5 builds crisp, spec-complete, test-heavy packages (connectors, policy,
detectors, CLI, MCP server, migrations, dbt models, dataset ingest). A Codex run
that fails cleanly is re-dispatched on Opus.

---

## Phase 1 — Product Core  (the TypeScript MVP — deterministic evidence-gated loop)

Specs already in `docs/build/WP-*.md`.

| WP | Package | Wave | Model | Builds |
|----|---------|------|-------|--------|
| A | bootstrap | 0 | — | root config, vitest, scripts — **done** |
| B | `packages/core` | 1 | opus | normalization, impact math, the `Store`, hashing — **done** |
| C | `packages/connectors` | 1 | opus | fixture + dataset read-only adapters |
| E | `packages/policy` | 1 | opus | PolicyGuard, EvidenceLedger, event log — **done** |
| I | `packages/evals` | 1 | opus | benchmark harness, scorers, baselines |
| D | `packages/evidence` | 2 | codex | detectors, H0-packet builder, audit report |
| F | `packages/agents` | 2 | opus | the 9-agent runtime + orchestrator |
| G | `apps/cli` | 3 | codex | the `admatix` CLI |
| H | `apps/mcp-server` | 3 | codex | the MCP server (read-only agent tools) |
| J | `apps/api` + `apps/web` | 3 | opus | HTTP API + the cockpit |
| K | `tests/e2e` + demo | 4 | opus | integration, the 5-minute demo |

**Phase 1 gate:** on `main`, `pnpm -r typecheck && pnpm -r test` green, and the
demo runs end-to-end: `admatix audit` → findings → `admatix plan` → H0 packets →
`admatix activate --dry-run` → a diff (never a mutation) → PolicyGuard **blocks**
an unsafe action → `admatix benchmark run` → a scorecard → an agent drives it via
the MCP server.

---

## Phase 2 — Data Layer  (Supabase Postgres + DuckDB + dbt)

The database is **Supabase** (managed Postgres) — it gives AdMatix managed
Postgres, an auto-generated API, Auth for the cockpit, realtime for the approval
queue, and storage for evidence artifacts, with zero DB ops. The orchestrator
requires `SUPABASE_DB_URL` in `.build/secrets.env` before dispatching this phase.
DuckDB is retained only as the in-process engine for simulation/verification
compute.

| WP | Builds | Wave | Model |
|----|--------|------|-------|
| L | `warehouse/migrations` — the Supabase Postgres `ledger` schema (tamper-evident, hash-chained, append-only `action_events` + `merkle_anchors`) and `app` schema (tenants, accounts, h0_packets, proposed_actions, policy_decisions, execution_diffs, approval_receipts, rollback_checkpoints, outcome_measurements, trust_scores, agent_runs). See master plan §5.2–5.3 for every table and column. | 1 | codex |
| M | Swap `packages/core`'s filesystem `Store` for a Supabase Postgres implementation behind the same `Store` interface — zero call-site changes. | 1 | opus |
| N | `warehouse/dbt` — the dbt project: bronze → silver → gold medallion, the Kimball star schema (fact_impressions/clicks/conversions/spend_daily/campaign_action/outcome; SCD-2 dims for campaign/ad_set/creative). Master plan §5.4–5.5. | 2 | codex |
| O | The gold marts (`mart_campaign_performance`, `mart_pacing`, `mart_waste`, `mart_verification`, `mart_agent_safety`, `mart_evidence_coverage`) + generated DDL and the data dictionary. Master plan §5.6–5.8. | 2 | codex |

**Phase 2 gate:** `dbt build && dbt test` green; the ledger hash-chain verifier
passes end-to-end; the Phase 1 demo still works against Supabase.

---

## Phase 3 — Simulation & Verification Engine  (`services/`, Python)

| WP | Builds | Wave | Model |
|----|--------|------|-------|
| P | `services/ingest` — download + land public datasets into bronze: Hillstrom (CI-grade lift ground truth), Criteo Uplift v2.1, Criteo Attribution, Avazu, iPinYou (DVC-tracked). Master plan §6.4. | 1 | codex |
| Q | `services/simulator` — the generative campaign simulator: produces ad-campaign worlds with a **known** true incremental effect recorded in `sim.true_effects`. Parameterised, multi-seed, clean / confounded / placebo worlds. Master plan §6.1. | 1 | opus |
| R | `services/verifier` — the independent verification engine (FastAPI): input an H0 packet + post-period data, output `{estimate, ci_low, ci_high, method, causal_status, verdict, confounders}`. Methods: deterministic guardrail-compliance proof, pre/post synthetic control, uplift/CATE, geo-holdout, OPE. Never claims per-decision causal lift. Master plan §6.2. | 2 | opus |
| S | Wire `MeasurementScientistAgent` → the verifier service; add the `admatix.verify` MCP tool. | 3 | opus |

**Phase 3 gate:** the simulator emits worlds with hidden known truth; the verifier
returns estimate + CI + method + verdict over HTTP; the end-to-end loop runs —
a simulated agent proposes a change → AdMatix gates it → logs it → the verifier
independently grades it.

---

## Phase 4 — Research-Grade Validation

| WP | Builds | Wave | Model |
|----|--------|------|-------|
| T | `services/validation` — Simulation-Based Calibration (rank histograms), CI-coverage curves, RMSE + bias, multi-seed variance harness. Master plan §2, §6.3. | 1 | opus |
| U | Uplift evaluation — Qini / AUUC on the simulator and on Criteo Uplift; placebo / negative-control suite (zero-lift worlds → ~zero estimate). | 1 | codex |
| V | Back-tests — recover the known incrementality result on Criteo Uplift v2.1 and Hillstrom; reproduce published Qini/AUUC within tolerance. | 2 | opus |
| W | Benchmark lanes B.1–B.6 from `docs/build/TESTING-AND-COMPARISON.md` (CTR, uplift, RTB, OPE, agent-task, safety) + the safety benchmark (≥99% block rate, 0% false-accept). | 2 | codex |

**Phase 4 gate:** SBC ranks ~uniform; CI coverage ~nominal; placebo ~zero;
back-tests within tolerance of published results; safety benchmark passes. Every
result carries its claim limit.

---

## Phase 5 — Proof Package

| WP | Builds | Wave | Model |
|----|--------|------|-------|
| X | The end-to-end demo + a recording script — a simulated agent proposes a budget move; AdMatix blocks the unsafe variant, logs it tamper-evidently, and the independent verifier grades the good one; the cockpit shows it. | 1 | opus |
| Y | The proof report — the validation figures + metrics, each with its claim limit, written for a technical reader. | 2 | opus |
| Z | The YC application materials — the "what we built" answer, the 1-minute video script, the demo video outline. | 2 | opus |

**Phase 5 gate:** a fresh clone reproduces the demo and the validation results;
the proof report is honest and complete. → `MILESTONE: BUILD COMPLETE`.

---

## What Nakul needs to provide

| When | Input | Why |
|------|-------|-----|
| Before Phase 2 | A **Supabase** project + its Postgres connection string in `/opt/admatix/.build/secrets.env` as `SUPABASE_DB_URL=…` | Phase 2 builds the data layer on Supabase. The orchestrator pauses Phase 2 until this exists. |
| Phase 5 | Review the proof report + demo | The final human checkpoint before the YC application. |

Everything else runs without input. No ad-platform credentials are needed — the
whole wave runs on simulated + public datasets.

## What the autonomous system means

Once it is set up: the build runs itself. The orchestrator advances it wave by
wave, phase by phase — verifying, merging, and dispatching — 24/7 on the VPS,
whether or not the laptop is on. Nakul gets a status readout from the Cowork
monitor task and only steps in twice: to drop in the Supabase URL before Phase 2,
and to review the proof at the end. The end state is a production-grade AdMatix
with a research-grade simulation that demonstrates evidence-gated verification
works — the proof for the YC application.
