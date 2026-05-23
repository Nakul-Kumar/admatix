# AdMatix Verification Engine — Proof Report

**Status:** Skeleton with `[[PHASE-4 RESULT: ...]]` placeholders pending the experiment run.
**Audience:** Technical reviewer (YC proof package).
**Last updated:** 2026-05-23

---

## 0. Scope — What This Proves and What It Doesn't

AdMatix gates AI-proposed ad-campaign changes against guardrails, logs every decision in a tamper-evident hash-chained ledger, and runs an **independent verification engine** — separate from the acting agent — to estimate whether a change produced incremental lift.

This report tests **one claim**: *the independent verifier produces calibrated, well-behaved effect estimates and correctly abstains when evidence is weak.*

**This report proves:**
- On a generative simulator where the true incremental lift is known by construction, the verifier recovers it within stated error bounds.
- The verifier's confidence intervals have the coverage they advertise.
- The verifier abstains (`inconclusive`) on low-evidence and null-effect cases instead of inventing a number.
- The deterministic guardrail-compliance proof and hash-chained ledger behave exactly as specified.

**This report does NOT prove:**
- That AdMatix yields a rigorous, audit-grade causal number for any *single arbitrary* real-world campaign. Real ad platforms have unobserved confounders, interference, and non-stationarity that no observational method fully resolves. The verifier returns an **estimate + confidence interval + method + named confounders**, and labels low-evidence decisions `inconclusive` by design.
- That simulator performance transfers 1:1 to any specific advertiser account.
- Anything about creative quality, brand safety, or ROAS targets — out of scope here.

Honesty about claim limits is a core value of the product and of this document. Every section below states both what its evidence supports and what it cannot.

---

## 1. Ground-Truth Recovery on the Generative Simulator

**What we test.** The simulator generates synthetic campaigns from a known structural model: treatment assignment, baseline conversion, and a configurable true incremental lift `τ`. Because `τ` is set by construction, we can compare the verifier's estimate `τ̂` directly against truth across the full operating range.

**Method.** We sweep `τ` across `[[PHASE-4 RESULT: τ range, e.g. -2% to +8%]]` over `[[PHASE-4 RESULT: N campaigns]]` simulated campaigns spanning realistic budget, audience-size, and noise regimes. For each, the verifier runs blind to `τ` and emits `τ̂`, a 95% CI, and a method label.

**Result.** Mean absolute recovery error: `[[PHASE-4 RESULT: MAE]]`. Correlation between `τ̂` and `τ`: `[[PHASE-4 RESULT: Pearson r]]`. Recovery scatter plot (truth vs. estimate, with the y=x line): `[[PHASE-4 RESULT: figure ref]]`.

**What this proves.** Inside the simulator's modeling assumptions, the verifier tracks the true effect rather than the acting agent's self-report — confirming the engine is measuring lift, not echoing intent.

**What this does NOT prove.** Recovery is only as good as the simulator is realistic. This section establishes a *necessary* condition (the estimator is unbiased under known structure), not a *sufficient* one for arbitrary real campaigns. Sections 8 and 11 address the realism gap directly.

---

## 2. Simulation-Based Calibration / Rank Uniformity

**What we test.** Beyond point accuracy: is the verifier's full posterior *calibrated*? A correctly specified Bayesian estimator passes Simulation-Based Calibration (SBC) — the rank of the true `τ` within the verifier's posterior draws is uniformly distributed across many simulated datasets.

**Method.** We run `[[PHASE-4 RESULT: SBC replications]]` cycles: draw `τ` from the prior, simulate a campaign, fit the verifier, compute the rank of true `τ` among `[[PHASE-4 RESULT: posterior draws]]` draws. We then test rank uniformity (histogram + ECDF deviation, with `[[PHASE-4 RESULT: uniformity test + p-value]]`).

**Result.** SBC rank histogram: `[[PHASE-4 RESULT: figure ref]]`. Max ECDF deviation from uniform: `[[PHASE-4 RESULT: deviation]]`. Uniformity test outcome: `[[PHASE-4 RESULT: pass/fail + statistic]]`.

**What this proves.** A flat SBC histogram means the verifier's uncertainty is *honest at the distributional level* — it is neither over- nor under-confident on average. A ∩-shaped histogram would signal over-confidence; a ∪-shape, under-confidence.

**What this does NOT prove.** SBC validates self-consistency between the prior, the model, and the inference algorithm. It cannot detect a prior or likelihood that is jointly mis-specified relative to the *real world* — only relative to itself. It is an internal-coherence check, not an external-validity check.

---

## 3. Confidence-Interval Coverage

**What we test.** When the verifier reports a 95% confidence interval, does the true `τ` actually fall inside it 95% of the time? CI coverage is the single most important honesty property of the product: the CI is what an operator trusts.

**Method.** Over `[[PHASE-4 RESULT: N coverage trials]]` independent simulated campaigns, we record whether each reported interval contains the known `τ`. We report empirical coverage at the 80%, 90%, and 95% nominal levels, with `[[PHASE-4 RESULT: binomial CI on the coverage rate]]`. We also report mean interval width to confirm coverage is not bought with uselessly wide intervals.

**Result.** Empirical coverage — 95% nominal: `[[PHASE-4 RESULT: %]]`; 90%: `[[PHASE-4 RESULT: %]]`; 80%: `[[PHASE-4 RESULT: %]]`. Mean 95% interval width: `[[PHASE-4 RESULT: width]]`. Coverage-vs-nominal calibration curve: `[[PHASE-4 RESULT: figure ref]]`.

**What this proves.** Coverage at or near nominal means the verifier's stated uncertainty can be taken at face value within the simulator — the headline reliability property.

**What this does NOT prove.** Coverage is conditional on the simulator's data-generating process. Under real-world confounding the same nominal interval will under-cover; this is precisely why low-evidence decisions are labeled `inconclusive` and why Section 8 reports back-test behavior on data the engine did not generate.

---

## 4. RMSE and Bias of Point Estimates

**What we test.** Decomposed estimator error: systematic bias (does `τ̂` lean high or low?) versus variance (how noisy is it?). RMSE summarizes both.

**Method.** Across the simulation sweep we compute RMSE, mean signed bias, and variance of `τ̂`, stratified by sample size and effect magnitude so a reviewer can see where the estimator is strong and where it degrades.

**Result.** Overall RMSE: `[[PHASE-4 RESULT: RMSE]]`. Mean signed bias: `[[PHASE-4 RESULT: bias]]`. RMSE by sample-size stratum: `[[PHASE-4 RESULT: table]]`. RMSE by effect-size stratum: `[[PHASE-4 RESULT: table]]`.

**What this proves.** Near-zero signed bias confirms the verifier is not systematically flattering (or punishing) the acting agent. The stratified breakdown defines the verifier's honest operating envelope — the regimes where its numbers are trustworthy.

**What this does NOT prove.** Low simulator RMSE does not bound real-world error, where bias can be induced by confounders absent from the generative model. RMSE here measures *estimator quality under known structure*, not *end-to-end accuracy in production*.

---

## 5. Qini / AUUC for Uplift Ranking

**What we test.** Many decisions are about *targeting* — which segments to spend on. Beyond a single `τ̂`, can the verifier rank units by individual uplift? Qini curves and AUUC (Area Under the Uplift Curve) measure this.

**Method.** On simulated campaigns with known per-unit uplift, we compute the verifier's Qini curve and AUUC, benchmarked against a random-targeting baseline and a perfect-oracle ranking.

**Result.** AUUC (verifier): `[[PHASE-4 RESULT: AUUC]]`. AUUC (random): `[[PHASE-4 RESULT: baseline AUUC]]`. Qini coefficient: `[[PHASE-4 RESULT: Qini]]`. Qini curve plot vs. random and oracle: `[[PHASE-4 RESULT: figure ref]]`.

**What this proves.** An AUUC meaningfully above random shows the verifier captures heterogeneous treatment effects, not just an average — relevant when the gated change is a budget reallocation across segments.

**What this does NOT prove.** Qini/AUUC are *relative ranking* metrics. A good Qini score does not certify the *absolute* magnitude of any segment's uplift, and uplift ranking is sensitive to the same confounding caveats as Sections 3–4.

---

## 6. Placebo / Negative-Control Tests

**What we test.** The most dangerous failure mode is a verifier that "finds" lift that isn't there. We deliberately feed it cases with **zero true effect** and cases with **fake treatments** (random assignment, no causal pathway) and check that it abstains.

**Method.** Three negative controls: (a) `τ = 0` campaigns; (b) placebo treatment — a random flag with no effect on outcomes; (c) outcome permutation — labels shuffled to destroy any signal. For each we record the false-positive rate (significant non-zero lift claimed) and the `inconclusive` rate.

**Result.** False-positive rate at `τ = 0`: `[[PHASE-4 RESULT: %]]`. Placebo-treatment false-positive rate: `[[PHASE-4 RESULT: %]]`. Permutation false-positive rate: `[[PHASE-4 RESULT: %]]`. `inconclusive` rate on negative controls: `[[PHASE-4 RESULT: %]]`.

**What this proves.** A false-positive rate at or below the nominal significance level — paired with a high `inconclusive` rate — demonstrates the verifier's core honesty guarantee: it does not manufacture lift, and it knows when it doesn't know.

**What this does NOT prove.** Negative controls confirm the verifier resists *spurious* signal in controlled settings. They do not guarantee it resists *every* real-world confounder that could mimic a true effect; they bound one specific, critical failure mode.

---

## 7. Multi-Seed Variance

**What we test.** Determinism and stability. Re-running the verifier under different random seeds (and re-simulating under different seeds) should not swing conclusions. Guardrail-compliance proofs must be bit-identical; statistical estimates must be stable within their stated CIs.

**Method.** We repeat the full pipeline across `[[PHASE-4 RESULT: number of seeds]]` seeds and report: (a) spread of `τ̂` for fixed campaigns, (b) decision-flip rate (would a different seed change `block`/`allow`/`inconclusive`?), (c) byte-level identity of the deterministic guardrail proof.

**Result.** Std. dev. of `τ̂` across seeds: `[[PHASE-4 RESULT: std]]`. Decision-flip rate: `[[PHASE-4 RESULT: %]]`. Guardrail-proof determinism: `[[PHASE-4 RESULT: pass/fail — bit-identical across all seeds]]`.

**What this proves.** Low cross-seed variance shows reported numbers are properties of the data, not artifacts of a lucky seed. Bit-identical guardrail proofs confirm the *compliance* layer is fully deterministic and auditable, as a gate must be.

**What this does NOT prove.** Seed stability is a reproducibility property. It says nothing about accuracy — a stably biased estimator is still biased. Read this section alongside Sections 3–4.

---

## 8. Back-Tests on Criteo Uplift v2.1 and Hillstrom

**What we test.** Behavior on **public data the engine did not generate** — the bridge from simulator to reality. Criteo Uplift v2.1 (large-scale ad uplift, randomized treatment) and the Hillstrom email campaign dataset both carry a randomized treatment, giving a defensible reference effect.

**Method.** We run the verifier on held-out splits of each dataset, comparing `τ̂` and its CI against the randomized-experiment reference effect. We report coverage of the reference value, point error, and `inconclusive` rate on underpowered subsamples.

**Result.** Criteo v2.1 — `τ̂` vs. reference: `[[PHASE-4 RESULT: estimate vs. reference]]`; CI contains reference: `[[PHASE-4 RESULT: yes/no]]`. Hillstrom — `τ̂` vs. reference: `[[PHASE-4 RESULT: estimate vs. reference]]`; CI contains reference: `[[PHASE-4 RESULT: yes/no]]`. `inconclusive` rate on underpowered subsamples: `[[PHASE-4 RESULT: %]]`.

**What this proves.** Recovering the randomized reference effect on real, externally-collected ad data is the strongest evidence in this report that the verifier generalizes beyond its own simulator.

**What this does NOT prove.** Criteo and Hillstrom *contain* a randomized treatment, so confounding is mild by construction — they are a favorable real-world test, not a worst case. Production accounts where the AI agent itself drove past changes will be harder. This section narrows the simulator-to-reality gap; it does not close it.

---

## 9. End-to-End Gated-Loop Demonstration

**What we test.** The full product loop as an operator experiences it: an AI agent proposes a change → AdMatix gates it → logs it to the hash-chained ledger → the independent verifier grades the outcome.

**Method.** A scripted run: the simulated agent proposes two budget changes — one within guardrails, one breaching a budget cap. We capture (a) the guardrail decision and plain-English reason for each, (b) the resulting ledger entries and chain hashes, (c) a tamper test that edits one record and shows the chain break, (d) the verifier's graded estimate for the allowed change against the simulator's known true effect.

**Result.** Gate decisions: `[[PHASE-4 RESULT: allow/block per change + reasons]]`. Ledger chain integrity before tamper: `[[PHASE-4 RESULT: valid]]`. Chain integrity after edit: `[[PHASE-4 RESULT: broken at entry N]]`. Verifier grade on allowed change: `[[PHASE-4 RESULT: τ̂ + 95% CI vs. true τ]]`. Loop trace / screenshots: `[[PHASE-4 RESULT: figure ref]]`.

**What this proves.** The components in Sections 1–8 compose into a working system: gating, tamper-evident logging, and independent verification operate together end-to-end.

**What this does NOT prove.** The demonstration runs on the simulator for reproducibility. It proves the *mechanism* is sound and integrated; production-scale latency, throughput, and adversarial robustness are tracked separately.

---

## 10. Competitor Context

**What we test.** Whether existing tools already do what AdMatix does. We position against three categories: (a) ad-platform-native experiment tools (e.g. lift studies inside the ad platforms themselves), (b) marketing mix / incrementality vendors, (c) general AI-agent observability tools.

**Result.** Comparison matrix across: independent-of-acting-agent verification, deterministic guardrail gating, tamper-evident hash-chained ledger, calibrated CI + abstention, public-dataset-validated estimator: `[[PHASE-4 RESULT: comparison table]]`.

**What this proves.** The combination — *independent* verification + *deterministic* gating + *tamper-evident* logging + *calibrated abstention* — is, to our knowledge, not offered as a single system. Ad-platform tools are not independent of the platform; incrementality vendors do not gate changes pre-execution; observability tools do not verify causal lift.

**What this does NOT prove.** Competitive landscapes shift. This is a point-in-time scan, not a guarantee of durable differentiation; the moat argument rests on execution and the evidence in Sections 1–9.

---

## 11. Honest Failure Log and Claim Limits

**Purpose.** This section is deliberate. A proof package that reports only successes is not a proof — it is marketing. We list known failure modes, observed limitations, and the precise boundary of every claim.

**Observed failure modes (from the experiment run).** `[[PHASE-4 RESULT: enumerated failures — e.g. regimes where coverage degraded, datasets where the estimator was biased, conditions that triggered higher inconclusive rates]]`.

**Standing claim limits.**
1. **Causal claims are bounded.** The verifier never asserts a rigorous per-decision causal number on real data. It returns estimate + CI + method + named confounders, and labels weak evidence `inconclusive`.
2. **Simulator realism is an assumption.** Sections 1–7 are conditional on the generative model. Section 8 partially relaxes this; Section 11 does not pretend it is fully relaxed.
3. **Favorable real-world tests.** Criteo and Hillstrom carry randomized treatments. Confounded production accounts are harder and are explicitly out of scope for this report's claims.
4. **No interference modeling.** Cross-campaign spillover and auction-level interference are not modeled here.
5. **Non-stationarity.** Seasonality and platform algorithm changes can break estimates; the verifier flags but does not fully correct for drift.
6. **Abstention is a feature, not a gap.** A high `inconclusive` rate on weak data is correct behavior. We report it transparently rather than tuning it away.

**Bottom line.** AdMatix proves it can *gate deterministically*, *log tamper-evidently*, and *verify with calibrated, honest uncertainty* — recovering known truth in simulation and the randomized reference effect on public ad data, while abstaining when evidence is thin. It does not claim, and this report does not support, audit-grade causal certainty on arbitrary real campaigns. That honesty is the product.
