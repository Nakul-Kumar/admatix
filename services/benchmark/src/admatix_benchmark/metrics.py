"""Scorecard aggregation.

Takes a list of `RunResult` and produces the per-arm and head-to-head
summaries documented in `RESULTS-SCHEMA.md`.
"""

from __future__ import annotations

import math
import statistics
from typing import Any

from .runner import RunResult


_METRICS_TO_AGGREGATE = (
    "total_spend",
    "true_iroas",
    "reported_roas",
    "net_incremental_value",
    "wasted_spend",
    "true_lift_captured",
    "false_scale_ups_prevented",
)


def _row_for_run(run: RunResult) -> dict[str, Any]:
    f = run.final_scores
    c = run.counts
    return {
        "run_id": run.run_id,
        "arm": run.config.arm,
        "world_type": run.config.world_type,
        "seed": run.config.seed,
        "buyer_kind": run.config.buyer_kind,
        "row_kind": run.row_kind,
        "row_status": run.row_status,
        "skill_tier": run.config.skill_tier,
        "total_spend": f["total_spend"],
        "reported_revenue": f["reported_revenue"],
        "reported_roas": f["reported_roas"],
        "true_incremental_revenue": f["true_incremental_revenue"],
        "true_iroas": f["true_iroas"],
        "net_incremental_value": f["net_incremental_value"],
        "wasted_spend": f["wasted_spend"],
        "true_lift_captured": f["true_lift_captured"],
        "scale_up_proposals": c["scale_up_proposals"],
        "scale_ups_applied": c["scale_ups_applied"],
        "scale_ups_blocked_by_gate": c["scale_ups_blocked_by_gate"],
        "false_scale_ups_prevented": c["false_scale_ups_prevented"],
        "true_scale_ups_prevented": c["true_scale_ups_prevented"],
        "pause_proposals": c["pause_proposals"],
        "pauses_applied": c["pauses_applied"],
        "decisions_count": c["decisions"],
    }


def _mean_sd(values: list[float]) -> dict[str, float | int | None]:
    n = len(values)
    if n == 0:
        return {"mean": None, "sd": None, "n": 0}
    mean = sum(values) / n
    sd = statistics.stdev(values) if n >= 2 else 0.0
    return {
        "mean": round(mean, 6),
        "sd": round(sd, 6),
        "n": n,
    }


def aggregate_by_arm(rows: list[dict[str, Any]], arm: str) -> dict[str, Any]:
    arm_rows = [r for r in rows if r["arm"] == arm]
    out: dict[str, Any] = {}
    for metric in _METRICS_TO_AGGREGATE:
        out[metric] = _mean_sd([float(r[metric]) for r in arm_rows])
    out["n_runs"] = len(arm_rows)
    return out


def head_to_head(rows: list[dict[str, Any]], left: str, right: str) -> dict[str, Any]:
    """Compare arm `left` vs arm `right`. Pairing key is (world_type, seed,
    buyer_kind, skill_tier) — guaranteed identical between A↔B and C↔D under
    the runner's contract.
    """
    def key(r: dict[str, Any]) -> tuple:
        return (r["world_type"], r["seed"], r["buyer_kind"], r["skill_tier"])

    left_map = {key(r): r for r in rows if r["arm"] == left}
    right_map = {key(r): r for r in rows if r["arm"] == right}
    paired_keys = sorted(left_map.keys() & right_map.keys())
    if not paired_keys:
        return {
            "delta_net_incremental_value_mean": None,
            "delta_wasted_spend_mean": None,
            "delta_true_iroas_mean": None,
            "win_rate_over_worlds": None,
            "n_paired": 0,
        }

    dnet = []
    dwaste = []
    diroas = []
    wins = 0
    for k in paired_keys:
        l = left_map[k]
        r = right_map[k]
        dnet.append(l["net_incremental_value"] - r["net_incremental_value"])
        dwaste.append(l["wasted_spend"] - r["wasted_spend"])
        diroas.append(l["true_iroas"] - r["true_iroas"])
        if l["net_incremental_value"] > r["net_incremental_value"]:
            wins += 1
    return {
        "n_paired": len(paired_keys),
        "delta_net_incremental_value_mean": round(sum(dnet) / len(dnet), 6),
        "delta_net_incremental_value_sd": round(
            statistics.stdev(dnet) if len(dnet) >= 2 else 0.0, 6
        ),
        "delta_wasted_spend_mean": round(sum(dwaste) / len(dwaste), 6),
        "delta_true_iroas_mean": round(sum(diroas) / len(diroas), 6),
        "win_rate_over_worlds": round(wins / len(paired_keys), 6),
    }


def per_world_breakdown(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by: dict[str, dict[str, Any]] = {}
    for r in rows:
        bucket = by.setdefault(r["world_type"], {})
        arm_bucket = bucket.setdefault(r["arm"], {
            "n": 0,
            "total_spend": 0.0,
            "true_iroas_sum": 0.0,
            "net_incremental_value_sum": 0.0,
            "wasted_spend_sum": 0.0,
            "false_scale_ups_prevented_sum": 0,
        })
        arm_bucket["n"] += 1
        arm_bucket["total_spend"] += r["total_spend"]
        arm_bucket["true_iroas_sum"] += r["true_iroas"]
        arm_bucket["net_incremental_value_sum"] += r["net_incremental_value"]
        arm_bucket["wasted_spend_sum"] += r["wasted_spend"]
        arm_bucket["false_scale_ups_prevented_sum"] += r["false_scale_ups_prevented"]
    out: dict[str, Any] = {}
    for world, arms in by.items():
        out[world] = {}
        for arm, bucket in arms.items():
            n = max(1, bucket["n"])
            out[world][arm] = {
                "n_runs": bucket["n"],
                "mean_total_spend": round(bucket["total_spend"] / n, 4),
                "mean_true_iroas": round(bucket["true_iroas_sum"] / n, 6),
                "mean_net_incremental_value": round(
                    bucket["net_incremental_value_sum"] / n, 4
                ),
                "mean_wasted_spend": round(bucket["wasted_spend_sum"] / n, 4),
                "mean_false_scale_ups_prevented": round(
                    bucket["false_scale_ups_prevented_sum"] / n, 4
                ),
            }
    return out


def llm_lane_accounting(rows: list[dict[str, Any]]) -> dict[str, int]:
    """Count rows by provenance so fallback/skipped rows cannot masquerade as LLM."""

    counts = {
        "policy_rows": 0,
        "real_llm_rows": 0,
        "deterministic_fallback_rows": 0,
        "failed_llm_rows": 0,
        "skipped_llm_rows": 0,
    }
    for row in rows:
        row_kind = row.get("row_kind", "llm_real" if row.get("buyer_kind") == "llm" else "policy")
        if row_kind == "llm_real":
            counts["real_llm_rows"] += 1
        elif row_kind == "llm_fallback":
            counts["deterministic_fallback_rows"] += 1
        elif row_kind == "llm_failed":
            counts["failed_llm_rows"] += 1
        elif row_kind == "llm_skipped":
            counts["skipped_llm_rows"] += 1
        else:
            counts["policy_rows"] += 1
    return counts


def proof_readiness(accounting: dict[str, int]) -> dict[str, Any]:
    """Hard gate for Phase 5 proof claims."""

    blocking_reasons: list[str] = []
    if accounting["real_llm_rows"] <= 0:
        blocking_reasons.append("requires_nonzero_real_llm_rows")
    if accounting["failed_llm_rows"] > 0:
        blocking_reasons.append("llm_rows_failed")
    status = "READY" if not blocking_reasons else "BLOCKED"
    return {
        "status": status,
        "blocking_reasons": blocking_reasons,
        "required_for_phase_5_proof_claims": ["nonzero_real_llm_rows"],
        "claim_limit": "calibrated simulator/public RCT proof only; no live spend lift claim",
    }


def build_scorecard(
    runs: list[RunResult],
    *,
    config_summary: dict[str, Any],
    run_id: str,
    generated_at: str,
) -> dict[str, Any]:
    rows = [_row_for_run(r) for r in runs]
    by_arm = {arm: aggregate_by_arm(rows, arm) for arm in ("A", "B", "C", "D")}
    accounting = llm_lane_accounting(rows)
    return {
        "schema_version": "1.0.0",
        "run_id": run_id,
        "generated_at": generated_at,
        "config": config_summary,
        "by_run": rows,
        "by_arm": by_arm,
        "per_world": per_world_breakdown(rows),
        "llm_lane_accounting": accounting,
        "proof_readiness": proof_readiness(accounting),
        "claim_limits": [
            "This benchmark is calibrated simulator/public RCT proof only.",
            "It does not claim live spend lift.",
            "Fallback rows are deterministic-policy rows, not real LLM rows.",
        ],
        "head_to_head": {
            "B_vs_A": head_to_head(rows, "B", "A"),
            "D_vs_C": head_to_head(rows, "D", "C"),
        },
    }


__all__ = [
    "build_scorecard",
    "aggregate_by_arm",
    "head_to_head",
    "llm_lane_accounting",
    "per_world_breakdown",
    "proof_readiness",
]
