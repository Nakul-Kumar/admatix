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
