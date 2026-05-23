"""Run the bespoke estimators on the reference-comparison fixtures.

Runs inside the verifier's runtime venv. Output goes to
`_fixtures/_bespoke_results.json` and is joined by `run_validation.py`
against the reference-library outputs.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from admatix_verifier.methods import bsts, ope
from admatix_verifier.models import H0PacketSubset, VerifyRequest

from .fixtures import _bsts_fixture_specs, _ope_fixture_specs, fixtures_dir, read_csv


_OPE_REQUEST = VerifyRequest(
    packet=H0PacketSubset(
        packet_id="pkt_fixture_ope",
        tenant_id="tenant_validate",
        account_ref="validation:ope_fixture",
        goal="off_policy_eval",
        hypothesis="bespoke vs obp on identical inputs",
        causal_status="experimental",
        guardrails={},
        evidence_refs=[],
    ),
    data_uri="file:///dev/null",
    action_log_uri=None,
    hint={"weight_clip": 20.0},
)


_BSTS_REQUEST = VerifyRequest(
    packet=H0PacketSubset(
        packet_id="pkt_fixture_bsts",
        tenant_id="tenant_validate",
        account_ref="validation:bsts_fixture",
        goal="pre_post_lift",
        hypothesis="bespoke vs tfcausalimpact on identical inputs",
        causal_status="experimental",
        guardrails={},
        evidence_refs=[],
    ),
    data_uri="file:///dev/null",
    action_log_uri=None,
    hint=None,
)


def run() -> dict[str, Any]:
    out: dict[str, Any] = {"bsts": {}, "ope": {}}

    base = fixtures_dir()

    for spec in _bsts_fixture_specs():
        events = pd.read_csv(base / f"{spec['name']}.csv")
        result = bsts.run(_BSTS_REQUEST, events)
        out["bsts"][spec["name"]] = {
            "true_delta": float(spec["true_delta"]),
            "estimate": result.estimate,
            "ci_low": result.ci_low,
            "ci_high": result.ci_high,
            "verdict": result.verdict,
            "posterior_se": float(result.diagnostics.get("posterior_se", 0.0)),
            "naive_independent_se": float(result.diagnostics.get("naive_independent_se", 0.0)),
        }

    for spec in _ope_fixture_specs():
        events = pd.read_csv(base / f"{spec['name']}.csv")
        result = ope.run(_OPE_REQUEST, events)
        diag = result.diagnostics.get("estimators", {}) or {}
        true_value = (
            float(spec["p_treat"])
            if spec["scenario"] != "const_prop_split_policy"
            else 0.5 * float(spec["p_treat"]) + 0.5 * float(spec["p_control"])
        )
        out["ope"][spec["name"]] = {
            "true_value": true_value,
            "ips": diag.get("ips", {}),
            "snips": diag.get("snips", {}),
            "dr": diag.get("dr", {}),
            "verdict": result.verdict,
            "n_effective": float(result.diagnostics.get("n_effective", 0.0)),
            "extreme_weight_fraction": float(result.diagnostics.get("extreme_weight_fraction", 0.0)),
        }

    path = base / "_bespoke_results.json"
    path.write_text(json.dumps(out, indent=2, default=float))
    return out


if __name__ == "__main__":
    print(json.dumps(run(), indent=2, default=float))
