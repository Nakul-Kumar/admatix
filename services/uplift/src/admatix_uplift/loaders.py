from __future__ import annotations

from pathlib import Path

import pandas as pd


def load_hillstrom(
    *,
    dataset_root: Path = Path("data/datasets"),
    raw_root: Path = Path("data/raw"),
    checksum_root: Path = Path("data/checksums"),
) -> pd.DataFrame:
    raise NotImplementedError("load_hillstrom is implemented after the public API stub commit")


def load_criteo_uplift(
    *,
    nrows: int | None = None,
    dataset_root: Path = Path("data/datasets"),
    raw_root: Path = Path("data/raw"),
    checksum_root: Path = Path("data/checksums"),
) -> pd.DataFrame:
    raise NotImplementedError("load_criteo_uplift is implemented after the public API stub commit")
