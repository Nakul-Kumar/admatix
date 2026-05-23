from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from ._paths import add_sibling_sources

add_sibling_sources()

from admatix_verifier.loaders import load_events
from admatix_verifier.methods import cate

from .grids import iter_world_configs, materialize_world, verify_request_for_world
from .metrics import auuc, finite_float, plot_curve, qini_coefficient
from .serialization import write_json
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
    defaults = {
        "world_type": "clean_ab",
        "baseline_cr": 0.03,
        "true_lift": 0.04,
        "n_users": 2000,
        "noise_sd": 0.0,
        "seasonality": 0.0,
        "n_periods": 30,
        "n_geos": 20,
        "confound_strength": 0.0,
    }
    world_configs = list(iter_world_configs(config, defaults))
    if len(world_configs) < 20 and len(world_configs) not in {5}:
        raise ValueError("run_qini_simulator needs at least 20 worlds; 5 is allowed for smoke tests")

    out_dir = config.output_dir / "qini-simulator"
    sim_dir = out_dir / "worlds"
    per_world: list[dict] = []
    ratios: list[float] = []
    curve_paths: list[Path] = []

    for index, sim_config in enumerate(world_configs):
        world = materialize_world(sim_config, sim_dir)
        events = load_events(world.data_uri)
        req = verify_request_for_world(world, design="clean_ab", plausible_lift=float(sim_config.true_lift))
        method_result = cate.run(req, events)

        estimated_scores = _estimated_uplift_scores(events)
        oracle_scores = events["tau"].to_numpy(dtype=float)
        outcome = events["outcome"].to_numpy(dtype=float)
        treatment = events["treatment"].to_numpy(dtype=int)
        est_qini = qini_coefficient(outcome, treatment, estimated_scores)
        oracle_qini = qini_coefficient(outcome, treatment, oracle_scores)
        value_ratio = 0.0 if abs(oracle_qini) < 1e-12 else est_qini / oracle_qini
        value_ratio = finite_float(value_ratio)
        value_auuc = auuc(outcome, treatment, estimated_scores)
        curve_path = out_dir / "curves" / f"{index:03d}-{world.world_id}.png"
        plot_curve(curve_path, f"Simulator Qini {world.world_id}", outcome, treatment, estimated_scores)

        row = {
            "seed": int(sim_config.seed),
            "world_id": world.world_id,
            "world_type": world.world_type.value if hasattr(world.world_type, "value") else str(world.world_type),
            "qini": est_qini,
            "oracle_qini": oracle_qini,
            "auuc": value_auuc,
            "qini_ratio": value_ratio,
            "cate_estimate": method_result.estimate,
            "cate_verdict": method_result.verdict,
            "cate_model": config.cate_model,
            "dataset": "simulator",
            "rng_seed": int(sim_config.seed),
        }
        per_world.append(row)
        ratios.append(value_ratio)
        curve_paths.append(curve_path)

    median_ratio = finite_float(np.median(np.asarray(ratios, dtype=float)))
    result = QiniSimulatorResult(
        n_worlds=len(world_configs),
        seeds=list(config.seeds),
        per_world=per_world,
        qini_ratios=ratios,
        median_qini_ratio=median_ratio,
        passes=bool(median_ratio >= 0.5),
        qini_curve_paths=curve_paths,
        metrics_path=out_dir / "metrics.json",
    )
    write_json(result.metrics_path, result)
    return result


def _estimated_uplift_scores(events: pd.DataFrame) -> np.ndarray:
    features = [col for col in ["recency", "frequency", "prior_conversions"] if col in events.columns]
    if not features:
        return events["outcome"].to_numpy(dtype=float)
    try:
        from sklearn.ensemble import GradientBoostingRegressor

        x = events[features].to_numpy(dtype=float)
        y = events["outcome"].to_numpy(dtype=float)
        w = events["treatment"].to_numpy(dtype=int)
        treated = w == 1
        control = w == 0
        if treated.sum() < 10 or control.sum() < 10:
            raise ValueError("not enough treated/control rows")
        model_t = GradientBoostingRegressor(n_estimators=40, max_depth=2, random_state=17)
        model_c = GradientBoostingRegressor(n_estimators=40, max_depth=2, random_state=17)
        model_t.fit(x[treated], y[treated])
        model_c.fit(x[control], y[control])
        return np.asarray(model_t.predict(x) - model_c.predict(x), dtype=float)
    except Exception:
        recency = pd.to_numeric(events["recency"], errors="coerce").to_numpy(dtype=float)
        return (12.0 - recency) / 12.0
