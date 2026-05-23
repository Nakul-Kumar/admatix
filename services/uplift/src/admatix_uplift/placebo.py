from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .types import UpliftConfig


@dataclass(frozen=True)
class PlaceboResult:
    n_worlds: int
    seeds: list[int]
    baseline_cr: float
    estimates: list[float]
    mean_estimate: float
    mean_abs_estimate: float
    tolerance: float
    passes_mean_tolerance: bool
    n_lift_detected: int
    false_positive_rate: float
    passes_fpr: bool
    passes: bool
    per_world: list[dict]
    runs_path: Path
    metrics_path: Path
    distribution_plot_path: Path
    fpr_threshold: float = 0.05


def run_placebo_suite(config: UpliftConfig) -> PlaceboResult:
    raise NotImplementedError("run_placebo_suite is implemented after the public API stub commit")
