"""Run the full method-validation harness and emit the proof artifact.

Steps (all from the verifier's runtime venv):

  1. Run the analytic Monte-Carlo for OPE (`ope_analytic`).
  2. Run the analytic Monte-Carlo for BSTS (`bsts_analytic`).
  3. Write the deterministic reference-comparison fixtures (`fixtures`).
  4. Score the bespoke estimators on those fixtures (`bespoke_on_fixtures`).
  5. Join against the reference-library outputs (already computed by
     `scripts/run_reference_comparison.sh` in two isolated venvs).
  6. Write everything to
     `services/verifier/validation/method_validation_results.json`.

Acceptance thresholds (enforced by
`services/verifier/tests/test_method_validation.py`):

  * `|bias| ≤ 0.10 · |truth|` on every analytic scenario.
  * `coverage_90 ∈ [0.85, 0.95]` on every analytic scenario.
  * `|reference_delta_estimate| ≤ 0.02` on every fixture (i.e. the
    bespoke estimate is within 2pp absolute of the reference library on
    identical inputs).

The harness is intentionally cheap (≤ ~3 min) so it can run on a developer
laptop; the regression-test path replays only a tight subset.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .bsts_analytic import run_bsts_validation
from .ope_analytic import run_ope_validation
from . import bespoke_on_fixtures, fixtures


VALIDATION_DIR = Path(__file__).resolve().parent
RESULTS_PATH = VALIDATION_DIR / "method_validation_results.json"


def _join_bsts(bespoke: dict[str, Any], reference: dict[str, Any] | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for name, b in bespoke.items():
        ref = (reference or {}).get(name)
        truth = float(b["true_delta"])
        bes_est = float(b["estimate"])
        record: dict[str, Any] = {
            "fixture": name,
            "true_delta": truth,
            "bespoke_estimate": bes_est,
            "bespoke_ci": [b["ci_low"], b["ci_high"]],
            "bespoke_posterior_se": b.get("posterior_se"),
            "bespoke_naive_independent_se": b.get("naive_independent_se"),
            "bespoke_ci_contains_truth": (b["ci_low"] <= truth <= b["ci_high"]),
        }
        if ref is not None:
            ref_est = float(ref["estimate"])
            record.update(
                {
                    "reference_estimate": ref_est,
                    "reference_ci": [ref["ci_low"], ref["ci_high"]],
                    "reference_ci_contains_truth": (ref["ci_low"] <= truth <= ref["ci_high"]),
                    "reference_delta_estimate": bes_est - ref_est,
                }
            )
        rows.append(record)
    return rows


def _join_ope(bespoke: dict[str, Any], reference: dict[str, Any] | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for name, b in bespoke.items():
        truth = float(b["true_value"])
        ref = (reference or {}).get(name)
        for est_name in ("ips", "snips", "dr"):
            bes = b[est_name]
            record: dict[str, Any] = {
                "fixture": name,
                "estimator": est_name,
                "true_value": truth,
                "bespoke_estimate": float(bes["value"]),
                "bespoke_ci": [float(bes["ci_low"]), float(bes["ci_high"])],
                "bespoke_ci_contains_truth": (bes["ci_low"] <= truth <= bes["ci_high"]),
            }
            if ref is not None and est_name in ref:
                r = ref[est_name]
                record.update(
                    {
                        "reference_estimate": float(r["value"]),
                        "reference_ci": [float(r["ci_low"]), float(r["ci_high"])],
                        "reference_ci_contains_truth": (r["ci_low"] <= truth <= r["ci_high"]),
                        "reference_delta_estimate": float(bes["value"]) - float(r["value"]),
                    }
                )
            rows.append(record)
    return rows


def run(n_seeds_ope: int = 200, n_seeds_bsts: int = 100) -> dict[str, Any]:
    print("[1/4] OPE analytic Monte-Carlo …")
    ope_analytic = run_ope_validation(n_seeds=n_seeds_ope)
    print("[2/4] BSTS analytic Monte-Carlo …")
    bsts_analytic = run_bsts_validation(n_seeds=n_seeds_bsts)
    print("[3/4] Fixtures + bespoke-on-fixtures …")
    fixtures.write_fixtures()
    bespoke = bespoke_on_fixtures.run()
    ref_bsts_path = VALIDATION_DIR / "_fixtures" / "_reference_bsts.json"
    ref_ope_path = VALIDATION_DIR / "_fixtures" / "_reference_ope.json"
    ref_bsts = json.loads(ref_bsts_path.read_text()) if ref_bsts_path.exists() else None
    ref_ope = json.loads(ref_ope_path.read_text()) if ref_ope_path.exists() else None

    print("[4/4] Joining and writing artifact …")
    results: dict[str, Any] = {
        "schema_version": 1,
        "ope_analytic": ope_analytic,
        "bsts_analytic": bsts_analytic,
        "reference_comparison": {
            "bsts": _join_bsts(bespoke["bsts"], ref_bsts),
            "ope": _join_ope(bespoke["ope"], ref_ope),
            "reference_libs": {
                "bsts": "tfcausalimpact==0.0.18",
                "ope": "obp==0.5.7",
            },
            "reference_present": {
                "bsts": ref_bsts is not None,
                "ope": ref_ope is not None,
            },
        },
        "acceptance": {
            "bias_relative_tolerance": 0.10,
            "coverage_90_band": [0.85, 0.95],
            "reference_delta_estimate_abs_max": 0.02,
        },
    }

    RESULTS_PATH.write_text(json.dumps(results, indent=2, default=float))
    print(f"wrote {RESULTS_PATH}")
    return results


if __name__ == "__main__":
    run()
