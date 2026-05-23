from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal


@dataclass(frozen=True)
class UpliftConfig:
    """Outer config for one harness run. Persisted alongside every result."""

    output_dir: Path
    seeds: list[int]
    world_grid: list[dict] = field(default_factory=list)
    criteo_sample_rows: int | None = None
    train_test_split: float = 0.5
    cate_model: Literal["econml_dml", "causalml_t_learner", "causalml_x_learner"] = "econml_dml"
    ci_level: float = 0.95

    def __post_init__(self) -> None:
        object.__setattr__(self, "output_dir", Path(self.output_dir).resolve())
        if not self.seeds:
            raise ValueError("UpliftConfig.seeds must contain at least one explicit seed")
        if not 0 < self.train_test_split < 1:
            raise ValueError("train_test_split must be between 0 and 1")
        if not 0 < self.ci_level < 1:
            raise ValueError("ci_level must be between 0 and 1")


def config_from_json(payload: dict) -> UpliftConfig:
    return UpliftConfig(
        output_dir=Path(payload["output_dir"]),
        seeds=[int(seed) for seed in payload["seeds"]],
        world_grid=[dict(cell) for cell in payload.get("world_grid", [])],
        criteo_sample_rows=payload.get("criteo_sample_rows"),
        train_test_split=float(payload.get("train_test_split", 0.5)),
        cate_model=payload.get("cate_model", "econml_dml"),
        ci_level=float(payload.get("ci_level", 0.95)),
    )
