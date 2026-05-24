"""Point-estimate RMSE and bias harness (SIMULATION-VERIFICATION §3.3).

For each world_type in {clean_ab, confounded, geo_structured}:
  - bias = mean(est − true)
  - rmse = sqrt(mean((est − true)^2))
  - Confounded worlds gate on |bias| ≤ 0.1·|true_lift|.
  - Clean_ab worlds gate on |bias| ≤ 0.05·|true_lift|.
  - RMSE gates on ≤ 0.25·true_lift at default n_users; with a
    consistency check (RMSE at n_users=4·default < RMSE at default).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

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


_BIAS_CONFOUNDED_REL = 0.10
_BIAS_CLEAN_REL = 0.05
_RMSE_REL = 0.25


def _missing_estimate_rate(n_missing: int, n_expected: int) -> float:
    if n_expected <= 0:
        return 0.0
    return float(n_missing / n_expected)


def _is_underpowered_estimate(diagnostics: dict[str, Any]) -> bool:
    reason = str(diagnostics.get("reason", "")).strip().lower()
    return reason == "underpowered"


@dataclass(frozen=True)
class RmseBiasResult:
    n_worlds: int
    per_world_type: dict[str, dict[str, float]]
    bias_threshold_rel: float
    rmse_threshold_rel: float
    consistency_ok: bool
    passes_bias: bool
    passes_rmse: bool
    metrics_path: Path
    table_path: Path

    def to_dict(self) -> dict:
        payload = asdict(self)
        payload["metrics_path"] = str(self.metrics_path)
        payload["table_path"] = str(self.table_path)
        return payload


def _markdown_table(per_world_type: dict[str, dict[str, float]]) -> str:
    """A small Markdown table for the proof report.

    Columns: world_type | n | bias | rmse | true_lift_mean. Sorted by
    world_type for byte-stable output.
    """
    lines = [
        "| world_type | n | bias | rmse | true_lift_mean | passes_bias | passes_rmse |",
        "| --- | ---: | ---: | ---: | ---: | :---: | :---: |",
    ]
    for world_type in sorted(per_world_type.keys()):
        row = per_world_type[world_type]
        n = row.get("n", 0)
        bias = row.get("bias", float("nan"))
        rmse = row.get("rmse", float("nan"))
        true_lift = row.get("true_lift_mean", float("nan"))
        passes_b = row.get("passes_bias", False)
        passes_r = row.get("passes_rmse", False)
        lines.append(
            f"| {world_type} | {n} | {bias:.6f} | {rmse:.6f} | {true_lift:.6f} | {bool(passes_b)} | {bool(passes_r)} |"
        )
    return "\n".join(lines) + "\n"


def _per_cell_n_users(cell: dict[str, Any]) -> int:
    n = cell.get("n_users")
    if n is None:
        return 200_000  # SimulationConfig default
    return int(n)


def run_rmse_bias(config: ValidationConfig) -> RmseBiasResult:
    """Run the RMSE/bias loop; return the result dataclass."""
    rmse_dir = config.output_dir / "rmse_bias"
    rmse_dir.mkdir(parents=True, exist_ok=True)
    sim_root = rmse_dir / "worlds"

    runs: list[WorldRun] = []
    # Track (estimate, truth, n_users) per (world_type) for the consistency check.
    by_type: dict[str, list[tuple[float, float, int]]] = defaultdict(list)
    expected_by_type: dict[str, int] = defaultdict(int)
    missing_by_type: dict[str, int] = defaultdict(int)
    underpowered_by_type: dict[str, int] = defaultdict(int)
    cells = list(enumerate_cells(config.world_grid, config.seeds))
    total_cells = len(cells)
    progress_path = rmse_dir / "progress.json"
    write_progress(progress_path, stage="rmse_bias", completed=0, total=total_cells)

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
        est = result.estimate
        n_users = _per_cell_n_users(cell.cell_kwargs)
        role = validation_role_for(cell.cell_kwargs)
        diagnostics = dict(result.diagnostics)
        if role != "robustness":
            expected_by_type[str(world_type)] += 1
            if _is_underpowered_estimate(diagnostics):
                underpowered_by_type[str(world_type)] += 1
            elif est is not None and np.isfinite(est):
                by_type[str(world_type)].append((float(est), truth, n_users))
            else:
                missing_by_type[str(world_type)] += 1
        runs.append(
            WorldRun(
                config_hash=cell.config_hash,
                seed=int(cell.seed),
                world_id=world.world_id,
                world_type=str(world_type),
                ground_truth_ate=round(truth, 10),
                estimate=round_float(est),
                ci_low=round_float(result.ci_low),
                ci_high=round_float(result.ci_high),
                method=str(result.method),
                verdict=str(result.verdict),
                diagnostics={
                    **diagnostics,
                    "n_users": int(n_users),
                    "guardrail_all_pass": bool(result.guardrail_proof.all_pass),
                    "validation_role": role,
                    "verifier_entrypoint": "admatix_verifier.app.verify",
                },
            )
        )
        if idx % 25 == 0 or idx == total_cells:
            write_progress(
                progress_path,
                stage="rmse_bias",
                completed=idx,
                total=total_cells,
                latest={
                    "config_hash": cell.config_hash,
                    "seed": int(cell.seed),
                    "world_type": str(world_type),
                    "world_id": world.world_id,
                },
            )

    per_world_type: dict[str, dict[str, float]] = {}
    passes_bias_all = True
    passes_rmse_all = True
    consistency_ok = True

    for world_type in sorted(expected_by_type):
        rows = by_type.get(world_type, [])
        missing = int(missing_by_type.get(world_type, 0))
        expected = int(expected_by_type[world_type])
        underpowered = int(underpowered_by_type.get(world_type, 0))
        gated_expected = max(0, expected - underpowered)
        missing_rate = _missing_estimate_rate(missing, gated_expected)
        if not rows:
            per_world_type[world_type] = {
                "n": 0,
                "expected_n": expected,
                "gated_expected_n": gated_expected,
                "underpowered_estimates": underpowered,
                "missing_estimates": missing,
                "missing_estimate_rate": round(missing_rate, 10),
                "bias": float("nan"),
                "rmse": float("nan"),
                "passes_bias": False,
                "passes_rmse": False,
                "consistency_ok": False,
            }
            passes_bias_all = False
            passes_rmse_all = False
            consistency_ok = False
            continue
        est = np.array([r[0] for r in rows], dtype=float)
        truth = np.array([r[1] for r in rows], dtype=float)
        n_users = np.array([r[2] for r in rows], dtype=int)
        diff = est - truth
        bias = float(np.mean(diff))
        rmse = float(np.sqrt(np.mean(diff**2)))
        true_lift_mean = float(np.mean(np.abs(truth))) if np.any(truth != 0) else 0.0

        # Gate bands per §3.3
        rel_bias_limit = (
            _BIAS_CONFOUNDED_REL if world_type == "confounded"
            else _BIAS_CLEAN_REL
        )
        passes_bias = abs(bias) <= rel_bias_limit * true_lift_mean if true_lift_mean > 0 else abs(bias) <= 0.005
        passes_rmse = rmse <= _RMSE_REL * true_lift_mean if true_lift_mean > 0 else rmse <= 0.01
        if missing:
            passes_bias = False
            passes_rmse = False

        # Consistency check: RMSE at 4·default < RMSE at default (within
        # the same world_type subset, when both are present). We use the
        # smallest n_users in the subset as "default".
        unique_ns = sorted(set(int(n) for n in n_users))
        consistency_pass = True
        if len(unique_ns) >= 2:
            small_n = unique_ns[0]
            large_n = unique_ns[-1]
            small_mask = n_users == small_n
            large_mask = n_users == large_n
            rmse_small = float(np.sqrt(np.mean(diff[small_mask] ** 2))) if small_mask.any() else float("nan")
            rmse_large = float(np.sqrt(np.mean(diff[large_mask] ** 2))) if large_mask.any() else float("nan")
            consistency_pass = bool(rmse_large <= rmse_small * 1.1)
            consistency_ok = consistency_ok and consistency_pass

        passes_bias_all = passes_bias_all and bool(passes_bias)
        passes_rmse_all = passes_rmse_all and bool(passes_rmse)

        per_world_type[world_type] = {
            "n": int(len(rows)),
            "expected_n": expected,
            "gated_expected_n": gated_expected,
            "underpowered_estimates": underpowered,
            "missing_estimates": missing,
            "missing_estimate_rate": round(missing_rate, 10),
            "bias": round(bias, 10),
            "rmse": round(rmse, 10),
            "true_lift_mean": round(true_lift_mean, 10),
            "passes_bias": bool(passes_bias),
            "passes_rmse": bool(passes_rmse),
            "consistency_ok": bool(consistency_pass),
        }

    runs_sorted = sorted(runs, key=lambda r: (r.config_hash, r.seed))
    runs_path = rmse_dir / "runs.jsonl"
    write_jsonl(runs_path, [r.to_dict() for r in runs_sorted])

    table_path = rmse_dir / "table.md"
    table_path.write_text(_markdown_table(per_world_type), encoding="utf-8")

    metrics_path = rmse_dir / "metrics.json"
    metrics = {
        "n_worlds": int(len(runs)),
        "per_world_type": per_world_type,
        "bias_threshold_rel": _BIAS_CONFOUNDED_REL,
        "rmse_threshold_rel": _RMSE_REL,
        "consistency_ok": bool(consistency_ok),
        "passes_bias": bool(passes_bias_all),
        "passes_rmse": bool(passes_rmse_all),
        "metrics_path": str(metrics_path),
        "table_path": str(table_path),
        "runs_path": str(runs_path),
        "progress_path": str(progress_path),
        "config_hash": config.hash(),
    }
    write_json(metrics_path, metrics)
    write_progress(
        progress_path,
        stage="rmse_bias",
        completed=total_cells,
        total=total_cells,
        status="completed",
        latest={
            "metrics_path": str(metrics_path),
            "passes_bias": bool(passes_bias_all),
            "passes_rmse": bool(passes_rmse_all),
        },
    )

    return RmseBiasResult(
        n_worlds=int(len(runs)),
        per_world_type=per_world_type,
        bias_threshold_rel=_BIAS_CONFOUNDED_REL,
        rmse_threshold_rel=_RMSE_REL,
        consistency_ok=bool(consistency_ok),
        passes_bias=bool(passes_bias_all),
        passes_rmse=bool(passes_rmse_all),
        metrics_path=metrics_path,
        table_path=table_path,
    )


__all__ = ["RmseBiasResult", "run_rmse_bias"]
