# AdMatix Technical Proof Report

Status: final Phase 5 proof package draft  
Snapshot commit: `629108a` plus the Phase 5 reproduction fixes in `codex/phase5-proof-package`  
Audience: technical reviewer  
Last updated: 2026-05-24

## 1. Claim Boundary

AdMatix is an evidence-gated control plane for AI-run paid media. Agents can
propose campaign changes, but deterministic evidence, policy, approval, and
independent verification gates decide whether the action can proceed.

This report supports one narrow claim:

> Calibrated simulator evidence plus public randomized-trial backtests show that
> the AdMatix verification loop behaves honestly: it blocks unsafe actions,
> estimates lift with uncertainty when the evidence design supports it, and
> abstains or limits claims when it should.

This report does not prove live paid-media spend lift. It does not prove that
every single campaign decision has a rigorous causal estimate. It does not
replace a real customer geo or holdout pilot. Low-evidence cases remain
`inconclusive` by design.

## 2. Evidence Inventory

| Artifact | Status | Source | What it supports | Claim limit |
| --- | --- | --- | --- | --- |
| CX-2 validation repair | PASS | `docs/proof/artifacts/cx2-validation-summary.json` from `codex/cx2-validation-repair` at `b925370` | Simulator plus verifier calibration over generated worlds with known truth | Simulator validation only; robustness worlds prove no confident wrong claim, not guaranteed lift recovery |
| CX-3 head-to-head benchmark | READY | `docs/proof/artifacts/cx3-headtohead-summary.json` from `codex/cx3-headtohead-repair` at `b8028a03aca6d46a6f582733fe0deb39635a43d3` | Real Claude subscription buyer rows exist, and the benchmark accounts for fallback/failed/skipped rows | Simulated paid-media evidence, not live account evidence |
| CX-4 public RCT backtests | PASS | `docs/proof/artifacts/cx4-backtests-summary.json` from `codex/cx4-backtests-benchmarks` at `7f9a185e1711e39b673d3008c7b8fb5a93549502` | Full Criteo Uplift v2.1 and Hillstrom aggregate checks recover measured randomized effects | Public RCT/backtest evidence only; raw rows are not redistributed |

All dashboard-visible proof artifacts carry `origin.kind = "artifact"`. Older
dashboard sample pages remain labeled as illustrative demo data.

## 3. Product Loop Proof

The Phase 1 demo exercises the full dry-run loop:

1. `admatix audit` finds account issues over fixture data.
2. `admatix plan` creates H0 packets with deterministic evidence hashes.
3. `admatix activate --dry-run` returns a diff rather than mutating an ad platform.
4. `PolicyGuard` blocks an unsafe budget increase.
5. The benchmark and MCP read-only tool surface run without granting mutation rights.
6. The cockpit/dashboard shows the proof trail and data-origin labels.

The current demo is intentionally dry-run only. It proves that the control path
exists and that unsafe actions can be blocked before platform mutation. It does
not prove live account operation.

## 4. CX-2 Validation Results

The repaired validation gate exercises the production simulator-to-verifier path
over clean, confounded, geo, placebo, non-stationary, interference, and
adversarial worlds. Easy worlds must recover truth. Hard worlds are allowed to
abstain or flag limits, but confident wrong claims fail the gate.

| Check | Result | Acceptance |
| --- | ---: | --- |
| SBC simulations | 500 | Rank uniformity required |
| SBC chi-square p-value | 0.7598939812328932 | PASS, above 0.05 |
| 95% empirical CI coverage | 0.964815 | PASS, within [0.93, 0.97] |
| CATE coverage | 0.9625 | PASS |
| Geo coverage | 0.969444 | PASS |
| RMSE/bias worlds | 1,320 | PASS |
| Multiseed configs | 22 configs x 60 seeds | PASS |
| Maximum wrong-claim rate | 0.0 | PASS |
| Placebo false-positive rate | 0.05 | PASS at threshold 0.05 |
| Semantic verdict stability minimum | 1.0 | PASS |

Per-world point-estimate diagnostics:

| World type | RMSE | Bias | True lift mean | Notes |
| --- | ---: | ---: | ---: | --- |
| `clean_ab` | 0.0102309748 | -0.0005934825 | 0.06 | Powered randomized setting |
| `confounded` | 0.0103840370 | 0.0003507619 | 0.06 | Confounders tested with abstention/limit behavior |
| `geo_structured` | 0.0144358500 | -0.0006020891 | 0.0614739399 | 25 estimates flagged underpowered |

What this proves: within the simulator's modeled worlds, the verifier's
uncertainty is calibrated and its hard-world behavior avoids confident false
claims.

What this does not prove: the simulator is still a model. Real ad accounts can
have unobserved confounding, auction changes, platform throttling, creative
fatigue, and cross-channel interference outside this generator.

## 5. CX-3 Head-to-Head Benchmark Results

The repaired benchmark includes explicit lane accounting so fallback rows cannot
masquerade as LLM evidence.

| Metric | Value |
| --- | ---: |
| Run id | `bench_2dfb070dd106` |
| Rows | 168 |
| Decisions | 672 |
| Real LLM rows | 28 |
| Deterministic fallback rows | 0 |
| Failed LLM rows | 0 |
| Skipped LLM rows | 0 |
| Proof readiness | READY |
| Scale-up proposals | 1,082 |
| Scale-ups blocked by gate | 359 |
| False scale-ups prevented | 189 |

Head-to-head aggregate deltas:

| Comparison | Paired worlds | Mean net incremental value delta | Mean wasted spend delta | Mean true iROAS delta | Win rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| B vs A | 42 | 1511.978955 | -1499.15 | 0.065039 | 0.738095 |
| D vs C | 42 | 401.616021 | -425.333333 | 0.020704 | 0.714286 |

What this proves: the benchmark now contains real Claude subscription buyer rows,
future-data leakage guards, and strict fallback accounting. In this simulated
benchmark, evidence-gated decisions reduce wasted spend and improve measured
value relative to the compared lanes.

What this does not prove: the benchmark remains simulated paid-media evidence.
It is not proof of live account performance or production buyer superiority.

## 6. CX-4 Public RCT Backtest Results

The public-dataset gate uses aggregate metrics only. Raw datasets are staged
locally/VPS-side and are not committed.

### Criteo Uplift v2.1

| Metric | Value |
| --- | ---: |
| Rows total | 13,979,592 |
| Sample rows | null, full dataset |
| Train rows | 6,989,911 |
| Test rows | 6,989,681 |
| Dataset SHA-256 | `e4d7c710ca1f38e523309d0f8a0745d1b53e7392d51f20d1088b6cfeaef222ef` |
| Propensity AUC | 0.5 |

| Outcome | ATE estimate | 95% CI | AUUC | Qini | Status |
| --- | ---: | --- | ---: | ---: | --- |
| Visit | 0.010210954645717828 | [0.009799662796724999, 0.01059181874985] | 0.007486227057151881 | -14252.13734089829 | PASS |
| Conversion | 0.001139932268972325 | [0.00104124808775, 0.001237334597525] | 0.0016086782884141668 | -683.4170877879599 | PASS |

### Hillstrom

| Metric | Value |
| --- | ---: |
| Rows | 64,000 |
| Dataset SHA-256 | `0e5893329d8b93cefecc571777672028290ab69865718020c78c7284f291aece` |
| Pooled AUUC | 0.06936074595323202 |

| Arm | Outcome | ATE estimate | 95% CI | AUUC | Status |
| --- | --- | ---: | --- | ---: | --- |
| Mens email | Visit | 0.07658956365153125 | [0.06996832282545, 0.0830195368057] | 0.08373360323310469 | PASS |
| Womens email | Visit | 0.045233106587052985 | [0.039239265590999994, 0.05142302521895] | 0.05498788867335935 | PASS |

What this proves: the system can run full public RCT/backtest gates without
dataset skips and produce aggregate lift/uplift metrics with checksums.

What this does not prove: public RCTs are favorable measurement settings and do
not cover every operational constraint of live ad accounts. The Criteo data is
CC BY-NC-SA 4.0; raw rows must not be redistributed through this repo.

## 7. Dashboard Proof View

The public dashboard at `https://admatix.tech` is now intended to open on the
artifact-backed proof view. The `/artifacts` route reads only aggregate JSON
from `proof-dashboard/public/data/artifacts/`.

Older dashboard pages (`/overview`, `/worlds`, `/benchmark`, `/validation`, and
`/decisions`) are retained as illustrative UX samples. They must continue to
show visible origin badges such as `demo`, `fixture`, `artifact`, or
`unavailable`; they must never imply live proof.

## 8. Remaining Risks and Next Proof Step

The next evidence step is a pre-registered live geo or holdout pilot. That pilot
should define the action class, measurement window, MDE/power threshold,
guardrails, logging policy, and allowed claim before the first dollar of live
spend is changed.

Until that exists, the safe external claim is:

> AdMatix has a working evidence-gated dry-run loop, a calibrated
> simulator/verifier proof path, real-LLM benchmark accounting, and full public
> RCT/backtest aggregate evidence. It has not yet proven live paid-media lift.
