# AdMatix Dataset And Benchmark Intake Plan

Status: roadmap for post-proof evidence expansion  
Last updated: 2026-05-25

The next evidence work is not to add every ad dataset. It is to add datasets
only when their claim type is explicit and useful. AdMatix separates causal
proof, verifier calibration, prediction realism, programmatic safety, creative
policy, and agent-task competence.

## Intake Rule

Every dataset or benchmark must ship with:

- source URL and access date;
- license and commercial-use status;
- redistribution limits;
- raw checksum and row count;
- schema version and freshness;
- claim type: causal, OPE, prediction, programmatic, creative safety, agent
  task, or demo only;
- explicit statement of what the source cannot prove.

Raw customer, Criteo, Hillstrom, and large public datasets stay untracked. Commit
only manifests, checksums, aggregate metrics, and safe reports.

## Current Evidence To Keep

| Source | Current use | Claim type | Boundary |
| --- | --- | --- | --- |
| Criteo Uplift v2.1 | Public backtest gate | Public randomized/uplift evidence | Aggregate recovery only, not customer live proof |
| Hillstrom | Public RCT backtest gate | Public randomized evidence | Email-campaign domain, not paid-media platform proof |
| Seeded simulator truth | CX-2 validation | Calibration and stress testing | Simulated truth is not real-world lift |
| CX-3 LLM benchmark | Agent lane accounting | Agent-task benchmark | Simulated task arena, not market superiority |
| CX-4 artifacts | Public backtest summary | Aggregate public evidence | Aggregate-only due license/data constraints |

## Add Next

| Source | Why it helps | Acceptance |
| --- | --- | --- |
| Open Bandit Dataset / OBP | Logged-policy OPE with propensities | IPS/SNIPS/DR estimates include overlap, clipping, and ESS diagnostics |
| Criteo Attribution slice | Attribution and leakage checks | No future-data leakage; attribution labeled non-causal |
| GA4 ecommerce sample | Warehouse and dashboard demo realism | No causal claim; maps ecommerce revenue columns cleanly |
| Brand-safety/ad-copy datasets | Creative/policy false-accept tests | Measures unsafe claim and policy-bypass false accepts |

## Add Later

| Source | Use | Why later |
| --- | --- | --- |
| Criteo CTR / 1TB | CTR/CVR prediction realism | Large, expensive, not causal proof |
| Avazu | CTR prediction and sparse categorical features | Prediction lane only |
| iPinYou | RTB/programmatic bidding and pacing | Requires separate auction/pacing metrics |
| AuctionGym | Controlled auction simulation | Safety/regret/pacing, not incrementality |
| Taobao User Behavior | Recommender/propensity realism | License/provenance review first |
| Amazon Reviews | Copy/recommender/product signal realism | Not ad incrementality |
| Kaggle marketing datasets | Demo segmentation and ROI examples | Variable quality/licensing |

## AD-Bench Placement

AD-Bench belongs under `services/benchmark`, not under the verifier. It should
score advertising analytics agents on:

- task success and Pass@1/Pass@3;
- trajectory coverage and tool-call correctness;
- evidence citation quality;
- unsafe recommendation rate;
- hallucinated metric/platform-field rate;
- fallback or non-real-LLM row accounting.

AD-Bench does not replace H0 packets, randomized holdouts, verifier calibration,
or public RCT/backtest gates. It answers: "Can the agent do advertising
analytics work safely and with evidence?" It does not answer: "Did this action
cause incremental lift?"

## Simulator Improvement Backlog

Add realism in this order:

1. Attribution lag and delayed conversion censoring.
2. Platform learning phases and learning-reset penalties.
3. Budget pacing and cap violations.
4. Auction dynamics: bid requests, bids, wins, clearing price, eCPM.
5. Creative fatigue and saturation.
6. Sparse geo power limits and underpowered tests.
7. Privacy thresholds, row suppression, and modeled conversions.
8. Cross-channel interference and halo effects.
9. Seasonality, holidays, and promotion shocks.
10. Competitor or inventory shocks.

Each addition needs at least one "easy" world where the verifier should recover
truth and one "hard" world where the correct behavior may be abstention.

## Implementation Order

1. Add dataset manifest schema and license registry.
2. Add OBP/OPE lane with tiny fixture first, then full public data.
3. Add Criteo Attribution leakage tests.
4. Add AD-Bench task schema and one small imported sample.
5. Add programmatic lane with AuctionGym/iPinYou after OPE is stable.
