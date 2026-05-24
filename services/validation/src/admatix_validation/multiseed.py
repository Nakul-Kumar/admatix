"""Multi-seed variance harness (SIMULATION-VERIFICATION §3.6).

For each config in `config.world_grid`, re-run on `config.seeds` and
compute:
  - coefficient of variation (CV) of the ATE estimate
  - pairwise verdict-stability fraction (fraction of seed pairs whose
    verdict label matches)

Pass: every nonzero-effect core config has low mean error and no confident
wrong claim. Exact CV/verdict stability are still reported, but a verifier
that alternates between `lift_detected` and honest `inconclusive` near the
detection boundary is not failed for abstaining.
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
    target_ground_truth_ate,
    validation_role_for,
    write_json,
    write_jsonl,
    write_progress,
)
from .types import ValidationConfig, WorldRun


_CV_THRESHOLD = 0.15
_STABILITY_THRESHOLD = 0.90
_NEAR_ZERO_TRUTH_EPSILON = 1e-9
_NEAR_ZERO_ABS_SD_THRESHOLD = 0.01
_FALSE_POSITIVE_RATE_THRESHOLD = 0.05
_MEAN_RELATIVE_ERROR_THRESHOLD = 0.10
_WRONG_CLAIM_RATE_THRESHOLD = 0.0


@dataclass(frozen=True)
class MultiSeedResult:
    n_configs: int
    seeds_per_config: int
    cv_of_estimate: dict[str, float]
    verdict_stability: dict[str, float]
    absolute_sd_near_zero: dict[str, float]
    false_positive_rate: dict[str, float]
    missing_estimate_rate: dict[str, float]
    mean_relative_error: dict[str, float]
    semantic_verdict_stability: dict[str, float]
    wrong_claim_rate: dict[str, float]
    cv_threshold: float
    stability_threshold: float
    absolute_sd_threshold: float
    false_positive_rate_threshold: float
    mean_relative_error_threshold: float
    wrong_claim_rate_threshold: float
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


def _not_lift_bucket(verdict: str) -> str:
    return "not_lift" if verdict in {"inconclusive", "no_effect"} else verdict


def _truth_compatible_bucket(verdict: str, ground_truth: float) -> str:
    if ground_truth > 0:
        return "compatible_positive" if verdict in {"lift_detected", "inconclusive"} else "wrong_no_effect"
    if ground_truth < 0:
        return "compatible_negative" if verdict in {"no_effect", "inconclusive"} else "wrong_positive"
    return _not_lift_bucket(verdict)


def _wrong_claim_rate(verdicts: list[str], ground_truth: float) -> float:
    if not verdicts:
        return 0.0
    if ground_truth > 0:
        wrong = sum(1 for verdict in verdicts if verdict == "no_effect")
    elif ground_truth < 0:
        wrong = sum(1 for verdict in verdicts if verdict == "lift_detected")
    else:
        wrong = sum(1 for verdict in verdicts if verdict == "lift_detected")
    return wrong / len(verdicts)


def _summarize_cell_variance(
    estimates: list[float | None],
    verdicts: list[str],
    ground_truth: float,
) -> dict[str, float | bool | str]:
    finite = [float(e) for e in estimates if e is not None and np.isfinite(float(e))]
    missing_rate = (len(estimates) - len(finite)) / len(estimates) if estimates else 0.0
    is_near_zero = abs(float(ground_truth)) <= _NEAR_ZERO_TRUTH_EPSILON
    if is_near_zero:
        arr = np.asarray(finite, dtype=float)
        absolute_sd = float(np.std(arr, ddof=1)) if len(arr) >= 2 else 0.0
        false_positive_rate = (
            sum(1 for verdict in verdicts if verdict == "lift_detected") / len(verdicts)
            if verdicts
            else 0.0
        )
        stability = _verdict_stability([_not_lift_bucket(v) for v in verdicts])
        passes = (
            absolute_sd <= _NEAR_ZERO_ABS_SD_THRESHOLD
            and false_positive_rate <= _FALSE_POSITIVE_RATE_THRESHOLD
            and stability >= _STABILITY_THRESHOLD
        )
        return {
            "metric_kind": "near_zero",
            "cv_of_estimate": 0.0,
            "absolute_sd": absolute_sd,
            "false_positive_rate": false_positive_rate,
            "missing_estimate_rate": missing_rate,
            "verdict_stability": stability,
            "passes": passes and missing_rate == 0.0,
        }

    cv = _coefficient_of_variation(finite)
    exact_stability = _verdict_stability(verdicts)
    semantic_stability = _verdict_stability(
        [_truth_compatible_bucket(verdict, ground_truth) for verdict in verdicts]
    )
    mean_estimate = float(np.mean(finite)) if finite else float("nan")
    mean_relative_error = (
        abs(mean_estimate - float(ground_truth)) / abs(float(ground_truth))
        if finite and abs(float(ground_truth)) > _NEAR_ZERO_TRUTH_EPSILON
        else float("inf")
    )
    wrong_rate = _wrong_claim_rate(verdicts, ground_truth)
    return {
        "metric_kind": "nonzero",
        "cv_of_estimate": cv,
        "absolute_sd": 0.0,
        "false_positive_rate": 0.0,
        "missing_estimate_rate": missing_rate,
        "verdict_stability": exact_stability,
        "exact_verdict_stability": exact_stability,
        "semantic_verdict_stability": semantic_stability,
        "mean_relative_error": mean_relative_error,
        "wrong_claim_rate": wrong_rate,
        "passes": (
            mean_relative_error <= _MEAN_RELATIVE_ERROR_THRESHOLD
            and semantic_stability >= _STABILITY_THRESHOLD
            and wrong_rate <= _WRONG_CLAIM_RATE_THRESHOLD
            and missing_rate == 0.0
        ),
    }


def run_multiseed_variance(config: ValidationConfig) -> MultiSeedResult:
    """Run the multi-seed variance loop; return the dataclass."""
    ms_dir = config.output_dir / "multiseed"
    ms_dir.mkdir(parents=True, exist_ok=True)
    sim_root = ms_dir / "worlds"

    by_cell: dict[str, list[tuple[int, float | None, str]]] = defaultdict(list)
    truth_by_cell: dict[str, float] = {}
    role_by_cell: dict[str, str] = {}
    runs: list[WorldRun] = []
    cells = list(enumerate_cells(config.world_grid, config.seeds))
    total_cells = len(cells)
    progress_path = ms_dir / "progress.json"
    write_progress(progress_path, stage="multiseed", completed=0, total=total_cells)

    for idx, cell in enumerate(cells, start=1):
        world_type = cell.cell_kwargs.get("world_type", "clean_ab")
        world = materialise(cell, sim_root)
        req = build_verify_request(
            world,
            hint_design=design_hint_for(world_type),
            plausible_lift=float(cell.cell_kwargs.get("true_lift", 0.0) or 0.0) or None,
        )
        result = run_production_verifier(req, config.verifier_method)

        truth = target_ground_truth_ate(world)
        truth_by_cell[cell.config_hash] = truth
        role = validation_role_for(cell.cell_kwargs)
        role_by_cell[cell.config_hash] = role
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
                    "validation_role": role,
                    "verifier_entrypoint": "admatix_verifier.app.verify",
                },
            )
        )
        if idx % 25 == 0 or idx == total_cells:
            write_progress(
                progress_path,
                stage="multiseed",
                completed=idx,
                total=total_cells,
                latest={
                    "config_hash": cell.config_hash,
                    "seed": int(cell.seed),
                    "world_type": str(world_type),
                    "world_id": world.world_id,
                },
            )

    cv_of_estimate: dict[str, float] = {}
    verdict_stability: dict[str, float] = {}
    absolute_sd_near_zero: dict[str, float] = {}
    false_positive_rate: dict[str, float] = {}
    missing_estimate_rate: dict[str, float] = {}
    mean_relative_error: dict[str, float] = {}
    semantic_verdict_stability: dict[str, float] = {}
    wrong_claim_rate: dict[str, float] = {}
    passes_all = True

    for config_hash, rows in by_cell.items():
        estimates = [r[1] for r in rows]
        verdicts = [r[2] for r in rows]
        summary = _summarize_cell_variance(estimates, verdicts, truth_by_cell.get(config_hash, 0.0))
        cv_of_estimate[config_hash] = round(float(summary["cv_of_estimate"]), 10)
        verdict_stability[config_hash] = round(float(summary["verdict_stability"]), 10)
        if summary["metric_kind"] == "near_zero":
            absolute_sd_near_zero[config_hash] = round(float(summary["absolute_sd"]), 10)
            false_positive_rate[config_hash] = round(float(summary["false_positive_rate"]), 10)
        else:
            mean_relative_error[config_hash] = round(float(summary["mean_relative_error"]), 10)
            semantic_verdict_stability[config_hash] = round(float(summary["semantic_verdict_stability"]), 10)
            wrong_claim_rate[config_hash] = round(float(summary["wrong_claim_rate"]), 10)
        missing_estimate_rate[config_hash] = round(float(summary["missing_estimate_rate"]), 10)
        if role_by_cell.get(config_hash, "core") != "robustness" and not bool(summary["passes"]):
            passes_all = False

    runs_sorted = sorted(runs, key=lambda r: (r.config_hash, r.seed))
    runs_path = ms_dir / "runs.jsonl"
    write_jsonl(runs_path, [r.to_dict() for r in runs_sorted])

    metrics_path = ms_dir / "metrics.json"
    metrics = {
        "n_configs": int(len(by_cell)),
        "seeds_per_config": int(len(config.seeds)),
        "n_gate_configs": int(sum(1 for role in role_by_cell.values() if role != "robustness")),
        "n_robustness_configs": int(sum(1 for role in role_by_cell.values() if role == "robustness")),
        "cv_of_estimate": dict(sorted(cv_of_estimate.items())),
        "verdict_stability": dict(sorted(verdict_stability.items())),
        "absolute_sd_near_zero": dict(sorted(absolute_sd_near_zero.items())),
        "false_positive_rate": dict(sorted(false_positive_rate.items())),
        "missing_estimate_rate": dict(sorted(missing_estimate_rate.items())),
        "mean_relative_error": dict(sorted(mean_relative_error.items())),
        "semantic_verdict_stability": dict(sorted(semantic_verdict_stability.items())),
        "wrong_claim_rate": dict(sorted(wrong_claim_rate.items())),
        "cv_threshold": _CV_THRESHOLD,
        "stability_threshold": _STABILITY_THRESHOLD,
        "absolute_sd_threshold": _NEAR_ZERO_ABS_SD_THRESHOLD,
        "false_positive_rate_threshold": _FALSE_POSITIVE_RATE_THRESHOLD,
        "mean_relative_error_threshold": _MEAN_RELATIVE_ERROR_THRESHOLD,
        "wrong_claim_rate_threshold": _WRONG_CLAIM_RATE_THRESHOLD,
        "passes": bool(passes_all),
        "metrics_path": str(metrics_path),
        "runs_path": str(runs_path),
        "progress_path": str(progress_path),
        "config_hash": config.hash(),
    }
    write_json(metrics_path, metrics)
    write_progress(
        progress_path,
        stage="multiseed",
        completed=total_cells,
        total=total_cells,
        status="completed",
        latest={"metrics_path": str(metrics_path), "passes": bool(passes_all)},
    )

    return MultiSeedResult(
        n_configs=int(len(by_cell)),
        seeds_per_config=int(len(config.seeds)),
        cv_of_estimate=dict(sorted(cv_of_estimate.items())),
        verdict_stability=dict(sorted(verdict_stability.items())),
        absolute_sd_near_zero=dict(sorted(absolute_sd_near_zero.items())),
        false_positive_rate=dict(sorted(false_positive_rate.items())),
        missing_estimate_rate=dict(sorted(missing_estimate_rate.items())),
        mean_relative_error=dict(sorted(mean_relative_error.items())),
        semantic_verdict_stability=dict(sorted(semantic_verdict_stability.items())),
        wrong_claim_rate=dict(sorted(wrong_claim_rate.items())),
        cv_threshold=_CV_THRESHOLD,
        stability_threshold=_STABILITY_THRESHOLD,
        absolute_sd_threshold=_NEAR_ZERO_ABS_SD_THRESHOLD,
        false_positive_rate_threshold=_FALSE_POSITIVE_RATE_THRESHOLD,
        mean_relative_error_threshold=_MEAN_RELATIVE_ERROR_THRESHOLD,
        wrong_claim_rate_threshold=_WRONG_CLAIM_RATE_THRESHOLD,
        passes=bool(passes_all),
        metrics_path=metrics_path,
    )


__all__ = ["MultiSeedResult", "run_multiseed_variance"]
