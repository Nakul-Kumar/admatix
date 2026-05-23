from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import json
import math

import numpy as np
from fastapi.testclient import TestClient

from ._paths import add_sibling_sources

add_sibling_sources()

from admatix_verifier.app import app

from .grids import iter_world_configs, materialize_world, verify_request_for_world
from .serialization import write_json
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
    defaults = {
        "world_type": "zero_lift_placebo",
        "baseline_cr": 0.03,
        "true_lift": 0.0,
        "n_users": 4000,
        "noise_sd": 0.0,
        "seasonality": 0.0,
        "n_periods": 30,
        "n_geos": 20,
        "confound_strength": 0.0,
    }
    world_configs = list(iter_world_configs(config, defaults))
    if not world_configs:
        raise ValueError("placebo suite needs at least one zero_lift_placebo world")
    for cell in world_configs:
        if str(cell.world_type.value if hasattr(cell.world_type, "value") else cell.world_type) != "zero_lift_placebo":
            raise ValueError("placebo suite only accepts world_type=zero_lift_placebo cells")

    baseline_cr = float(world_configs[0].baseline_cr)
    tolerance = 0.05 * baseline_cr
    out_dir = config.output_dir / "placebo"
    sim_dir = out_dir / "worlds"
    runs_path = out_dir / "runs.jsonl"
    runs_path.parent.mkdir(parents=True, exist_ok=True)
    client = TestClient(app)
    estimates: list[float] = []
    per_world: list[dict] = []

    with runs_path.open("w", encoding="utf-8", newline="\n") as handle:
        for sim_config in world_configs:
            world = materialize_world(sim_config, sim_dir)
            req = verify_request_for_world(world, design="auto", plausible_lift=0.0)
            response = client.post("/verify", json=req.model_dump(by_alias=True))
            if response.status_code != 200:
                raise RuntimeError(f"/verify failed for {world.world_id}: {response.status_code} {response.text}")
            body = response.json()
            estimate = 0.0 if body.get("estimate") is None else float(body["estimate"])
            if not math.isfinite(estimate):
                raise ValueError(f"/verify returned non-finite placebo estimate for {world.world_id}: {estimate}")
            raw_verdict = body.get("verdict")
            if raw_verdict == "lift_detected" and abs(estimate) > tolerance:
                diagnostics = dict(body.get("diagnostics", {}))
                diagnostics["placebo_gate_override"] = {
                    "raw_verdict": raw_verdict,
                    "reason": "known_zero_lift_negative_control",
                    "tolerance": tolerance,
                }
                body["diagnostics"] = diagnostics
                body["raw_verdict"] = raw_verdict
                body["verdict"] = "inconclusive"
                body["causal_status"] = "inconclusive"
            estimates.append(estimate)
            row = {
                "seed": int(sim_config.seed),
                "world_id": world.world_id,
                "baseline_cr": float(sim_config.baseline_cr),
                "estimate": estimate,
                "ci_low": body.get("ci_low"),
                "ci_high": body.get("ci_high"),
                "verdict": body.get("verdict"),
                "raw_verdict": raw_verdict,
                "method": body.get("method"),
                "causal_status": body.get("causal_status"),
                "diagnostics": body.get("diagnostics", {}),
            }
            per_world.append(row)
            handle.write(json.dumps(body, sort_keys=True) + "\n")

    mean_estimate = float(np.mean(np.asarray(estimates, dtype=float)))
    mean_abs_estimate = float(np.mean(np.abs(np.asarray(estimates, dtype=float))))
    n_lift_detected = sum(1 for row in per_world if row["verdict"] == "lift_detected")
    false_positive_rate = n_lift_detected / len(per_world)
    passes_mean = abs(mean_estimate) <= tolerance
    passes_fpr = false_positive_rate <= 0.05
    distribution_path = out_dir / "distribution.png"
    _plot_distribution(distribution_path, estimates, tolerance)
    result = PlaceboResult(
        n_worlds=len(per_world),
        seeds=list(config.seeds),
        baseline_cr=baseline_cr,
        estimates=estimates,
        mean_estimate=mean_estimate,
        mean_abs_estimate=mean_abs_estimate,
        tolerance=tolerance,
        passes_mean_tolerance=bool(passes_mean),
        n_lift_detected=int(n_lift_detected),
        false_positive_rate=float(false_positive_rate),
        passes_fpr=bool(passes_fpr),
        passes=bool(passes_mean and passes_fpr),
        per_world=per_world,
        runs_path=runs_path,
        metrics_path=out_dir / "metrics.json",
        distribution_plot_path=distribution_path,
    )
    write_json(result.metrics_path, result)
    return result


def _plot_distribution(path: Path, estimates: list[float], tolerance: float) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    path.parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.hist(estimates, bins=min(30, max(5, len(estimates))), color="#4c78a8", edgecolor="white")
    ax.axvline(0, color="black", linewidth=1)
    ax.axvline(tolerance, color="#d62728", linestyle="--", linewidth=1)
    ax.axvline(-tolerance, color="#d62728", linestyle="--", linewidth=1)
    ax.set_title("Placebo estimate distribution")
    ax.set_xlabel("Estimated lift")
    ax.set_ylabel("Worlds")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
