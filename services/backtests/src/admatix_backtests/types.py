from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal


HillstromArm = Literal["mens_email", "womens_email"]
CriteoOutcome = Literal["visit", "conversion"]
CateModel = Literal["econml_dml", "causalml_t_learner", "causalml_x_learner"]


@dataclass(frozen=True)
class BacktestConfig:
    """Outer config for one public-dataset backtest run."""

    output_dir: Path
    seed: int = 17
    bootstrap_iters: int = 1000
    ci_level: float = 0.95
    auuc_tolerance: float = 0.10
    qini_tolerance: float = 0.10
    cate_model: CateModel = "econml_dml"
    hillstrom_arms: list[HillstromArm] = field(default_factory=lambda: ["mens_email", "womens_email"])
    criteo_outcomes: list[CriteoOutcome] = field(default_factory=lambda: ["visit", "conversion"])
    criteo_sample_rows: int | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "output_dir", Path(self.output_dir).resolve())
        if self.bootstrap_iters <= 0:
            raise ValueError("bootstrap_iters must be positive")
        if not 0 < self.ci_level < 1:
            raise ValueError("ci_level must be between 0 and 1")
        if self.auuc_tolerance < 0 or self.qini_tolerance < 0:
            raise ValueError("tolerances must be non-negative")
        if not self.hillstrom_arms:
            raise ValueError("hillstrom_arms must not be empty")
        if not self.criteo_outcomes:
            raise ValueError("criteo_outcomes must not be empty")


def config_from_json(payload: dict) -> BacktestConfig:
    return BacktestConfig(
        output_dir=Path(payload["output_dir"]),
        seed=int(payload.get("seed", 17)),
        bootstrap_iters=int(payload.get("bootstrap_iters", 1000)),
        ci_level=float(payload.get("ci_level", 0.95)),
        auuc_tolerance=float(payload.get("auuc_tolerance", 0.10)),
        qini_tolerance=float(payload.get("qini_tolerance", 0.10)),
        cate_model=payload.get("cate_model", "econml_dml"),
        hillstrom_arms=list(payload.get("hillstrom_arms", ["mens_email", "womens_email"])),
        criteo_outcomes=list(payload.get("criteo_outcomes", ["visit", "conversion"])),
        criteo_sample_rows=payload.get("criteo_sample_rows"),
    )
