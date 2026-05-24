"""Acceptance test 7 — method selection."""

from __future__ import annotations

import numpy as np
import pandas as pd

from admatix_verifier.models import H0PacketSubset, VerifyRequest
from admatix_verifier.select import select_method, selection_with_reasons


def _req(hint: dict | None = None) -> VerifyRequest:
    return VerifyRequest(
        packet=H0PacketSubset(
            packet_id="pkt",
            tenant_id="tenant",
            account_ref="ref",
            goal="goal",
            hypothesis="hypothesis",
            causal_status="directional_until_lift_test",
            guardrails={},
            evidence_refs=[],
        ),
        data_uri="file:///dev/null",
        action_log_uri=None,
        hint=hint,
    )


def _events_with_propensity() -> pd.DataFrame:
    n = 200
    return pd.DataFrame(
        {
            "user_id": range(n),
            "period": [i % 10 for i in range(n)],
            "geo_id": [f"geo_{i % 4:02d}" for i in range(n)],
            "treatment": [i % 2 for i in range(n)],
            "outcome": [i % 3 for i in range(n)],
            "logging_propensity": [0.5] * n,
        }
    )


def _events_geo() -> pd.DataFrame:
    rows = []
    for geo_idx in range(12):
        for period in range(5):
            for _ in range(20):
                treated_geo = 1 if geo_idx < 6 else 0
                post_period = 1 if period >= 2 else 0
                rows.append(
                    {
                        "user_id": len(rows),
                        "period": period,
                        "geo_id": f"geo_{geo_idx:02d}",
                        "treated_geo": treated_geo,
                        "post_period": post_period,
                        "treatment": 1 if treated_geo and post_period else 0,
                        "outcome": 0,
                    }
                )
    return pd.DataFrame(rows)


def _events_user_level() -> pd.DataFrame:
    rng = np.random.default_rng(0)
    n = 300
    return pd.DataFrame(
        {
            "user_id": range(n),
            "treatment": rng.integers(0, 2, n),
            "outcome": rng.integers(0, 2, n),
            "recency": rng.integers(0, 12, n),
            "frequency": rng.integers(0, 20, n),
            "prior_conversions": rng.integers(0, 5, n),
            "device": rng.choice(["desktop", "mobile"], n),
            "age_band": rng.choice(["18-24", "25-34", "35-44"], n),
        }
    )


def _events_aggregate_ts() -> pd.DataFrame:
    return pd.DataFrame({"period": range(40), "outcome": [0.1] * 40})


def _events_no_signal() -> pd.DataFrame:
    return pd.DataFrame({"label": ["x", "y", "z"]})


def test_select_picks_ope_when_propensity_present():
    events = _events_with_propensity()
    req = _req()
    sel = selection_with_reasons(req, events)
    assert sel.method == "ope_ips_snips_dr"
    rejected_methods = {r.method for r in sel.rejected}
    assert "geo_synthetic_control" in rejected_methods
    assert "cate_meta_learner" in rejected_methods
    assert "bsts_synthetic_control" in rejected_methods
    for r in sel.rejected:
        assert r.reason  # non-empty


def test_select_picks_geo_when_hint_or_n_geos():
    events = _events_geo()
    sel = selection_with_reasons(_req(), events)
    assert sel.method == "geo_synthetic_control"

    # Force via hint with fewer geos, but still require the pre/post contract.
    sparse_geo = events[events["geo_id"].isin([f"geo_{idx:02d}" for idx in range(8)])].copy()
    sel2 = selection_with_reasons(_req(hint={"design": "geo_holdout"}), sparse_geo)
    assert sel2.method == "geo_synthetic_control"


def test_select_rejects_legacy_geo_only_treatment_contract():
    events = _events_geo().drop(columns=["treated_geo", "post_period"])
    sel = selection_with_reasons(_req(), events)
    assert sel.method != "geo_synthetic_control"
    geo_rejection = next(r for r in sel.rejected if r.method == "geo_synthetic_control")
    assert geo_rejection.reason == "missing_geo_prepost_columns"


def test_select_picks_cate_for_user_level():
    events = _events_user_level()
    sel = selection_with_reasons(_req(), events)
    assert sel.method == "cate_meta_learner"


def test_select_picks_bsts_for_aggregate_ts():
    events = _events_aggregate_ts()
    sel = selection_with_reasons(_req(), events)
    assert sel.method == "bsts_synthetic_control"


def test_select_falls_back_to_guardrail_only():
    events = _events_no_signal()
    method = select_method(_req(), events)
    assert method == "guardrail_only"


def test_select_returns_string_alias():
    events = _events_with_propensity()
    assert select_method(_req(), events) == "ope_ips_snips_dr"
