"""Layer (d) — Geo-holdout synthetic control + power/MDE pre-flight.

Difference-in-differences at the geo level with a heteroskedasticity-robust
covariance for the CI. Power/MDE is computed against the pre-period
between-geo variance using a two-sample t-test approximation
(`statsmodels.stats.power.TTestIndPower`). If `plausible_lift < MDE@80%`, the
verifier returns `inconclusive` with `reason="underpowered"` rather than a
noisy point estimate.
"""

from __future__ import annotations

import warnings
from typing import Any

import numpy as np
import pandas as pd
import statsmodels.api as sm
from statsmodels.stats.power import TTestIndPower

from ..models import MethodResult, VerifyRequest


def _per_geo_period(events: pd.DataFrame) -> pd.DataFrame:
    """Aggregate to (geo_id, period) → conversion rate + treatment status."""

    grouped = (
        events.groupby(["geo_id", "period"])
        .agg(
            outcome=("outcome", "mean"),
            n=("outcome", "size"),
            treatment=("treatment", "max"),
        )
        .reset_index()
    )
    grouped["treatment"] = grouped["treatment"].astype(int)
    return grouped


def _power_mde(
    panel: pd.DataFrame, treated_geos: set[str], plausible_lift: float | None
) -> tuple[float, float]:
    """Return (mde, power) for an 80%-power 5%-α two-sample test."""

    if len(panel) == 0:
        return float("nan"), float("nan")
    geo_summary = (
        panel.groupby("geo_id")
        .agg(rate=("outcome", "mean"), treatment=("treatment", "max"))
        .reset_index()
    )
    sd = float(geo_summary["rate"].std(ddof=1)) if len(geo_summary) > 1 else 1.0
    if not np.isfinite(sd) or sd == 0:
        sd = 1e-6
    n_treated = max(int(sum(1 for g in geo_summary["geo_id"] if g in treated_geos)), 1)
    n_control = max(int(len(geo_summary) - n_treated), 1)
    analysis = TTestIndPower()
    try:
        effect_size = analysis.solve_power(
            effect_size=None,
            nobs1=n_treated,
            ratio=n_control / n_treated,
            alpha=0.05,
            power=0.8,
            alternative="two-sided",
        )
    except Exception:
        effect_size = float("inf")
    mde = float(effect_size) * sd
    if plausible_lift is None or sd == 0:
        power = float("nan")
    else:
        try:
            power = float(
                analysis.solve_power(
                    effect_size=abs(plausible_lift) / sd,
                    nobs1=n_treated,
                    ratio=n_control / n_treated,
                    alpha=0.05,
                    power=None,
                    alternative="two-sided",
                )
            )
        except Exception:
            power = float("nan")
    return mde, power


def run(req: VerifyRequest, events: pd.DataFrame) -> MethodResult:
    if "geo_id" not in events.columns:
        return MethodResult(
            method="geo_synthetic_control",
            estimate=None,
            ci_low=None,
            ci_high=None,
            verdict="inconclusive",
            causal_status="inconclusive",
            confounders=[],
            diagnostics={"reason": "missing_geo_id"},
        )

    panel = _per_geo_period(events)
    geos = sorted(panel["geo_id"].unique().tolist())
    treated_geos = set(panel[panel["treatment"] == 1]["geo_id"].unique().tolist())
    n_geos = len(geos)
    if n_geos < 2 or not treated_geos or len(treated_geos) == n_geos:
        return MethodResult(
            method="geo_synthetic_control",
            estimate=None,
            ci_low=None,
            ci_high=None,
            verdict="inconclusive",
            causal_status="inconclusive",
            confounders=["geo_baseline", "seasonality"],
            diagnostics={"reason": "no_geo_split", "n_geos": n_geos},
        )

    # Difference-in-differences with geo and period fixed effects, robust SE.
    panel = panel.copy()
    panel["post"] = panel["treatment"].astype(int)
    panel = panel.assign(geo=panel["geo_id"].astype("category"), period_f=panel["period"].astype("category"))
    geo_dummies = pd.get_dummies(panel["geo"], prefix="geo", drop_first=True, dtype=float)
    period_dummies = pd.get_dummies(panel["period_f"], prefix="period", drop_first=True, dtype=float)
    design = pd.concat([pd.Series(np.ones(len(panel)), name="const"), pd.Series(panel["post"], name="post"), geo_dummies, period_dummies], axis=1)
    y = panel["outcome"].to_numpy(dtype=float)

    plausible_lift_hint: float | None = None
    if req.hint and isinstance(req.hint.get("plausible_lift"), (int, float)):
        plausible_lift_hint = float(req.hint["plausible_lift"])

    mde, power = _power_mde(panel, treated_geos, plausible_lift_hint)
    diagnostics: dict[str, Any] = {
        "n_geos": n_geos,
        "n_treated_geos": len(treated_geos),
        "mde": float(mde) if np.isfinite(mde) else None,
        "power": float(power) if np.isfinite(power) else None,
        "backend": "statsmodels.OLS(geo_period_fe,HC1)+TTestIndPower",
    }

    if plausible_lift_hint is not None and np.isfinite(mde) and abs(plausible_lift_hint) < mde:
        diagnostics["reason"] = "underpowered"
        return MethodResult(
            method="geo_synthetic_control",
            estimate=None,
            ci_low=None,
            ci_high=None,
            verdict="inconclusive",
            causal_status="inconclusive",
            confounders=["geo_baseline", "seasonality"],
            diagnostics=diagnostics,
        )

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = sm.OLS(y, design.to_numpy(dtype=float))
        result = model.fit(cov_type="HC1")

    try:
        post_idx = list(design.columns).index("post")
        estimate = float(result.params[post_idx])
        ci = result.conf_int(alpha=0.05)
        ci_low = float(ci[post_idx, 0])
        ci_high = float(ci[post_idx, 1])
    except Exception as exc:  # pragma: no cover - structural failure
        return MethodResult(
            method="geo_synthetic_control",
            estimate=None,
            ci_low=None,
            ci_high=None,
            verdict="inconclusive",
            causal_status="inconclusive",
            confounders=["geo_baseline", "seasonality"],
            diagnostics={**diagnostics, "reason": "ols_failed", "error": str(exc)},
        )

    verdict = "lift_detected" if ci_low > 0 else "no_effect" if ci_high < 0 else "inconclusive"
    causal_status = "experimental" if verdict == "lift_detected" else "inconclusive"
    return MethodResult(
        method="geo_synthetic_control",
        estimate=estimate,
        ci_low=ci_low,
        ci_high=ci_high,
        verdict=verdict,
        causal_status=causal_status,
        confounders=["geo_baseline", "seasonality"],
        diagnostics=diagnostics,
    )


__all__ = ["run"]
