# AdMatix — Simulation & Verification Methodology

Status: build-ready spec. Audience: automated build agents and human reviewers.
Scope: the Python "verification science" layer — the campaign simulator, the
verifier, and the research-grade validation harness. This layer is the
independent evidence engine for AI-run paid advertising. It is deliberately
separate from any execution agent: it never spends money and never trusts an
agent's self-report.

Design contract (non-negotiable): the verifier **never** returns a bare
per-decision causal number presented as ground truth. Every `/verify` response
is an estimate **plus** a confidence interval, the method used, the confounders
considered, and a deterministic guardrail-compliance proof. When evidence is
too thin to separate signal from noise, the verdict is `inconclusive` — this is
a first-class, expected outcome, not a failure.

---

## 1. The Campaign Simulator

The simulator produces synthetic ad-campaign "worlds" where the **true
incremental effect is known by construction** and stored as ground truth. It is
the only place in the system where causal truth exists; everything downstream
is judged against it.

### 1.1 Generative model

For each simulated world we generate `N` user-period rows. Per user `i`:

1. **Covariates** `X_i` — drawn from a mixture calibrated to real ad data
   (age band, device, recency, frequency, prior conversions). Marginals are
   fit so distributions resemble Criteo/Hillstrom (see §1.4).
2. **Baseline propensity** — `p0_i = sigmoid(β·X_i + s(t) + ε_i)` where `s(t)`
   is a seasonality term and `ε_i` is per-user noise.
3. **Treatment assignment** `W_i ∈ {0,1}` — assignment rule depends on world
   type (§1.3). Treatment fraction is a parameter.
4. **Heterogeneous true lift** — `τ_i = base_lift · m(X_i)`, where `m(X_i)` is a
   bounded modifier producing CATE heterogeneity. `τ_i` is the **recorded
   ground truth**.
5. **Outcome** — `y_i ~ Bernoulli(clip(p0_i + W_i·τ_i, 0, 1))`. Revenue per
   conversion is drawn from a calibrated log-normal so spend/ROAS are realistic.

Ground truth persisted with every world: per-user `τ_i`, the population
**ATE** `= mean(τ_i)`, the treated-group **ATT**, the seasonality curve, the
confounder coefficients, and the RNG seed. Worlds are fully reproducible from
`(config, seed)`.

### 1.2 Exposed parameters

| Parameter | Symbol | Default | Notes |
|---|---|---|---|
| Baseline conversion rate | `baseline_cr` | 0.03 | population mean of `p0` |
| True incremental lift | `true_lift` | 0.005 | additive ATE; set 0 for placebo |
| Budget | `budget` | 50_000 | caps treated impressions |
| Audience size | `n_users` | 200_000 | rows generated |
| Outcome noise | `noise_sd` | 0.4 | sd of `ε_i` on logit scale |
| Seasonality amplitude | `seasonality` | 0.0–0.3 | weekly + holiday components |
| Confounder strength | `confound_strength` | 0.0 | coupling of `X` to both `W` and `y` |
| Treatment fraction | `treat_frac` | 0.5 | share assigned to treatment |
| Periods | `n_periods` | 90 | days, for time-series worlds |
| Geo count | `n_geos` | 100 | for geo-structured worlds |

### 1.3 World types

- **Clean A/B world** — `W_i` Bernoulli(`treat_frac`), independent of `X`.
  `confound_strength = 0`. Unbiased difference-in-means is the correct answer;
  used to confirm the verifier is not biased on easy cases.
- **Geo-structured world** — users nested in geos; treatment assigned at the
  **geo** level (whole markets on/off). Geo-level random effects add
  correlated noise. Exercises geo-holdout estimators and the power/MDE path.
- **Confounded world** — `confound_strength > 0`: covariates drive both
  assignment and outcome (e.g., high-recency users are over-targeted *and*
  convert more). Naive difference-in-means is biased; only adjusted estimators
  (synthetic control, meta-learners, DR) should recover `τ`.
- **Zero-lift placebo world** — `true_lift = 0`. Everything else (noise,
  seasonality, confounding) stays on. The verifier **must** return
  `~zero` / `inconclusive` and must not manufacture a significant effect.

### 1.4 Calibration to real data

Before a world is accepted, marginal distributions (conversion rate per
treatment arm, covariate histograms, revenue distribution) are compared to
reference fits from Criteo Uplift v2.1 and Hillstrom. A world passes
calibration if each marginal's 1-Wasserstein distance to the reference is below
a configured tolerance. This keeps simulated worlds realistic enough that
verifier performance transfers to real campaigns.

---

## 2. The Verifier

The verifier is layered: it applies the strongest method the available evidence
supports and **degrades gracefully** to weaker methods (or `inconclusive`) when
evidence is thin. All methods run inside one FastAPI service.

### 2.1 Layer (a) — Deterministic guardrail-compliance proof

Pure, deterministic, no statistics. Checks the action log against hard
constraints: budget cap not exceeded, frequency caps respected, brand-safety
exclusions honored, bid ceilings, geo/audience allow-lists, pacing bounds. The
output is a structured **proof object**: ordered list of `(rule_id, predicate,
inputs, pass|fail)`. This always runs and is independent of any causal claim —
a campaign can be guardrail-compliant yet have inconclusive lift, and vice
versa. Implemented in plain Python; no external library.

### 2.2 Layer (b) — Pre/post with synthetic control / BSTS

For time-series worlds with a clean pre-period and control units: build a
Bayesian structural time-series counterfactual and report the gap between
observed and predicted post-period outcomes.

- **Library:** `tfp-causalimpact` (Google's official TensorFlow-Probability
  CausalImpact). Use `tfp-causalimpact` for new code; `tfcausalimpact` 0.0.18 is
  the older community port and is acceptable only as a pinned fallback.
- Output: posterior mean effect + 95% credible interval. If the interval spans
  zero → `inconclusive`.

### 2.3 Layer (c) — Uplift / CATE meta-learners

For user-level worlds with covariates: estimate heterogeneous treatment
effects.

- **Library:** `econml` (v0.16.x) for DML, DR-Learner, Causal Forest, and
  honest confidence intervals; `causalml` (v0.16.x) for S/T/X/R-learners and
  uplift trees/Qini tooling. Both are used; `econml` is preferred when
  calibrated CIs are required.
- Output: per-segment CATE, ATE aggregate, bootstrap/asymptotic CIs, and a Qini
  curve for the uplift ranking.

### 2.4 Layer (d) — Geo-holdout with power/MDE calculator

For geo-structured campaigns: difference-in-differences / synthetic control at
the geo level, **plus a pre-flight power calculator**. Given `n_geos`,
historical geo variance, and `treat_frac`, compute the **Minimum Detectable
Effect (MDE)** at 80% power, α = 0.05. If the campaign's plausible lift is below
MDE, the verifier returns `inconclusive` with reason `underpowered` *before*
spending statistical credibility on a noisy point estimate.

- **Library:** `statsmodels` (v0.14.x) for power/MDE; `econml` for the geo-level
  synthetic-control estimator.

### 2.5 Layer (e) — Off-policy evaluation (IPS / SNIPS / DR)

When the action is a *policy* (which ad/bid to show) and logged propensities
exist: estimate the value of the new policy against the logging policy.

- **Library:** `obp` (Open Bandit Pipeline) — provides `InverseProbabilityWeighting`,
  `SelfNormalizedInverseProbabilityWeighting`, and `DoublyRobust` estimators
  with built-in confidence intervals.
- Output: estimated policy value, CI, and an effective-sample-size /
  weight-clipping diagnostic. Extreme weight concentration → `inconclusive`.

### 2.6 Method selection

The verifier picks the layer by available evidence: logged propensities → (e);
clean randomized split → (c)/(a); geo structure → (d); only aggregate
time series → (b). Guardrail proof (a) always runs. The chosen layer, the
rejected layers, and the reason are returned in the response.

### 2.7 FastAPI surface

`POST /simulate` — generate a ground-truth world.

```json
// request
{ "world_type": "confounded", "params": { "n_users": 200000,
  "baseline_cr": 0.03, "true_lift": 0.005, "confound_strength": 0.4 },
  "seed": 17 }
// response
{ "world_id": "w_8f3a", "ground_truth": { "ate": 0.0049, "att": 0.0051 },
  "n_rows": 200000, "data_uri": "s3://admatix-sim/w_8f3a.parquet" }
```

`POST /verify` — verify whether an action produced incremental lift.

```json
// request
{ "campaign_id": "c_2271", "data_uri": "s3://.../c_2271.parquet",
  "action_log_uri": "s3://.../c_2271_actions.jsonl",
  "guardrails": { "budget_cap": 50000, "freq_cap": 3 },
  "hint": { "design": "geo_holdout" } }
// response
{ "verdict": "lift_detected",            // lift_detected | no_effect | inconclusive
  "estimate": 0.0047,
  "confidence_interval": [0.0012, 0.0081],
  "ci_level": 0.95,
  "method": "geo_synthetic_control",
  "confounders_considered": ["recency","device","geo_baseline"],
  "guardrail_proof": { "all_pass": true,
    "rules": [ {"rule_id":"budget_cap","predicted":48210,"limit":50000,"pass":true} ] },
  "diagnostics": { "mde": 0.0030, "power": 0.83, "n_effective": 9120 },
  "tx_id": "c_2271" }
```

`GET /healthz` — `{ "status": "ok", "version": "<git-sha>", "libs": {...} }`.

Every response carries `tx_id`. `verdict` is `inconclusive` whenever the CI
spans zero, the design is underpowered, OPE weights are degenerate, or required
evidence is missing.

---

## 3. Research-Grade Validation Harness

The harness proves the verifier is correct. It runs in CI and gates releases.
All thresholds below are **pass criteria** — a release is blocked if any fails.

### 3.1 Simulation-Based Calibration (SBC)

For the Bayesian methods (layer b, and any Bayesian CATE estimator), run
**Simulation-Based Calibration** (Talts et al., 2018): draw parameters from the
prior, simulate data, fit, and rank the true value within posterior draws.
Under correct inference, ranks are **uniform**.

- **Package:** `simuk` (ArviZ-devs) for the SBC run; `arviz` for rank-histogram
  plots.
- **Pass:** rank histogram uniform — χ² goodness-of-fit p > 0.05 across ≥ 500
  simulations; no systematic ∪/∩ shape.

### 3.2 Confidence-interval coverage

Across ≥ 1,000 simulated worlds spanning the parameter grid, measure the
fraction of 95% CIs that contain the true ATE.

- **Pass:** empirical coverage ∈ **[0.93, 0.97]** (nominal 95%, ±2pp).
  Coverage < 0.93 = overconfident (release-blocking). Coverage > 0.98 = CIs too
  wide; flagged for review, not auto-blocking.

### 3.3 Point-estimate RMSE and bias

On clean A/B and confounded worlds, compare estimated ATE to ground truth.

- **Pass — bias:** `|mean(est − true)| ≤ 0.1 · |true_lift|` (≤ 10% relative
  bias) on confounded worlds; effectively zero on clean A/B worlds.
- **Pass — RMSE:** RMSE ≤ 0.25 · `true_lift` at default `n_users`; must shrink
  toward the asymptotic floor as `n_users` grows (consistency check).

### 3.4 Uplift quality — Qini / AUUC

For meta-learner CATE estimates, score the uplift ranking.

- **Metrics:** Qini coefficient and AUUC via `causalml` (`causalml.metrics`).
- **Pass:** Qini coefficient ≥ 0.5 · (oracle Qini) on heterogeneous-lift
  simulated worlds, where oracle Qini uses the known `τ_i` ranking.

### 3.5 Placebo / negative-control tests

Run the full verifier on zero-lift placebo worlds.

- **Pass:** mean estimate within **[−0.05·baseline_cr, +0.05·baseline_cr]**;
  false-positive rate (worlds wrongly labeled `lift_detected`) ≤ **0.05** at
  α = 0.05. Any systematic non-zero effect on placebos is release-blocking.

### 3.6 Multi-seed variance

Re-run identical configs across ≥ 20 seeds.

- **Pass:** coefficient of variation of the ATE estimate ≤ 0.15; verdict label
  stable (same verdict) in ≥ 90% of seed pairs for the same config.

### 3.7 Back-test against real RCT data

Recover known results on public randomized datasets.

- **Criteo Uplift v2.1** (~13.98M rows, near-random treatment, propensity
  AUC ≈ 0.509). Fetch via `scikit-uplift` (`sklift.datasets.fetch_criteo`).
  - **Pass:** verifier's ATE estimate within the published RCT 95% CI for the
    visit/conversion outcome; reproduced Qini within ±10% of a published
    `causalml`/`scikit-uplift` baseline.
- **Hillstrom MineThatData email** (64K customers, 3 arms). Fetch via
  `scikit-uplift` (`fetch_hillstrom`).
  - **Pass:** recover the well-known positive visit lift for the men's/women's
    email arms with a CI excluding zero; reproduce published AUUC within ±10%.

Back-tests run nightly and on every release branch.

---

## 4. Recommended Python Stack

Versions verified current as of May 2026. Pin **exact** versions in
`requirements.txt`; resolve and lock the full transitive tree to a hashed
`requirements.lock` via `pip-compile` (pip-tools) or `uv pip compile`. CI
installs only from the lock file. Group the env separately from execution-agent
code so the verifier's dependency surface stays auditable.

| Purpose | Package | Pinned version |
|---|---|---|
| Synthetic control / CausalImpact (BSTS) | `tfp-causalimpact` | latest 0.x (pin exact at lock time) |
| CausalImpact fallback (community port) | `tfcausalimpact` | 0.0.18 |
| CATE / DML / DR / Causal Forest + honest CIs | `econml` | 0.16.0 |
| Uplift meta-learners, Qini/AUUC metrics | `causalml` | 0.16.0 |
| Off-policy evaluation (IPS/SNIPS/DR) | `obp` | latest 0.x (pin exact at lock time) |
| Real RCT dataset loaders (Criteo, Hillstrom) | `scikit-uplift` | 0.5.1 |
| Bayesian inference backend | `pymc` | 5.x (pin exact) |
| Simulation-Based Calibration | `simuk` | latest (pin exact at lock time) |
| Posterior diagnostics + rank histograms | `arviz` | 0.x (pin exact) |
| Power / MDE, DiD | `statsmodels` | 0.14.x |
| Numerics / dataframes | `numpy` (2.x), `pandas` (2.x), `scipy` | pin exact |
| API service | `fastapi` + `uvicorn` + `pydantic` v2 | pin exact |
| Tests | `pytest`, `hypothesis` | pin exact |

Notes for build agents:
- `econml` 0.16.0 requires Python ≥ 3.9 and supports NumPy 2 / Python 3.13.
- `tfp-causalimpact` pulls TensorFlow + TensorFlow-Probability; isolate it in
  its own optional extra (`admatix[bsts]`) to keep the core install light.
- `simuk` integrates with PyMC/NumPyro; SBC runs in the validation extra
  (`admatix[validation]`), not in the runtime API image.
- Do not float minor versions. Every metric threshold in §3 is only meaningful
  against a frozen dependency tree.

---

## Sources

- [tfp-causalimpact · PyPI](https://pypi.org/project/tfp-causalimpact/)
- [tfcausalimpact · PyPI](https://pypi.org/project/tfcausalimpact/)
- [google/tfp-causalimpact · GitHub](https://github.com/google/tfp-causalimpact)
- [econml · PyPI](https://pypi.org/project/econml/)
- [py-why/EconML · GitHub](https://github.com/py-why/econml)
- [causalml · PyPI](https://pypi.org/project/causalml/)
- [uber/causalml · GitHub](https://github.com/uber/causalml)
- [obp · PyPI](https://pypi.org/project/obp/) / [Open Bandit Pipeline docs](https://zr-obp.readthedocs.io/en/latest/)
- [arviz-devs/simuk · GitHub](https://github.com/arviz-devs/simuk) / [Simuk docs](https://simuk.readthedocs.io/en/latest/)
- [scikit-uplift — fetch_criteo](https://www.uplift-modeling.com/en/latest/api/datasets/fetch_criteo.html)
- [Criteo Uplift Prediction Dataset — Criteo AI Lab](https://ailab.criteo.com/criteo-uplift-prediction-dataset/)
- [A Large Scale Benchmark for Individual Treatment Effect Prediction and Uplift (arXiv:2111.10106)](https://arxiv.org/pdf/2111.10106)
- [Talts et al., Validating Bayesian Inference Algorithms with Simulation-Based Calibration (arXiv:1804.06788)](https://arxiv.org/abs/1804.06788)
- [Posterior SBC: Simulation-Based Calibration Checking Conditional on Data (arXiv:2502.03279)](https://arxiv.org/pdf/2502.03279)
