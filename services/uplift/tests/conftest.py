from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[3]
UPLIFT_ROOT = ROOT / "services" / "uplift"
for candidate in [
    UPLIFT_ROOT / "src",
    ROOT / "services" / "simulator" / "src",
    ROOT / "services" / "verifier" / "src",
    ROOT / "services" / "ingest" / "src",
]:
    value = str(candidate)
    if value not in sys.path:
        sys.path.insert(0, value)


def dataset_path(name: str) -> Path:
    if name == "hillstrom":
        return ROOT / "data" / "datasets" / "hillstrom" / "hillstrom.csv"
    if name == "criteo":
        return ROOT / "data" / "datasets" / "criteo_uplift_v2.1" / "criteo-uplift-v2.1.csv"
    raise ValueError(name)


def skip_if_missing_dataset(name: str) -> None:
    path = dataset_path(name)
    if not path.exists():
        pytest.skip(f"{name} CSV not staged at {path}; run `python -m admatix_ingest {name}` first")


@pytest.fixture()
def tiny_placebo_config(tmp_path):
    from admatix_uplift import UpliftConfig

    return UpliftConfig(
        output_dir=tmp_path / "out",
        seeds=list(range(10)),
        world_grid=[
            {
                "world_type": "zero_lift_placebo",
                "baseline_cr": 0.03,
                "true_lift": 0.0,
                "n_users": 4000,
                "noise_sd": 0.0,
                "seasonality": 0.0,
                "n_periods": 30,
                "n_geos": 20,
            }
        ],
    )


@pytest.fixture()
def tiny_qini_config(tmp_path):
    from admatix_uplift import UpliftConfig

    return UpliftConfig(
        output_dir=tmp_path / "out",
        seeds=list(range(5)),
        world_grid=[
            {
                "world_type": "clean_ab",
                "baseline_cr": 0.03,
                "true_lift": 0.04,
                "n_users": 2000,
                "noise_sd": 0.0,
                "seasonality": 0.0,
                "n_periods": 30,
                "n_geos": 20,
            }
        ],
    )


@pytest.fixture()
def tiny_cli_configs(tmp_path):
    placebo = tmp_path / "placebo-tiny.json"
    qini = tmp_path / "qini-tiny.json"
    criteo = tmp_path / "criteo-sample.json"
    placebo.write_text(json.dumps({
        "output_dir": str(tmp_path / "cli-placebo"),
        "seeds": [1, 2, 3],
        "world_grid": [{
            "world_type": "zero_lift_placebo",
            "baseline_cr": 0.03,
            "true_lift": 0.0,
            "n_users": 50000,
            "noise_sd": 0.0,
            "seasonality": 0.0,
            "n_periods": 30,
            "n_geos": 20
        }]
    }), encoding="utf-8")
    qini.write_text(json.dumps({
        "output_dir": str(tmp_path / "cli-qini"),
        "seeds": [1, 2, 3, 4, 5],
        "world_grid": [{
            "world_type": "clean_ab",
            "baseline_cr": 0.03,
            "true_lift": 0.04,
            "n_users": 1500,
            "noise_sd": 0.0,
            "seasonality": 0.0,
            "n_periods": 30,
            "n_geos": 20
        }]
    }), encoding="utf-8")
    criteo.write_text(json.dumps({
        "output_dir": str(tmp_path / "cli-criteo"),
        "seeds": [1],
        "criteo_sample_rows": 200000
    }), encoding="utf-8")
    return {"placebo": placebo, "qini": qini, "criteo": criteo}
