# AdMatix Claims Matrix

Snapshot date: 2026-05-23

This matrix is the guardrail for the proof package and YC narrative. It separates
what is implemented, what is measured, what is gate-passed, and what remains
unclaimable. The durable rule is simple: AdMatix may claim evidence-gated
control and calibrated/offline validation only where the corresponding artifact
exists and passes. It must not claim live spend lift until a real geo/holdout
pilot has run.

## Current Evidence State

| Area | Evidence artifact | Status | Honest claim | Forbidden overclaim |
| --- | --- | --- | --- | --- |
| Product loop | `origin/main` demo, CLI/API/MCP tests, dry-run activation, PolicyGuard block | Implemented and tested on fixtures | AdMatix can run a deterministic evidence-gated dry-run loop over fixture account data and block unsafe budget actions. | "AdMatix is running live ad accounts" or "AdMatix autonomously changes spend." |
| Evidence and policy | `packages/evidence`, `packages/policy`, H0 packets, EvidenceLedger tests | Implemented and tested | Agent proposals are gated by deterministic evidence and policy checks before any dry-run diff is accepted. | "The LLM is trusted to decide spend" or "all evidence implies causal lift." |
| Supabase data layer | migrations/dbt/ledger schemas on `main`; Supabase connected on VPS | Implemented; operational hardening still pending | AdMatix has a managed Postgres/Supabase data-layer shape for ledger, app, warehouse, simulator, and benchmark records. | "Production multi-tenant SaaS isolation is complete." |
| Simulator | `services/simulator` plus robustness worlds | Implemented and tested | AdMatix can generate seeded ad-campaign worlds with known ground truth, including clean, confounded, geo, placebo, and robustness cases. | "Simulation proves real-world lift." |
| Verifier | `services/verifier`; method validation on analytic/reference cases | Implemented and tested | The independent verifier returns estimate, CI, method, verdict, confounders, and deterministic guardrail proof for supported evidence designs. | "Every per-decision causal effect is rigorously identified." |
| Uplift/placebo | `services/uplift` on `main` | Implemented; retained as existing Phase 4 input | AdMatix has Qini/AUUC and placebo harness code for simulator and Criteo-style uplift checks. | "Public RCT recovery is fully complete." |
| Dashboard visibility | `codex/cx1-dashboard-live` | Branch pushed; not merged | The proof dashboard can label demo/artifact/live/unavailable origins and refuses originless proof data. | "Dashboard demo samples are live proof." |
| Production hygiene | `codex/cx7-prod-hygiene-ci` | Branch pushed; local gates pass; GitHub Actions blocked by account billing | CI, dependency audit, production secret hard-fail, and Fastify upgrade exist on the branch. | "GitHub CI is green" while Actions cannot start. |
| Validation calibration | `codex/cx2-validation-redo` | Branch pushed; fast tests pass; slow Phase 4 gate timed out | The redo uses the production simulator-to-verifier path and records failures honestly. | "SBC and CI coverage gates passed." |
| Head-to-head benchmark | `codex/cx3-headtohead-repair` | Branch pushed; blocked by zero real LLM rows | The benchmark now prevents future-data leakage and separates real LLM, fallback, failed, skipped, and policy rows. | "LLM buyer beat baseline" or "fallback rows are LLM evidence." |
| Public-dataset backtests | `codex/cx4-backtests-benchmarks` | Branch pushed; Hillstrom/Criteo smoke tests pass; full Criteo gate deferred | Hillstrom and Criteo are locally staged and smoke-tested with dataset SHA, row counts, license notes, and metrics output. | "Full Criteo 13.98M published-reference gate passed." |

## Claim Levels

| Level | Label | Required evidence | Current state | Allowed wording |
| --- | --- | --- | --- | --- |
| 0 | Demo mechanics | Fixture demo and tests pass | Passed on `main` | "We built an evidence-gated dry-run workflow for AI-run paid media." |
| 1 | Safety control plane | Policy/evidence gates block unsafe or unsupported actions | Passed on `main`; CX-7 strengthens prod boot | "Agents can propose, but deterministic code gates spend-touching actions." |
| 2 | Independent verification engine | Verifier service produces estimates/CIs/verdicts and is separate from acting agents | Passed on `main` | "The verifier is an independent service, not the acting agent." |
| 3 | Calibrated simulator validation | WP-T slow gate: SBC uniform and CI coverage nominal across easy and hard worlds | Not passed; CX-2 timed out and smoke artifacts include failures | "Validation harness exists and exposes current failures; full calibration is pending." |
| 4 | Public RCT backtests | Hillstrom plus full Criteo Uplift v2.1 published-reference gates pass with no skips | Not passed; CX-4 smoke only | "Backtest harness is ready; full public-dataset gate still needs to run." |
| 5 | Head-to-head agent comparison | Nonzero real LLM rows, no future leakage, honest scorecard | Blocked by `real_llm_rows=0` | "The benchmark now blocks proof claims until a real LLM lane runs." |
| 6 | Live account proof | Real customer/ad-account pilot with geo or holdout validation | Not started | "A real geo/holdout pilot is the next milestone." |

## Red Lines

Do not say:

- "AdMatix has proven live spend lift."
- "AdMatix guarantees ROAS improvement."
- "The simulator proves the product works in the wild."
- "The LLM buyer benchmark is complete" while `real_llm_rows` is zero.
- "Criteo backtests passed" until the full-dataset slow gate exits 0 and the metrics file reports `criteo_sample_rows=null`.
- "Phase 4 is green" until CX-2 slow validation, CX-4 full backtests, and the real LLM/head-to-head requirements are satisfied.

## Safe YC Wording

Current safe version:

> AdMatix is an evidence-gated control plane for AI-run paid media. Agents can
> propose campaign changes, but deterministic evidence, policy, approval, and
> verifier gates decide whether the action can proceed. Today the system runs
> end-to-end in dry-run mode on fixtures and simulator worlds, with public
> dataset backtest harnesses staged. We are not claiming live spend lift yet;
> the next proof step is completing public RCT gates and then a real geo/holdout
> pilot.

After Phase 4 gates pass:

> AdMatix's independent verifier is calibrated on seed-controlled simulations
> and back-tested on public randomized-trial datasets. It still does not claim
> per-decision causal certainty; low-evidence actions are labelled
> inconclusive or blocked.

After a real pilot:

> AdMatix has validated its evidence-gated workflow on a live account through a
> pre-registered geo/holdout design. The claim is limited to the measured pilot
> scope, not a universal lift guarantee.

## Phase 5 Entry Checklist

Phase 5 proof-package work must not start until:

- CX-1 and CX-7 are reviewed and merge-ready.
- CX-2 slow Phase 4 calibration gate completes on Linux/VPS and reports green,
  or the proof report explicitly presents the failure as a finding.
- CX-3 has nonzero `real_llm_rows` if the proof narrative compares LLM buyers.
- CX-4 full Criteo/Hillstrom gates run with no dataset skips, or the proof
  report limits itself to smoke/readiness results.
- GitHub Actions billing is fixed or local equivalent gates are recorded for
  every merge candidate.
- The final proof report repeats every claim limit in this matrix.
