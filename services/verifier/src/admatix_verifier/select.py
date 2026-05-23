"""Method selection for the verifier.

Selection ladder per SIMULATION-VERIFICATION §2.6:
  1) `logging_propensity` column present                    → ope_ips_snips_dr
  2) `hint.design == "geo_holdout"`, or ≥10 distinct geo_ids
     AND treatment varies by geo only                       → geo_synthetic_control
  3) user-level (user_id, treatment, outcome, covars)       → cate_meta_learner
  4) only an aggregate time series (period, outcome)        → bsts_synthetic_control
  5) none of the above                                      → guardrail_only
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import pandas as pd

from .models import MethodName, RejectedMethod, VerifyRequest


_ALL_METHODS: tuple[MethodName, ...] = (
    "ope_ips_snips_dr",
    "geo_synthetic_control",
    "cate_meta_learner",
    "bsts_synthetic_control",
    "guardrail_only",
)


@dataclass
class Selection:
    method: MethodName
    rejected: list[RejectedMethod]


def _treatment_varies_by_geo_only(events: pd.DataFrame) -> bool:
    if "geo_id" not in events.columns or "treatment" not in events.columns:
        return False
    per_geo = events.groupby("geo_id")["treatment"].nunique()
    return bool((per_geo <= 1).all())


def _user_level_ok(events: pd.DataFrame) -> bool:
    required = {"user_id", "treatment", "outcome"}
    if not required.issubset(events.columns):
        return False
    covars = {"recency", "frequency", "prior_conversions", "device", "age_band"}
    return bool(covars.intersection(events.columns))


def _aggregate_ts_ok(events: pd.DataFrame) -> bool:
    return {"period", "outcome"}.issubset(events.columns)


def _reason_against(method: MethodName, events: pd.DataFrame, hint_design: str | None) -> str:
    if method == "ope_ips_snips_dr":
        return "no_propensities"
    if method == "geo_synthetic_control":
        if "geo_id" not in events.columns:
            return "no_geo_column"
        n_geos = events["geo_id"].nunique() if "geo_id" in events.columns else 0
        if hint_design == "geo_holdout":
            return "geo_holdout_hint_unmet"
        if n_geos < 10:
            return f"insufficient_geos:{n_geos}<10"
        if not _treatment_varies_by_geo_only(events):
            return "treatment_varies_within_geo"
        return "geo_design_rejected"
    if method == "cate_meta_learner":
        missing = {"user_id", "treatment", "outcome"} - set(events.columns)
        if missing:
            return f"missing_columns:{sorted(missing)}"
        return "no_user_covariates"
    if method == "bsts_synthetic_control":
        missing = {"period", "outcome"} - set(events.columns)
        if missing:
            return f"missing_columns:{sorted(missing)}"
        return "preferred_method_selected"
    return "fallback_method"


def select_method(req: VerifyRequest, events: pd.DataFrame) -> str:
    """Return the method to run. Side-effect free — use `selection_with_reasons` for context."""

    return selection_with_reasons(req, events).method


def selection_with_reasons(req: VerifyRequest, events: pd.DataFrame) -> Selection:
    hint_design = None
    if req.hint and isinstance(req.hint.get("design"), str):
        hint_design = req.hint["design"]

    chosen: MethodName

    if "logging_propensity" in events.columns:
        chosen = "ope_ips_snips_dr"
    elif (
        hint_design == "geo_holdout"
        or (
            "geo_id" in events.columns
            and events["geo_id"].nunique() >= 10
            and _treatment_varies_by_geo_only(events)
        )
    ):
        chosen = "geo_synthetic_control"
    elif _user_level_ok(events):
        chosen = "cate_meta_learner"
    elif _aggregate_ts_ok(events):
        chosen = "bsts_synthetic_control"
    else:
        chosen = "guardrail_only"

    rejected: list[RejectedMethod] = []
    for method in _ALL_METHODS:
        if method == chosen:
            continue
        if method == "guardrail_only":
            # Guardrail always runs as part of the response, never "rejected".
            continue
        rejected.append(RejectedMethod(method=method, reason=_reason_against(method, events, hint_design)))

    return Selection(method=chosen, rejected=rejected)


__all__ = ["select_method", "selection_with_reasons", "Selection"]
