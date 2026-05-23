from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .types import UpliftConfig


@dataclass(frozen=True)
class QiniSimulatorResult:
    n_worlds: int
    seeds: list[int]
    per_world: list[dict]
    qini_ratios: list[float]
    median_qini_ratio: float
    passes: bool
    qini_curve_paths: list[Path]
    metrics_path: Path
    pass_threshold: float = 0.5


def run_qini_simulator(config: UpliftConfig) -> QiniSimulatorResult:
    raise NotImplementedError("run_qini_simulator is implemented after the public API stub commit")
