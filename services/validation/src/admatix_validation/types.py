"""Shared dataclasses for the validation harness.

`ValidationConfig` is the outer config for one harness run; it is persisted
verbatim alongside every metrics bundle so a reviewer can replay a result
from a clean shell. `WorldRun` is one (config, seed) iteration in
JSONL-friendly form — the wire shape coverage / rmse / multi-seed all
serialise to disk.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal


VerifierMethod = Literal[
    "auto",
    "cate_meta_learner",
    "bsts_synthetic_control",
    "geo_synthetic_control",
    "ope_ips_snips_dr",
]


@dataclass(frozen=True)
class ValidationConfig:
    """Outer config for one harness run. Persisted alongside every result."""

    output_dir: Path
    n_simulations: int
    seeds: list[int]
    world_grid: list[dict[str, Any]]
    verifier_method: VerifierMethod = "auto"
    ci_level: float = 0.95

    def __post_init__(self) -> None:
        # Normalise output_dir to absolute Path; everyone downstream relies on it.
        object.__setattr__(self, "output_dir", Path(self.output_dir).resolve())
        if self.n_simulations < 0:
            raise ValueError("n_simulations must be non-negative")
        if not self.seeds:
            raise ValueError("seeds must be a non-empty explicit grid")
        if not self.world_grid:
            raise ValueError("world_grid must be a non-empty list of SimulationConfig kwargs")
        if not 0 < self.ci_level < 1:
            raise ValueError("ci_level must be in (0, 1)")

    def to_dict(self) -> dict[str, Any]:
        return {
            "output_dir": str(self.output_dir),
            "n_simulations": self.n_simulations,
            "seeds": list(self.seeds),
            "world_grid": [dict(cell) for cell in self.world_grid],
            "verifier_method": self.verifier_method,
            "ci_level": self.ci_level,
        }

    def hash(self) -> str:
        """A stable hash over the harness inputs (excluding output_dir).

        Output_dir is excluded so the same harness invocation against the
        same parameters produces the same hash even when the operator
        chooses a different output directory. Determinism test relies on
        this.
        """
        payload = {
            "n_simulations": self.n_simulations,
            "seeds": list(self.seeds),
            "world_grid": [dict(sorted(cell.items())) for cell in self.world_grid],
            "verifier_method": self.verifier_method,
            "ci_level": self.ci_level,
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class WorldRun:
    """One (config, seed) iteration in JSONL-friendly form."""

    config_hash: str
    seed: int
    world_id: str
    world_type: str
    ground_truth_ate: float
    estimate: float | None
    ci_low: float | None
    ci_high: float | None
    method: str
    verdict: str
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "config_hash": self.config_hash,
            "seed": self.seed,
            "world_id": self.world_id,
            "world_type": self.world_type,
            "ground_truth_ate": self.ground_truth_ate,
            "estimate": self.estimate,
            "ci_low": self.ci_low,
            "ci_high": self.ci_high,
            "method": self.method,
            "verdict": self.verdict,
            "diagnostics": dict(self.diagnostics),
        }


__all__ = ["ValidationConfig", "WorldRun", "VerifierMethod"]
