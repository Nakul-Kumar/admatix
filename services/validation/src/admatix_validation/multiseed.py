"""Multi-seed variance harness (SIMULATION-VERIFICATION §3.6).

For each config in `config.world_grid`, re-run on `config.seeds` and
compute:
  - coefficient of variation (CV) of the ATE estimate
  - pairwise verdict-stability fraction (fraction of seed pairs whose
    verdict label matches)

Pass: every config has CV ≤ 0.15 *and* verdict-stability ≥ 0.90.
"""

from __future__ import annotations

import itertools
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from .grids import (
    build_verify_request,
    design_hint_for,
    enumerate_cells,
    materialise,
    round_float,
    run_production_verifier,
    write_json,
    write_jsonl,
)
from .types import ValidationConfig, WorldRun


_CV_THRESHOLD = 0.15
_STABILITY_THRESHOLD = 0.90


@dataclass(frozen=True)
class MultiSeedResult:
    n_configs: int
    seeds_per_config: int
    cv_of_estimate: dict[str, float]
    verdict_stability: dict[str, float]
    cv_threshold: float
    stability_threshold: float
    passes: bool
    metrics_path: Path

    def to_dict(self) -> dict:
        payload = asdict(self)
        payload["metrics_path"] = str(self.metrics_path)
        return payload


def _coefficient_of_variation(values: list[float]) -> float:
    arr = np.asarray([v for v in values if v is not None and np.isfinite(v)], dtype=float)
    if len(arr) < 2:
        return 0.0
    mean = float(np.mean(arr))
    if mean == 0:
        return float("inf") if float(np.std(arr, ddof=1)) > 0 else 0.0
    return float(abs(np.std(arr, ddof=1) / mean))


def _verdict_stability(verdicts: list[str]) -> float:
    if len(verdicts) < 2:
        return 1.0
    pairs = list(itertools.combinations(verdicts, 2))
    if not pairs:
        return 1.0
    matches = sum(1 for a, b in pairs if a == b)
    return matches / len(pairs)


def run_multiseed_variance(config: ValidationConfig) -> MultiSeedResult:
    """Run the multi-seed variance loop; return the dataclass."""
    ms_dir = config.output_dir / "multiseed"
    ms_dir.mkdir(parents=True, exist_ok=True)
    sim_root = ms_dir / "worlds"

    by_cell: dict[str, list[tuple[int, float | None, str]]] = defaultdict(list)
    runs: list[WorldRun] = []

    for cell in enumerate_cells(config.world_grid, config.seeds):
        world_type = cell.cell_kwargs.get("world_type", "clean_ab")
        world = materialise(cell, sim_root)
        req = build_verify_request(
            world,
            hint_design=design_hint_for(world_type),
            plausible_lift=float(cell.cell_kwargs.get("true_lift", 0.0) or 0.0) or None,
        )
        result = run_production_verifier(req, config.verifier_method)

        truth = float(world.ground_truth.get("ate", 0.0))
        by_cell[cell.config_hash].append((int(cell.seed), result.estimate, str(result.verdict)))
        runs.append(
            WorldRun(
                config_hash=cell.config_hash,
                seed=int(cell.seed),
                world_id=world.world_id,
                world_type=str(world_type),
                ground_truth_ate=round(truth, 10),
                estimate=round_float(result.estimate),
                ci_low=round_float(result.ci_low),
                ci_high=round_float(result.ci_high),
                method=str(result.method),
                verdict=str(result.verdict),
                diagnostics={
                    **dict(result.diagnostics),
                    "guardrail_all_pass": bool(result.guardrail_proof.all_pass),
                    "verifier_entrypoint": "admatix_verifier.app.verify",
                },
            )
        )

    cv_of_estimate: dict[str, float] = {}
    verdict_stability: dict[str, float] = {}
    passes_all = True

    for config_hash, rows in by_cell.items():
        estimates = [r[1] for r in rows]
        verdicts = [r[2] for r in rows]
        cv = _coefficient_of_variation([e for e in estimates if e is not None])
        stab = _verdict_stability(verdicts)
        cv_of_estimate[config_hash] = round(cv, 10)
        verdict_stability[config_hash] = round(stab, 10)
        if not (cv <= _CV_THRESHOLD and stab >= _STABILITY_THRESHOLD):
            passes_all = False

    runs_sorted = sorted(runs, key=lambda r: (r.config_hash, r.seed))
    runs_path = ms_dir / "runs.jsonl"
    write_jsonl(runs_path, [r.to_dict() for r in runs_sorted])

    metrics_path = ms_dir / "metrics.json"
    metrics = {
        "n_configs": int(len(by_cell)),
        "seeds_per_config": int(len(config.seeds)),
        "cv_of_estimate": dict(sorted(cv_of_estimate.items())),
        "verdict_stability": dict(sorted(verdict_stability.items())),
        "cv_threshold": _CV_THRESHOLD,
        "stability_threshold": _STABILITY_THRESHOLD,
        "passes": bool(passes_all),
        "metrics_path": str(metrics_path),
        "runs_path": str(runs_path),
        "config_hash": config.hash(),
    }
    write_json(metrics_path, metrics)

    return MultiSeedResult(
        n_configs=int(len(by_cell)),
        seeds_per_config=int(len(config.seeds)),
        cv_of_estimate=dict(sorted(cv_of_estimate.items())),
        verdict_stability=dict(sorted(verdict_stability.items())),
        cv_threshold=_CV_THRESHOLD,
        stability_threshold=_STABILITY_THRESHOLD,
        passes=bool(passes_all),
        metrics_path=metrics_path,
    )


__all__ = ["MultiSeedResult", "run_multiseed_variance"]
