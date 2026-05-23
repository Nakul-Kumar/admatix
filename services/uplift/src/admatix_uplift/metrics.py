from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd


def finite_float(value: float | int | np.floating) -> float:
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"expected finite metric value, got {result!r}")
    return result


def qini_coefficient(outcome: np.ndarray, treatment: np.ndarray, scores: np.ndarray) -> float:
    y = np.asarray(outcome, dtype=float)
    w = np.asarray(treatment, dtype=int)
    s = np.asarray(scores, dtype=float)
    if len(y) == 0 or len(y) != len(w) or len(y) != len(s):
        raise ValueError("outcome, treatment, and scores must have the same non-zero length")
    try:
        from causalml.metrics import qini_score  # type: ignore

        frame = pd.DataFrame({"y": y, "w": w, "score": s})
        result = qini_score(frame, outcome_col="y", treatment_col="w", normalize=False)
        if isinstance(result, pd.DataFrame):
            cols = [col for col in result.columns if str(col).lower() != "random"]
            if cols:
                return finite_float(result[cols[0]].iloc[0])
        if isinstance(result, pd.Series):
            return finite_float(result.iloc[0])
        return finite_float(result)
    except Exception:
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
    try:
        from causalml.metrics import auuc_score  # type: ignore

        frame = pd.DataFrame({"y": y, "w": w, "score": s})
        result = auuc_score(frame, outcome_col="y", treatment_col="w", normalize=False)
        if isinstance(result, pd.DataFrame):
            cols = [col for col in result.columns if str(col).lower() != "random"]
            if cols:
                return finite_float(result[cols[0]].iloc[0])
        if isinstance(result, pd.Series):
            return finite_float(result.iloc[0])
        return finite_float(result)
    except Exception:
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
