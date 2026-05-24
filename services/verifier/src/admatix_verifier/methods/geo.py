"""Layer (d) - geo-holdout pre/post verification.

This method estimates the interaction between a treated geo label and the
post-intervention period. A geo label alone is not a causal treatment when geo
fixed effects are present; the simulator therefore emits explicit
``treated_geo`` and ``post_period`` columns and this verifier treats
``treated_geo * post_period`` as the estimand.
"""

from __future__ import annotations

import warnings
from typing import Any

import numpy as np
import pandas as pd
import statsmodels.api as sm
from statsmodels.stats.power import TTestIndPower

from ..models import MethodResult, VerifyRequest


_REQUIRED_COLUMNS = {"geo_id", "period", "outcome", "treatment", "treated_geo", "post_period"}
_FINITE_SAMPLE_CI_INFLATION = 1.15


def _per_geo_period(events: pd.DataFrame) -> pd.DataFrame:
    """Aggregate events to a geo-period panel."""

    grouped = (
        events.groupby(["geo_id", "period"])
        .agg(
            outcome=("outcome", "mean"),
            n=("outcome", "size"),
            treatment=("treatment", "max"),
            treated_geo=("treated_geo", "max"),
            post_period=("post_period", "max"),
        )
        .reset_index()
    )
    for col in ("treatment", "treated_geo", "post_period"):
        grouped[col] = grouped[col].astype(int)
    grouped["did"] = grouped["treated_geo"] * grouped["post_period"]
    return grouped


def _power_mde(panel: pd.DataFrame, treated_geos: set[str], plausible_lift: float | None) -> tuple[float, float]:
    """Return (mde, power) for an 80%-power 5%-alpha two-sample preflight."""

    if panel.empty:
        return float("nan"), float("nan")
    pre = panel[panel["post_period"] == 0]
    source = pre if not pre.empty else panel
    geo_summary = (
        source.groupby("geo_id")
        .agg(rate=("outcome", "mean"), treated_geo=("treated_geo", "max"))
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


def _inconclusive(reason: str, diagnostics: dict[str, Any] | None = None) -> MethodResult:
    return MethodResult(
        method="geo_synthetic_control",
        estimate=None,
        ci_low=None,
        ci_high=None,
        verdict="inconclusive",
        causal_status="inconclusive",
        confounders=["geo_baseline", "seasonality"],
        diagnostics={"reason": reason, **(diagnostics or {})},
    )


def run(req: VerifyRequest, events: pd.DataFrame) -> MethodResult:
    missing = _REQUIRED_COLUMNS - set(events.columns)
    if missing:
        reason = "missing_geo_prepost_design" if {"treated_geo", "post_period"} & missing else "missing_columns"
        return _inconclusive(reason, {"missing": sorted(missing)})

    panel = _per_geo_period(events)
    geos = sorted(panel["geo_id"].unique().tolist())
    treated_geos = set(panel[panel["treated_geo"] == 1]["geo_id"].unique().tolist())
    n_geos = len(geos)
    has_pre = bool((panel["post_period"] == 0).any())
    has_post = bool((panel["post_period"] == 1).any())
    if n_geos < 2 or not treated_geos or len(treated_geos) == n_geos or not (has_pre and has_post):
        return _inconclusive(
            "no_geo_prepost_split",
            {
                "n_geos": n_geos,
                "n_treated_geos": len(treated_geos),
                "has_pre": has_pre,
                "has_post": has_post,
            },
        )

    plausible_lift_hint: float | None = None
    if req.hint and isinstance(req.hint.get("plausible_lift"), (int, float)):
        plausible_lift_hint = float(req.hint["plausible_lift"])

    mde, power = _power_mde(panel, treated_geos, plausible_lift_hint)
    diagnostics: dict[str, Any] = {
        "n_geos": n_geos,
        "n_treated_geos": len(treated_geos),
        "n_pre_periods": int(panel.loc[panel["post_period"] == 0, "period"].nunique()),
        "n_post_periods": int(panel.loc[panel["post_period"] == 1, "period"].nunique()),
        "mde": float(mde) if np.isfinite(mde) else None,
        "power": float(power) if np.isfinite(power) else None,
        "estimand": "treated_geo_x_post_period",
        "backend": "statsmodels.WLS(geo_period_fe,cluster_by_geo)+TTestIndPower",
    }

    underpowered = bool(plausible_lift_hint is not None and np.isfinite(mde) and abs(plausible_lift_hint) < mde)
    if underpowered:
        diagnostics["reason"] = "underpowered"

    panel = panel.copy()
    panel = panel.assign(geo=panel["geo_id"].astype("category"), period_f=panel["period"].astype("category"))
    geo_dummies = pd.get_dummies(panel["geo"], prefix="geo", drop_first=True, dtype=float)
    period_dummies = pd.get_dummies(panel["period_f"], prefix="period", drop_first=True, dtype=float)
    design = pd.concat(
        [
            pd.Series(np.ones(len(panel)), name="const", index=panel.index),
            pd.Series(panel["did"].astype(float), name="did", index=panel.index),
            geo_dummies,
            period_dummies,
        ],
        axis=1,
    )
    y = panel["outcome"].to_numpy(dtype=float)
    weights = panel["n"].to_numpy(dtype=float)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = sm.WLS(y, design.to_numpy(dtype=float), weights=weights)
        try:
            result = model.fit(cov_type="cluster", cov_kwds={"groups": panel["geo_id"].to_numpy()})
        except Exception:
            result = model.fit(cov_type="HC1")
            diagnostics["cluster_fallback"] = "HC1"

    try:
        did_idx = list(design.columns).index("did")
        estimate = float(result.params[did_idx])
        ci = result.conf_int(alpha=0.05)
        raw_low = float(ci[did_idx, 0])
        raw_high = float(ci[did_idx, 1])
        half_width = max(abs(estimate - raw_low), abs(raw_high - estimate)) * _FINITE_SAMPLE_CI_INFLATION
        ci_low = estimate - half_width
        ci_high = estimate + half_width
        diagnostics["ci"] = "cluster_by_geo_finite_sample_inflated"
        diagnostics["ci_inflation"] = _FINITE_SAMPLE_CI_INFLATION
    except Exception as exc:  # pragma: no cover - structural failure
        return _inconclusive("ols_failed", {**diagnostics, "error": str(exc)})

    verdict = "inconclusive" if underpowered else "lift_detected" if ci_low > 0 else "no_effect" if ci_high < 0 else "inconclusive"
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
