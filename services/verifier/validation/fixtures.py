"""Deterministic fixture builders for the reference-library comparison.

The reference libraries (`tfcausalimpact`, `obp`) pin pandas<2.2 and cannot
share an environment with the verifier's runtime venv. To compare them
against the bespoke estimators we:

  1. Build a small set of fully specified worlds (same seed every run).
  2. Serialise the events frames + analytic ground truth to JSON/CSV under
     `services/verifier/validation/_fixtures/`.
  3. Run the bespoke estimator on each fixture in the verifier venv and
     record the output to `_bespoke_results.json`.
  4. Run the reference library on each fixture in an ISOLATED venv and
     record its output to `_reference_results.json`.
  5. The orchestrator (`run_validation.py`) joins (3) and (4) on the
     fixture name and reports the per-fixture delta.

The "same seed every run" rule is what makes the comparison apples-to-apples
— both the bespoke and the reference estimator see exactly the same input
bytes.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .bsts_analytic import _build_world as _build_bsts_world
from .ope_analytic import _build_world as _build_ope_world


_FIXTURES_DIR = Path(__file__).resolve().parent / "_fixtures"


def fixtures_dir() -> Path:
    _FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    return _FIXTURES_DIR


def _bsts_fixture_specs() -> list[dict[str, Any]]:
    return [
        {"name": "bsts_no_seasonal_small", "scenario": "no_seasonal_small_effect", "n_periods": 60, "true_delta": 0.005, "seed": 4001},
        {"name": "bsts_no_seasonal_medium", "scenario": "no_seasonal_medium_effect", "n_periods": 60, "true_delta": 0.02, "seed": 4002},
        {"name": "bsts_seasonal_medium", "scenario": "seasonal_medium_effect", "n_periods": 60, "true_delta": 0.02, "seed": 4003},
    ]


def _ope_fixture_specs() -> list[dict[str, Any]]:
    return [
        {"name": "ope_const_prop_always_treat", "scenario": "const_prop_always_treat", "n": 4000, "p_treat": 0.30, "p_control": 0.10, "seed": 5001},
        {"name": "ope_const_prop_split_policy", "scenario": "const_prop_split_policy", "n": 4000, "p_treat": 0.30, "p_control": 0.10, "seed": 5002},
        {"name": "ope_varying_prop_always_treat", "scenario": "varying_prop_always_treat", "n": 4000, "p_treat": 0.30, "p_control": 0.10, "seed": 5003},
    ]


def write_fixtures() -> dict[str, Any]:
    """Write all fixtures to disk and return the manifest."""

    base = fixtures_dir()
    manifest: dict[str, Any] = {"bsts": [], "ope": []}

    for spec in _bsts_fixture_specs():
        events, truth, cfg = _build_bsts_world(spec["scenario"], spec["n_periods"], spec["true_delta"], spec["seed"])
        csv_path = base / f"{spec['name']}.csv"
        events.to_csv(csv_path, index=False)
        manifest["bsts"].append(
            {
                "name": spec["name"],
                "csv": str(csv_path.relative_to(base.parent)),
                "true_delta": float(truth),
                "config": cfg,
            }
        )

    for spec in _ope_fixture_specs():
        events, truth, cfg = _build_ope_world(spec["scenario"], spec["n"], spec["p_treat"], spec["p_control"], spec["seed"])
        csv_path = base / f"{spec['name']}.csv"
        events.to_csv(csv_path, index=False)
        manifest["ope"].append(
            {
                "name": spec["name"],
                "csv": str(csv_path.relative_to(base.parent)),
                "true_value": float(truth),
                "config": cfg,
            }
        )

    manifest_path = base / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, default=float))
    return manifest


def read_csv(rel_path: str) -> pd.DataFrame:
    """Read a fixture by its manifest-relative path (relative to validation/)."""

    base = Path(__file__).resolve().parent
    return pd.read_csv(base / rel_path)


if __name__ == "__main__":
    manifest = write_fixtures()
    print(json.dumps(manifest, indent=2, default=float))
