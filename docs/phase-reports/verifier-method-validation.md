# Verifier method-validation — audit WS-2 (bespoke BSTS + OPE)

**Branch:** `fix/verifier-method-validation`
**Audit ticket:** WS-2 — "prove bespoke verifier estimators are statistically
correct, or fix them"
**Result:** PASS — both methods statistically correct after a one-line fix to
the BSTS SE. The fix and its proof live behind a permanent regression test.

## What this audit covered

`services/verifier`'s WP-R build deviated from its pinned stack:
`tfcausalimpact==0.0.18` and `obp==0.5.*` both pin `pandas<2.2`, which is
mutually incompatible with the verifier's own `pandas==2.2.*` / `econml
0.16.0` / `causalml 0.16.0` pins (see `services/verifier/requirements.txt`
notes). The build replaced them with:

| Layer | Bespoke backend | File |
|---|---|---|
| (b) BSTS pre/post synthetic control | `statsmodels.tsa.UnobservedComponents` (Kalman-filter local-level + weekly seasonal + control covariate) | `services/verifier/src/admatix_verifier/methods/bsts.py` |
| (e) OPE IPS / SNIPS / DR | numpy closed-form estimators with influence-function asymptotic CIs | `services/verifier/src/admatix_verifier/methods/ope.py` |

The audit task: **PROVE** each bespoke method is statistically correct — or
fix it. Two complementary proof channels:

1. **Analytic ground truth.** Construct controlled worlds where the true
   effect is known by construction. Over many seeds, measure each
   estimator's **bias**, **RMSE**, and **CI coverage** at a nominal level.
2. **Reference comparison.** Install the dropped reference libraries
   (`tfcausalimpact`, `obp`) in an ISOLATED venv (the pandas conflict is
   irrelevant when nothing else is in the env), run them on identical
   inputs, and report the delta.

Both are implemented under `services/verifier/validation/`. The proof
artifact is committed at
`services/verifier/validation/method_validation_results.json`.

## Acceptance thresholds (encoded as a regression guard)

`services/verifier/tests/test_method_validation.py` is the permanent
regression test. It asserts:

* `|bias| ≤ max(0.10·|truth|, 5e-3)` — relative-or-absolute, whichever is
  larger. The absolute floor matters when `|truth|` is tiny.
* `coverage_90 ∈ [0.85, 0.95]` — empirical coverage of a *nominal 90 %*
  interval, rescaled from the verifier-emitted 95 % CI via the Gaussian SE.
* `|reference_delta_estimate| ≤ 0.02` — bespoke point estimate within 2 pp
  absolute of the reference library on identical inputs.

These thresholds are the audit's published bar; the test enforces the
band on the committed harness artifact (sufficient seeds for the band to
be tight) and additionally runs a smaller live Monte-Carlo every pytest
invocation to catch under-coverage drift if a future code change forgets
to regenerate the artifact.

## Defect found and fixed: BSTS SE underestimated by ~30 %

The original `bsts.py` aggregated the per-step forecast SE as

```python
se_aggr = sqrt(mean(per_step_se**2) / N)
```

which is the SE of the mean *under the assumption that per-step forecast
errors are independent*. They are not. Local-level state-space forecasts
share a common state posterior — a level shock at horizon `h` biases every
subsequent step. Collapsing the forecast covariance to its diagonal
under-states the SE of the mean post-period gap by roughly 30 %.

**Empirical evidence** (BSTS Monte-Carlo, 100 seeds × 3 scenarios, BEFORE
the fix):

| Scenario | bias | coverage_95 | **coverage_90** |
|---|---|---|---|
| no_seasonal_small_effect | −1.5e-4 | 0.87 | **0.76** |
| no_seasonal_medium_effect | −1.5e-4 | 0.87 | **0.76** |
| seasonal_medium_effect | −6.6e-5 | 0.87 | **0.76** |

A 90 % CI with empirical coverage 0.76 is release-blocking under the audit
band `[0.85, 0.95]`. The bias was already correct — only the CIs were
miscalibrated.

**The fix** (one block in `bsts.py`): use the model's own
posterior-predictive sampler, which respects the full forecast-error
covariance for free:

```python
sim_paths = res.simulate(
    nsimulations=len(post_treated),
    anchor="end",
    exog=post_control.reshape(-1, 1),
    repetitions=_N_FORECAST_SIM,   # 1000
    random_state=np.random.default_rng(_FORECAST_SIM_SEED),
)
sim_means = sim_paths.reshape(sim_paths.shape[0], -1).mean(axis=0)
se_aggr = float(np.std(sim_means, ddof=1))
```

`res.simulate(anchor="end")` draws 1 000 counterfactual trajectories from
the fitted state-space model starting at the smoothed state at end of the
pre-period; the std of each trajectory's post-period mean is the
covariance-aware analog of the naive plug-in. The diagnostic
`naive_independent_se` is still reported so the operator can see by how
much the corrected SE differs from the legacy estimate on any given run.

## Results — analytic ground truth

### OPE (200 seeds per scenario, n=4 000)

True policy values: always-treat ⇒ V=0.30; split policy ⇒ V=0.20.
Threshold reminders: `|bias| ≤ max(0.10·|truth|, 5e-3)`,
`coverage_90 ∈ [0.85, 0.95]`.

| Scenario | Estimator | bias | RMSE | cov₉₅ | cov₉₀ | CI width (95 %) | claim |
|---|---|---|---|---|---|---|---|
| const_prop_always_treat | IPS | +8e-5 | 0.0104 | 0.970 | 0.920 | 0.044 | ✓ |
| const_prop_always_treat | SNIPS | +2.2e-4 | 0.0096 | 0.960 | 0.915 | 0.040 | ✓ |
| const_prop_always_treat | DR | +2.2e-4 | 0.0096 | 0.965 | 0.915 | 0.040 | ✓ |
| const_prop_split_policy | IPS | −1.6e-4 | 0.0089 | 0.965 | 0.925 | 0.037 | ✓ |
| const_prop_split_policy | SNIPS | −3.5e-4 | 0.0082 | 0.960 | 0.920 | 0.035 | ✓ |
| const_prop_split_policy | DR | −3.1e-4 | 0.0082 | 0.960 | 0.915 | 0.034 | ✓ |
| varying_prop_always_treat | IPS | +1.1e-3 | 0.0125 | 0.960 | 0.935 | 0.053 | ✓ |
| varying_prop_always_treat | SNIPS | +1.1e-3 | 0.0118 | 0.955 | 0.920 | 0.047 | ✓ |
| varying_prop_always_treat | DR | +1.1e-3 | 0.0118 | 0.955 | 0.920 | 0.047 | ✓ |

All scenarios: bias well inside the absolute floor (≤ 1.1e-3 ≪ 5e-3);
coverage_90 inside `[0.85, 0.95]` for every estimator.

### BSTS (100 seeds per scenario, n_periods=60, 30 pre + 30 post)

DGP: linear-Gaussian local-level + control covariate + known constant
step δ on the post-period treated series. Threshold reminders same as OPE.

| Scenario | true δ | bias | RMSE | cov₉₅ | cov₉₀ | CI width (95 %) | claim |
|---|---|---|---|---|---|---|---|
| no_seasonal_small_effect | 0.005 | −1.5e-4 | 0.00134 | 0.960 | 0.940 | 0.0061 | ✓ |
| no_seasonal_medium_effect | 0.020 | −1.5e-4 | 0.00134 | 0.960 | 0.940 | 0.0061 | ✓ |
| seasonal_medium_effect | 0.020 | −6.6e-5 | 0.00136 | 0.960 | 0.930 | 0.0062 | ✓ |

Bias is two orders of magnitude below the absolute floor; coverage_90 is
in the upper half of `[0.85, 0.95]`. The seasonal scenario — with a
deterministic weekly cycle added to BOTH series — is absorbed cleanly by
the BSTS's stochastic weekly component (no bias leakage).

## Results — reference comparison

Reference libraries built in two isolated venvs (Python 3.10 for `obp`,
Python 3.12 for `tfcausalimpact`):
`validation/scripts/run_reference_comparison.sh` is the reproducible
recipe.

### BSTS vs `tfcausalimpact==0.0.18`

Three fixtures (deterministic seeds 4001–4003). Threshold reminder:
`|delta| ≤ 0.02`.

| Fixture | true δ | bespoke estimate | tfp-causalimpact estimate | delta |
|---|---|---|---|---|
| bsts_no_seasonal_small | 0.005 | 0.00797 | 0.00522 | +0.00275 |
| bsts_no_seasonal_medium | 0.020 | 0.02033 | 0.02040 | −0.00007 |
| bsts_seasonal_medium | 0.020 | 0.02200 | 0.01965 | +0.00235 |

All three within `±0.003` of the reference. Note that `tfcausalimpact`
0.0.18 has its own SE — the bespoke and reference disagree per-seed by
the same order as the per-seed RMSE in the analytic harness. The
Monte-Carlo coverage proof above is the apples-to-apples calibration
check; the reference comparison confirms the point estimate agrees.

### OPE vs `obp==0.5.7`

Three fixtures (deterministic seeds 5001–5003). Each fixture is scored
with three estimators (IPS / SNIPS / DR). Threshold reminder:
`|delta| ≤ 0.02`.

| Fixture | Estimator | bespoke | obp | delta |
|---|---|---|---|---|
| ope_const_prop_always_treat | IPS | 0.28800 | 0.28800 | 0 |
| ope_const_prop_always_treat | SNIPS | 0.28728 | 0.28728 | 0 |
| ope_const_prop_always_treat | DR | 0.28728 | 0.28728 | 0 |
| ope_const_prop_split_policy | IPS | 0.20200 | 0.20200 | 0 |
| ope_const_prop_split_policy | SNIPS | 0.20060 | 0.20060 | 2.8e-17 |
| ope_const_prop_split_policy | DR | 0.20062 | 0.20062 | 0 |
| ope_varying_prop_always_treat | IPS | 0.31750 | 0.31750 | 0 |
| ope_varying_prop_always_treat | SNIPS | 0.31252 | 0.31252 | 0 |
| ope_varying_prop_always_treat | DR | 0.31256 | 0.31256 | 0 |

Point estimates agree to machine precision (both use the same
closed-form estimators; we replicated obp's pscore-on-logged-action and
empirical-mean reward-model conventions in the bespoke runner). CIs
differ slightly because the bespoke uses influence-function asymptotic CIs
and obp uses bootstrap CIs (n_bootstrap=1000); the per-fixture CI
endpoints are within ~1 pp of each other (see the `_reference_ope.json`
and `_bespoke_results.json` artifacts for the side-by-side).

## How to reproduce

From `services/verifier/` with the runtime venv built:

```bash
# 1. Analytic Monte-Carlo + bespoke-on-fixtures + JSON artifact
PYTHONPATH=src python -m validation.run_validation

# 2. Reference comparison (isolated venvs, ~5 min)
bash validation/scripts/run_reference_comparison.sh

# 3. Re-run the regression test to confirm
pytest tests/test_method_validation.py -v
```

The harness writes:

- `validation/method_validation_results.json` (machine-readable, all
  scenarios, all metrics, all reference deltas — the proof artifact).
- `validation/_fixtures/*.csv` (deterministic input fixtures).
- `validation/_fixtures/_bespoke_results.json` (bespoke output on each
  fixture).
- `validation/_fixtures/_reference_{bsts,ope}.json` (reference-library
  output on each fixture).

## Files touched

| File | Change |
|---|---|
| `services/verifier/src/admatix_verifier/methods/bsts.py` | Replace naive-diagonal SE with simulate-based SE; preserve naive SE as diagnostic. |
| `services/verifier/tests/test_bsts.py` | Use n_users=50 000 placebo for the bracket-zero check (consistent with the existing test_placebo_zero / test_cate deviations recorded in R-report.md — the §3.5 placebo criterion is population-level). |
| `services/verifier/tests/conftest.py` | Put `services/verifier/` on sys.path so `validation/*` is importable from tests. |
| `services/verifier/tests/test_method_validation.py` | New permanent regression guard — static + live coverage checks. |
| `services/verifier/validation/` | New audit harness package — see above. |
| `services/verifier/validation/method_validation_results.json` | Committed proof artifact. |

## Pytest

```
$ pytest tests -q
39 passed in 62.65s
```

(26 prior acceptance tests still green + 13 new method-validation tests.)
