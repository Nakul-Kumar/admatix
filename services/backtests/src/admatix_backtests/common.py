from __future__ import annotations

import hashlib
import math
from functools import lru_cache
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from .serialization import json_safe
from .types import BacktestConfig


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def dataset_path(dataset: str) -> Path:
    if dataset == "hillstrom":
        return repo_root() / "data" / "datasets" / "hillstrom" / "hillstrom.csv"
    if dataset == "criteo":
        return repo_root() / "data" / "datasets" / "criteo_uplift_v2.1" / "criteo-uplift-v2.1.csv"
    raise ValueError(dataset)


@lru_cache(maxsize=8)
def sha256_file(path_text: str) -> str:
    digest = hashlib.sha256()
    with Path(path_text).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def finite_float(value: float | int | np.floating) -> float:
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"expected finite float, got {value!r}")
    return result


def config_payload(config: BacktestConfig) -> dict:
    return json_safe(config)


def relative_delta(estimate: float, reference: float) -> float:
    denominator = abs(reference)
    if denominator < 1e-12:
        return finite_float(0.0 if abs(estimate) < 1e-12 else math.inf)
    return finite_float((estimate - reference) / denominator)


def bootstrap_diff(
    treated: np.ndarray,
    control: np.ndarray,
    *,
    seed: int,
    iters: int,
    ci_level: float,
) -> tuple[float, float, float, list[float]]:
    treated = np.asarray(treated, dtype=float)
    control = np.asarray(control, dtype=float)
    if len(treated) == 0 or len(control) == 0:
        raise ValueError("treated and control samples must be non-empty")
    ate = finite_float(treated.mean() - control.mean())
    rng = np.random.default_rng(seed)
    distribution: list[float] = []
    for _ in range(iters):
        treated_sample = treated[rng.integers(0, len(treated), len(treated))]
        control_sample = control[rng.integers(0, len(control), len(control))]
        distribution.append(round(finite_float(treated_sample.mean() - control_sample.mean()), 12))
    alpha = (1.0 - ci_level) / 2.0
    ci_low = finite_float(np.quantile(distribution, alpha))
    ci_high = finite_float(np.quantile(distribution, 1.0 - alpha))
    return ate, ci_low, ci_high, distribution


def uplift_scores(frame: pd.DataFrame, feature_columns: Iterable[str], outcome: str) -> np.ndarray:
    features = list(feature_columns)
    if not features:
        return frame[outcome].to_numpy(dtype=float)
    matrix = frame[features].apply(pd.to_numeric, errors="coerce").fillna(0.0).to_numpy(dtype=float)
    means = matrix.mean(axis=0)
    stds = matrix.std(axis=0)
    stds = np.where(stds == 0, 1.0, stds)
    normalized = (matrix - means) / stds
    weights = np.linspace(1.0, 2.0, normalized.shape[1])
    scores = normalized @ weights
    return np.asarray(scores, dtype=float)


def qini_and_auuc(
    frame: pd.DataFrame,
    outcome: str,
    treatment: str,
    scores: np.ndarray,
    curve_path: Path,
    title: str,
) -> tuple[float, float]:
    y = frame[outcome].to_numpy(dtype=float)
    w = frame[treatment].to_numpy(dtype=int)
    plot_curve(curve_path, title, y, w, scores)
    return qini_coefficient(y, w, scores), auuc(y, w, scores)


def qini_coefficient(outcome: np.ndarray, treatment: np.ndarray, scores: np.ndarray) -> float:
    y = np.asarray(outcome, dtype=float)
    w = np.asarray(treatment, dtype=int)
    s = np.asarray(scores, dtype=float)
    if len(y) == 0 or len(y) != len(w) or len(y) != len(s):
        raise ValueError("outcome, treatment, and scores must have the same non-zero length")
    order = np.argsort(-s, kind="mergesort")
    y_sorted = y[order]
    w_sorted = w[order]
    treated = np.cumsum(w_sorted)
    control = np.cumsum(1 - w_sorted)
    treated_safe = np.where(treated == 0, 1, treated)
    control_safe = np.where(control == 0, 1, control)
    y_treated = np.cumsum(y_sorted * w_sorted)
    y_control = np.cumsum(y_sorted * (1 - w_sorted))
    uplift = y_treated - y_control * treated_safe / control_safe
    random = np.linspace(0.0, float(uplift[-1]), len(uplift))
    return finite_float(np.trapezoid(uplift - random) / max(len(uplift), 1))


def auuc(outcome: np.ndarray, treatment: np.ndarray, scores: np.ndarray) -> float:
    y = np.asarray(outcome, dtype=float)
    w = np.asarray(treatment, dtype=int)
    s = np.asarray(scores, dtype=float)
    order = np.argsort(-s, kind="mergesort")
    y_sorted = y[order]
    w_sorted = w[order]
    treated = np.cumsum(w_sorted)
    control = np.cumsum(1 - w_sorted)
    treated_safe = np.where(treated == 0, 1, treated)
    control_safe = np.where(control == 0, 1, control)
    uplift = (np.cumsum(y_sorted * w_sorted) / treated_safe) - (
        np.cumsum(y_sorted * (1 - w_sorted)) / control_safe
    )
    return finite_float(np.trapezoid(uplift) / max(len(uplift), 1))


def plot_curve(path: Path, title: str, outcome: np.ndarray, treatment: np.ndarray, scores: np.ndarray) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    order = np.argsort(-np.asarray(scores, dtype=float), kind="mergesort")
    y = np.asarray(outcome, dtype=float)[order]
    w = np.asarray(treatment, dtype=int)[order]
    treated = np.cumsum(w)
    control = np.cumsum(1 - w)
    treated_safe = np.where(treated == 0, 1, treated)
    control_safe = np.where(control == 0, 1, control)
    uplift = np.cumsum(y * w) / treated_safe - np.cumsum(y * (1 - w)) / control_safe
    path.parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.plot(np.linspace(0, 1, len(uplift)), uplift, linewidth=1.5)
    ax.axhline(0, color="black", linewidth=0.8)
    ax.set_title(title)
    ax.set_xlabel("Population fraction")
    ax.set_ylabel("Cumulative uplift")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def load_hillstrom_frame() -> pd.DataFrame:
    path = dataset_path("hillstrom")
    frame = pd.read_csv(path)
    expected = [
        "recency",
        "history_segment",
        "history",
        "mens",
        "womens",
        "zip_code",
        "newbie",
        "channel",
        "segment",
        "visit",
        "conversion",
        "spend",
    ]
    missing = [column for column in expected if column not in frame.columns]
    if missing:
        raise ValueError(f"Hillstrom CSV at {path} is missing columns {missing}")
    frame = frame[expected].copy()
    mapping = {"No E-Mail": 0, "Mens E-Mail": 1, "Womens E-Mail": 2}
    frame["treatment"] = frame["segment"].map(mapping).astype("int64")
    for column in ["recency", "history", "mens", "womens", "newbie", "visit", "conversion", "spend"]:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    return frame


def load_criteo_frame(nrows: int | None = None) -> pd.DataFrame:
    path = dataset_path("criteo")
    columns = [f"f{i}" for i in range(12)] + ["treatment", "conversion", "visit", "exposure"]
    if nrows is None:
        frame = pd.read_csv(path)
    else:
        head_rows = max(1, nrows // 2)
        tail_rows = max(0, nrows - head_rows)
        treated = pd.read_csv(path, nrows=head_rows)
        if tail_rows:
            first_control = first_criteo_control_row(str(path))
            control = pd.read_csv(path, skiprows=range(1, first_control), nrows=tail_rows)
            frame = pd.concat([treated, control], ignore_index=True)
        else:
            frame = treated
    missing = [column for column in columns if column not in frame.columns]
    if missing:
        raise ValueError(f"Criteo CSV at {path} is missing columns {missing}")
    frame = frame[columns].copy()
    for column in columns:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    return frame


@lru_cache(maxsize=2)
def first_criteo_control_row(path_text: str) -> int:
    with Path(path_text).open("r", encoding="utf-8") as handle:
        next(handle)
        for index, line in enumerate(handle, start=1):
            parts = line.rstrip("\n").split(",")
            if len(parts) >= 13 and parts[12] == "0":
                return index
    raise ValueError(f"no control rows found in {path_text}")


def plot_histogram(path: Path, title: str, values: list[float]) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    path.parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.hist(values, bins=30, color="#386cb0", alpha=0.85)
    ax.axvline(0, color="black", linewidth=0.8)
    ax.set_title(title)
    ax.set_xlabel("ATE")
    ax.set_ylabel("Bootstrap samples")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def plot_propensity(path: Path, fpr: np.ndarray, tpr: np.ndarray, auc_value: float) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    path.parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(5, 5))
    ax.plot(fpr, tpr, label=f"AUC {auc_value:.4f}")
    ax.plot([0, 1], [0, 1], color="black", linewidth=0.8, linestyle="--")
    ax.set_title("Criteo treatment propensity")
    ax.set_xlabel("False positive rate")
    ax.set_ylabel("True positive rate")
    ax.legend(loc="lower right")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
