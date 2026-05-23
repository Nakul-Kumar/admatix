"""Layer (b) — Pre/post synthetic control via Bayesian structural time series.

Implementation note: `tfcausalimpact==0.0.18` (the spec's pinned fallback)
locks pandas<2.2 — incompatible with the rest of the verifier's pin set
(econml/causalml require modern pandas). We use `statsmodels`'
`UnobservedComponents` BSTS — a Kalman-filter state-space model with a
local-level trend and a weekly cycle.

SE of the mean post-period gap. The naive plug-in
`SE² = mean(per-step se²) / N` treats per-step forecast errors as
independent, but local-level state-space forecasts are positively
correlated across the post-period horizon (a level shock at step h biases
every subsequent step). That collapse to a diagonal covariance
under-states the SE of the average gap by ~30 % and produces under-covering
intervals (validated empirically — see
`docs/phase-reports/verifier-method-validation.md`). We therefore draw
`_N_FORECAST_SIM` posterior-predictive trajectories with
`results.simulate(anchor='end', repetitions=…)`, take each trajectory's
post-period mean, and use the standard deviation of those means as the SE
of the counterfactual average. This captures the full forecast-error
covariance for free.

Operators who want the TensorFlow-Probability BSTS may install the
`bsts-tfp` extra (which pulls `tfp-causalimpact`); the contract is
unchanged.

Pre-period definition: the first half of the observed timeline is used as
the training window. The post-period is the second half.
"""

from __future__ import annotations

import warnings
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

from ..models import MethodResult, VerifyRequest

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    import statsmodels.api as sm  # noqa: E402


_N_FORECAST_SIM = 1000
_FORECAST_SIM_SEED = 17


def _daily_series(events: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """Aggregate the long-form events to a per-period treated/control series.

    Returns `(treated_rate, control_rate)` indexed by `period`. Both rates are
    conversion rates (mean of `outcome`) — the BSTS is fit on the treated
    series with the control rate as a contemporaneous covariate.
    """

    grouped = events.groupby(["period", "treatment"])["outcome"].agg(["sum", "count"]).reset_index()
    treated = grouped[grouped["treatment"] == 1].set_index("period")
    control = grouped[grouped["treatment"] == 0].set_index("period")
    periods = sorted(set(treated.index) | set(control.index))
    treated_rate = pd.Series(
        [(treated.loc[p, "sum"] / treated.loc[p, "count"]) if p in treated.index else np.nan for p in periods],
        index=periods,
        name="treated_rate",
    )
    control_rate = pd.Series(
        [(control.loc[p, "sum"] / control.loc[p, "count"]) if p in control.index else np.nan for p in periods],
        index=periods,
        name="control_rate",
    )
    return treated_rate.ffill().bfill(), control_rate.ffill().bfill()


def run(req: VerifyRequest, events: pd.DataFrame) -> MethodResult:
    treated, control = _daily_series(events)
    n = len(treated)
    if n < 8:
        return MethodResult(
            method="bsts_synthetic_control",
            estimate=None,
            ci_low=None,
            ci_high=None,
            verdict="inconclusive",
            causal_status="inconclusive",
            confounders=["seasonality", "control_rate"],
            diagnostics={"reason": "insufficient_periods", "n_periods": n},
        )

    pre_end = max(2, n // 2)
    pre_treated = treated.iloc[:pre_end].to_numpy(dtype=float)
    pre_control = control.iloc[:pre_end].to_numpy(dtype=float)
    post_treated = treated.iloc[pre_end:].to_numpy(dtype=float)
    post_control = control.iloc[pre_end:].to_numpy(dtype=float)

    # BSTS / UnobservedComponents: local-level trend + weekly seasonal +
    # contemporaneous control covariate, fit on the pre-period only.
    exog_pre = pre_control.reshape(-1, 1)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        seasonal = 7 if pre_end >= 14 else None
        try:
            model = sm.tsa.UnobservedComponents(
                pre_treated,
                level="local level",
                exog=exog_pre,
                seasonal=seasonal,
                stochastic_seasonal=False if seasonal is None else True,
            )
            res = model.fit(disp=False, method="lbfgs")
        except Exception:
            # Fallback: drop seasonal entirely if optimisation refuses.
            model = sm.tsa.UnobservedComponents(pre_treated, level="local level", exog=exog_pre)
            res = model.fit(disp=False, method="lbfgs")

        forecast = res.get_forecast(steps=len(post_treated), exog=post_control.reshape(-1, 1))
        sim_paths = np.asarray(
            res.simulate(
                nsimulations=len(post_treated),
                anchor="end",
                exog=post_control.reshape(-1, 1),
                repetitions=_N_FORECAST_SIM,
                random_state=np.random.default_rng(_FORECAST_SIM_SEED),
            )
        )
    mean = np.asarray(forecast.predicted_mean, dtype=float)
    per_step_se = np.asarray(forecast.se_mean, dtype=float)
    gap = post_treated - mean
    estimate = float(np.mean(gap))

    # `sim_paths` shape from statsmodels' `simulate` with `repetitions=N` is
    # `(nsteps, k_endog=1, N)`. Take each repetition's post-period mean and
    # use the std across repetitions as the SE of the counterfactual mean
    # — this is the joint-covariance-aware analog of the naive plug-in.
    sim_paths_flat = sim_paths.reshape(sim_paths.shape[0], -1)
    sim_means = sim_paths_flat.mean(axis=0)
    se_aggr = float(np.std(sim_means, ddof=1))
    naive_se = float(np.sqrt(np.mean(per_step_se**2) / max(len(gap), 1)))
    z = stats.norm.ppf(0.975)
    ci_low = estimate - z * se_aggr
    ci_high = estimate + z * se_aggr

    verdict = "lift_detected" if ci_low > 0 else "no_effect" if ci_high < 0 else "inconclusive"
    causal_status = "experimental" if verdict == "lift_detected" else "inconclusive"

    diagnostics: dict[str, Any] = {
        "n_periods": int(n),
        "pre_periods": int(pre_end),
        "post_periods": int(len(post_treated)),
        "posterior_se": se_aggr,
        "naive_independent_se": naive_se,
        "se_method": "monte_carlo_simulate_anchor_end",
        "n_forecast_sim": int(_N_FORECAST_SIM),
        "model": "statsmodels.UnobservedComponents(local_level+control_exog)",
    }
    return MethodResult(
        method="bsts_synthetic_control",
        estimate=estimate,
        ci_low=float(ci_low),
        ci_high=float(ci_high),
        verdict=verdict,
        causal_status=causal_status,
        confounders=["seasonality", "control_rate"],
        diagnostics=diagnostics,
    )


__all__ = ["run"]
