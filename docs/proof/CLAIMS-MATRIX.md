# AdMatix Claims Matrix

Snapshot date: 2026-05-24

This matrix is the proof-package guardrail. AdMatix may claim only what is
implemented, measured, and backed by an accepted artifact. It must not claim
live paid-media lift until a real customer geo or holdout pilot has run.

## Current Evidence State

| Area | Evidence artifact | Status | Honest claim | Forbidden overclaim |
| --- | --- | --- | --- | --- |
| Product loop | `pnpm demo`, `tests/e2e/demo-flow.test.ts`, CLI/API/MCP dry-run path | PASS on `main`; Windows CLI entrypoint reproduction fix in `codex/phase5-proof-package` | AdMatix can run a deterministic evidence-gated dry-run loop over fixture account data and block unsafe budget actions. | "AdMatix is running live ad accounts" or "AdMatix autonomously changes spend." |
| Evidence and policy | `packages/evidence`, `packages/policy`, H0 packets, EvidenceLedger tests | PASS | Agent proposals are gated by deterministic evidence and policy checks before any dry-run diff is accepted. | "The LLM is trusted to decide spend" or "all evidence implies causal lift." |
| Supabase data layer | migrations/dbt/ledger schemas on `main`; Supabase connected on VPS | IMPLEMENTED | AdMatix has a managed Postgres/Supabase data-layer shape for ledger, app, warehouse, simulator, benchmark, shadow connector syncs, experiment designs, and proof bundles. | "Production multi-tenant SaaS isolation is fully proven." |
| Simulator | `services/simulator` plus robustness worlds | PASS | AdMatix can generate seeded ad-campaign worlds with known ground truth, including clean, confounded, geo, placebo, and robustness cases. | "Simulation proves real-world lift." |
| Verifier | `services/verifier`; independent FastAPI service and in-process validation path | PASS | The verifier returns estimate, CI, method, verdict, confounders, guardrail audit result, and claim limit for supported evidence designs; weak or unsupported H0 designs default to inconclusive. | "Every per-decision causal effect is rigorously identified." |
| Validation calibration | `docs/proof/artifacts/cx2-validation-summary.json` | PASS | Simulator/verifier calibration passes SBC, coverage, RMSE/bias, multiseed, placebo, and robustness wrong-claim gates. | "The simulator covers every real ad-platform failure mode." |
| Head-to-head benchmark | `docs/proof/artifacts/cx3-headtohead-summary.json` | READY | The benchmark contains 28 real Claude subscription buyer rows inside a simulated paid-media benchmark, zero fallback rows, zero failed rows, and no live-market or causal lift claim. | "The LLM buyer has proven live-market superiority." |
| Public-dataset backtests | `docs/proof/artifacts/cx4-backtests-summary.json` | PASS | Full Criteo Uplift v2.1 and Hillstrom aggregate backtests ran with no dataset skips and recorded checksums. | "Criteo/Hillstrom prove live spend lift." |
| Dashboard visibility | `https://admatix.tech` and `/artifacts` | LIVE | The dashboard opens on artifact-backed aggregate proof, explicitly states it is not continuous live ad-account data, and labels older sample pages as illustrative Demo Lab views. | "Dashboard demo samples are live proof." |
| Production hygiene and CI | GitHub Actions on `main` at `629108a` | GREEN before Phase 5 patch | Node, Python service tests, dashboard checks, audit, and secret scanning run in CI. | "Runtime production hardening is complete for all SaaS tenants." |

## Claim Levels

| Level | Label | Required evidence | Current state | Allowed wording |
| --- | --- | --- | --- | --- |
| 0 | Demo mechanics | Fixture demo and tests pass | PASS | "We built an evidence-gated dry-run workflow for AI-run paid media." |
| 1 | Safety control plane | Policy/evidence gates block unsafe or unsupported actions | PASS | "Agents can propose, but deterministic code gates spend-touching actions." |
| 2 | Independent verification engine | Verifier service produces estimates/CIs/verdicts and is separate from acting agents | PASS | "The verifier is an independent service, not the acting agent." |
| 3 | Calibrated simulator validation | CX-2 SBC, coverage, RMSE/bias, multiseed gates pass | PASS | "The verifier is calibrated on seeded simulator worlds within the stated model limits." |
| 4 | Public RCT backtests | Full Hillstrom plus Criteo Uplift v2.1 gates pass with no skips | PASS | "Public randomized/backtest datasets recover aggregate measured effects with published checksums." |
| 5 | Head-to-head agent comparison | Nonzero real LLM rows, no fallback counting, no future leakage | READY | "The benchmark contains real LLM buyer rows and honest lane accounting in simulation." |
| 6 | Live account proof | Real customer/ad-account pilot with geo or holdout validation, represented by pre-registered `app.experiment_designs` and promoted through immutable `app.proof_bundles` | NOT STARTED | "A real geo/holdout pilot is the next milestone." |

## Red Lines

Do not say:

- "AdMatix has proven live spend lift."
- "AdMatix guarantees ROAS improvement."
- "The simulator proves the product works in the wild."
- "Every budget decision has a rigorous causal estimate."
- "Public RCT backtests are the same as production ad-account proof."
- "Dashboard demo pages are live proof."

## Safe External Wording

Current safe version:

> AdMatix is an evidence-gated control plane for AI-run paid media. Agents can
> propose campaign changes, but deterministic evidence, policy, approval, and
> verifier gates decide whether the action can proceed. The system runs
> end-to-end in dry-run mode, the verifier is calibrated on seeded simulator
> worlds, and the public RCT/backtest gates pass with aggregate metrics. We are
> not claiming live spend lift yet; the next proof step is a real geo or holdout
> pilot.

After a real pilot:

> AdMatix has validated its evidence-gated workflow on a live account through a
> pre-registered geo/holdout design. The claim is limited to the measured pilot
> scope, not a universal lift guarantee.

## Phase 5 Completion Checklist

- Fresh clone reproduces the demo and CX-2 validation gate.
- `docs/proof/PROOF-REPORT.md` states every result with claim limits.
- `docs/proof/PHASE5-DEMO-PACKAGE.md` records the demo sequence.
- `/artifacts` is the primary dashboard proof route.
- Older dashboard pages stay visibly illustrative.
- CX-3 and CX-4 phase reports point to the final accepted artifacts.
- Raw Criteo/Hillstrom data remains untracked.
