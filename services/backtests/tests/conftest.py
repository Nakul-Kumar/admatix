from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[3]
BACKTEST_ROOT = ROOT / "services" / "backtests"

for candidate in [
    BACKTEST_ROOT / "src",
    ROOT / "services" / "uplift" / "src",
    ROOT / "services" / "ingest" / "src",
]:
    value = str(candidate)
    if value not in sys.path:
        sys.path.insert(0, value)

pythonpath_entries = [
    str(BACKTEST_ROOT / "src"),
    str(ROOT / "services" / "uplift" / "src"),
    str(ROOT / "services" / "ingest" / "src"),
]
existing_pythonpath = os.environ.get("PYTHONPATH")
os.environ["PYTHONPATH"] = os.pathsep.join(
    pythonpath_entries + ([existing_pythonpath] if existing_pythonpath else [])
)


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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@pytest.fixture()
def tiny_cli_configs(tmp_path: Path) -> dict[str, Path]:
    hillstrom = tmp_path / "hillstrom-tiny.json"
    criteo = tmp_path / "criteo-sample.json"
    hillstrom.write_text(
        json.dumps(
            {
                "output_dir": str(tmp_path / "cli-hillstrom"),
                "seed": 17,
                "bootstrap_iters": 50,
                "hillstrom_arms": ["mens_email"],
            }
        ),
        encoding="utf-8",
    )
    criteo.write_text(
        json.dumps(
            {
                "output_dir": str(tmp_path / "cli-criteo"),
                "seed": 17,
                "bootstrap_iters": 50,
                "criteo_outcomes": ["visit"],
                "criteo_sample_rows": 200000,
            }
        ),
        encoding="utf-8",
    )
    return {"hillstrom": hillstrom, "criteo": criteo}
