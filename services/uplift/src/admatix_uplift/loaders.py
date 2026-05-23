from __future__ import annotations

from pathlib import Path

import pandas as pd

from ._paths import add_sibling_sources

add_sibling_sources()

from admatix_ingest import CRITEO_UPLIFT_COLUMNS, HILLSTROM_COLUMNS, acquire_by_name


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _resolve(path: Path) -> Path:
    return path if path.is_absolute() else _repo_root() / path


def _landed_path(dataset_root: Path, dataset_name: str, filename: str) -> Path:
    return _resolve(dataset_root) / dataset_name / filename


def _ensure_landed(
    dataset_name: str,
    path: Path,
    dataset_root: Path,
    raw_root: Path,
    checksum_root: Path,
) -> Path:
    if path.exists():
        return path
    acquire_by_name(
        dataset_name,
        dataset_root=_resolve(dataset_root),
        raw_root=_resolve(raw_root),
        checksum_root=_resolve(checksum_root),
    )
    return path


def load_hillstrom(
    *,
    dataset_root: Path = Path("data/datasets"),
    raw_root: Path = Path("data/raw"),
    checksum_root: Path = Path("data/checksums"),
) -> pd.DataFrame:
    path = _landed_path(dataset_root, "hillstrom", "hillstrom.csv")
    path = _ensure_landed("hillstrom", path, dataset_root, raw_root, checksum_root)
    frame = pd.read_csv(path)
    missing = [col for col in HILLSTROM_COLUMNS if col not in frame.columns]
    if missing:
        raise ValueError(f"Hillstrom CSV at {path} is missing columns {missing}")
    frame = frame[HILLSTROM_COLUMNS].copy()
    mapping = {"No E-Mail": 0, "Mens E-Mail": 1, "Womens E-Mail": 2}
    frame["treatment"] = frame["segment"].map(mapping).astype("int64")
    numeric = ["recency", "history", "mens", "womens", "newbie", "visit", "conversion", "spend"]
    for col in numeric:
        frame[col] = pd.to_numeric(frame[col], errors="raise")
    return frame


def load_criteo_uplift(
    *,
    nrows: int | None = None,
    dataset_root: Path = Path("data/datasets"),
    raw_root: Path = Path("data/raw"),
    checksum_root: Path = Path("data/checksums"),
) -> pd.DataFrame:
    path = _landed_path(dataset_root, "criteo_uplift_v2.1", "criteo-uplift-v2.1.csv")
    path = _ensure_landed("criteo_uplift_v2.1", path, dataset_root, raw_root, checksum_root)
    frame = pd.read_csv(path, nrows=nrows)
    missing = [col for col in CRITEO_UPLIFT_COLUMNS if col not in frame.columns]
    if missing:
        raise ValueError(f"Criteo Uplift CSV at {path} is missing columns {missing}")
    frame = frame[CRITEO_UPLIFT_COLUMNS].copy()
    for col in CRITEO_UPLIFT_COLUMNS:
        frame[col] = pd.to_numeric(frame[col], errors="raise")
    return frame
