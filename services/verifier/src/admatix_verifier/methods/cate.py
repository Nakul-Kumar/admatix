"""Layer (c) — User-level CATE via meta-learners.

Primary backend is `econml.dml.LinearDML` (DML with linear final stage and
asymptotic CIs). On failure we fall back to `causalml`'s T-Learner with a
bootstrap CI. The Qini coefficient is computed via `causalml.metrics`.
"""

from __future__ import annotations

import warnings
from typing import Any

import numpy as np
import pandas as pd

from ..models import MethodResult, VerifyRequest


_NUMERIC_COVARS = ["recency", "frequency", "prior_conversions"]
_CATEGORICAL_COVARS = ["device", "age_band"]


def _build_design(events: pd.DataFrame) -> tuple[np.ndarray, list[str]]:
    covars = [c for c in _NUMERIC_COVARS if c in events.columns]
    cat_covars = [c for c in _CATEGORICAL_COVARS if c in events.columns]
    pieces: list[np.ndarray] = []
    names: list[str] = []
    if covars:
        pieces.append(events[covars].to_numpy(dtype=float))
        names.extend(covars)
    for col in cat_covars:
        dummies = pd.get_dummies(events[col].astype(str), prefix=col, drop_first=True, dtype=float)
        if dummies.shape[1] > 0:
            pieces.append(dummies.to_numpy(dtype=float))
            names.extend(dummies.columns.tolist())
    if not pieces:
        raise ValueError("cate.run needs at least one covariate column")
    return np.concatenate(pieces, axis=1), names


def _qini(events: pd.DataFrame, scores: np.ndarray) -> float | None:
    try:
        from causalml.metrics import qini_score  # type: ignore
        df = pd.DataFrame(
            {
                "y": events["outcome"].to_numpy(dtype=float),
                "w": events["treatment"].to_numpy(dtype=int),
                "score": scores,
            }
        )
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            result = qini_score(df, outcome_col="y", treatment_col="w", normalize=True)
        if isinstance(result, pd.DataFrame):
            # causalml returns a per-model frame; take the only non-random column.
            non_random = [c for c in result.columns if c.lower() != "random"]
            if non_random:
                value = float(result[non_random[0]].iloc[0])
                return value
            return None
        if isinstance(result, pd.Series):
            return float(result.iloc[0])
        return float(result)
    except Exception:
        # Fall back to a hand-rolled Qini: cumulative uplift sorted by score.
        order = np.argsort(-scores)
        y = events["outcome"].to_numpy(dtype=float)[order]
        w = events["treatment"].to_numpy(dtype=int)[order]
        n = len(y)
        n_t_cum = np.cumsum(w)
        n_c_cum = np.cumsum(1 - w)
        n_t_cum_safe = np.where(n_t_cum == 0, 1, n_t_cum)
        n_c_cum_safe = np.where(n_c_cum == 0, 1, n_c_cum)
        y_t_cum = np.cumsum(y * w)
        y_c_cum = np.cumsum(y * (1 - w))
        uplift_curve = (y_t_cum / n_t_cum_safe - y_c_cum / n_c_cum_safe) * (n_t_cum + n_c_cum)
        # Normalise by max possible uplift.
        baseline = np.linspace(0, uplift_curve[-1] if n else 0.0, n)
        area_model = np.trapezoid(uplift_curve)
        area_baseline = np.trapezoid(baseline)
        denom = abs(area_baseline) + 1e-9
        return float((area_model - area_baseline) / denom)


def _dml_estimate(
    events: pd.DataFrame, design: np.ndarray, names: list[str]
) -> tuple[float, float, float, dict[str, Any], list[str], str]:
    from econml.dml import LinearDML  # type: ignore
    from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor

    y = events["outcome"].to_numpy(dtype=float)
    t = events["treatment"].to_numpy(dtype=int)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        est = LinearDML(
            model_y=GradientBoostingRegressor(n_estimators=80, max_depth=3, random_state=17),
            model_t=GradientBoostingClassifier(n_estimators=80, max_depth=3, random_state=17),
            discrete_treatment=True,
            cv=3,
            random_state=17,
        )
        est.fit(Y=y, T=t, X=design)
        ate = float(est.ate(X=design))
        lower, upper = est.ate_interval(X=design, alpha=0.05)
        try:
            scores = est.effect(X=design)
        except Exception:
            scores = np.full(len(events), ate)
    diagnostics: dict[str, Any] = {
        "backend": "econml.LinearDML",
        "model_y": "GradientBoostingRegressor",
        "model_t": "GradientBoostingClassifier",
        "ci": "asymptotic_dml",
    }
    return ate, float(lower), float(upper), diagnostics, list(np.asarray(scores, dtype=float)), "econml.LinearDML"


def _t_learner_estimate(
    events: pd.DataFrame, design: np.ndarray
) -> tuple[float, float, float, dict[str, Any], list[str], str]:
    from causalml.inference.meta import BaseTRegressor  # type: ignore
    from sklearn.ensemble import GradientBoostingRegressor

    y = events["outcome"].to_numpy(dtype=float)
    t = events["treatment"].to_numpy(dtype=int)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        learner = BaseTRegressor(learner=GradientBoostingRegressor(n_estimators=80, max_depth=3, random_state=17))
        ate, lower, upper = learner.estimate_ate(
            X=design,
            treatment=t,
            y=y,
            return_ci=True,
            bootstrap_ci=True,
            n_bootstraps=200,
            bootstrap_size=min(len(y), 5000),
        )
        scores = learner.predict(X=design, treatment=t, y=y).reshape(-1)
    diagnostics: dict[str, Any] = {
        "backend": "causalml.BaseTRegressor",
        "ci": "bootstrap_200",
    }
    return (
        float(np.asarray(ate).reshape(-1)[0]),
        float(np.asarray(lower).reshape(-1)[0]),
        float(np.asarray(upper).reshape(-1)[0]),
        diagnostics,
        list(np.asarray(scores, dtype=float)),
        "causalml.BaseTRegressor",
    )


def run(req: VerifyRequest, events: pd.DataFrame) -> MethodResult:
    required = {"user_id", "treatment", "outcome"}
    missing = required - set(events.columns)
    if missing:
        return MethodResult(
            method="cate_meta_learner",
            estimate=None,
            ci_low=None,
            ci_high=None,
            verdict="inconclusive",
            causal_status="inconclusive",
            confounders=[],
            diagnostics={"reason": "missing_columns", "missing": sorted(missing)},
        )

    design, names = _build_design(events)
    backend_used: str
    try:
        ate, ci_low, ci_high, diag, scores, backend_used = _dml_estimate(events, design, names)
    except Exception as exc:  # pragma: no cover - fallback path
        try:
            ate, ci_low, ci_high, diag, scores, backend_used = _t_learner_estimate(events, design)
            diag["dml_error"] = str(exc)
        except Exception as exc2:
            return MethodResult(
                method="cate_meta_learner",
                estimate=None,
                ci_low=None,
                ci_high=None,
                verdict="inconclusive",
                causal_status="inconclusive",
                confounders=names,
                diagnostics={"reason": "estimator_failed", "errors": [str(exc), str(exc2)]},
            )

    qini_value = _qini(events, np.asarray(scores, dtype=float))
    verdict = "lift_detected" if ci_low > 0 else "no_effect" if ci_high < 0 else "inconclusive"
    causal_status = "experimental" if verdict == "lift_detected" else "inconclusive"
    diagnostics: dict[str, Any] = {
        **diag,
        "qini": qini_value,
        "n_users": int(len(events)),
        "covariates": names,
        "backend_used": backend_used,
    }
    return MethodResult(
        method="cate_meta_learner",
        estimate=float(ate),
        ci_low=float(ci_low),
        ci_high=float(ci_high),
        verdict=verdict,
        causal_status=causal_status,
        confounders=names,
        diagnostics=diagnostics,
    )


__all__ = ["run"]
