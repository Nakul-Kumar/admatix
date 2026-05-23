"""Sample the verifier on the new robustness worlds.

Generates a small sample (4 seeds per world type) for every new world type
added in wp/robustness-worlds, calls the existing FastAPI `/verify`
endpoint via TestClient, and prints per-world (true_ate, estimate, ci,
covered, |error|, verdict) plus a per-world-type summary.

The output is data, NOT a pass/fail gate. The whole point of these worlds
is to be HARD for the verifier. Recorded numbers feed
`docs/phase-reports/robustness-worlds.md`.
"""

from __future__ import annotations

import json
import math
import statistics
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "services" / "verifier" / "src"))
sys.path.insert(0, str(ROOT / "services" / "simulator" / "src"))

from fastapi.testclient import TestClient  # noqa: E402

from admatix_simulator import SimulationConfig, WorldType, generate_world  # noqa: E402
from admatix_verifier.app import app  # noqa: E402
from admatix_verifier.models import H0PacketSubset, VerifyRequest  # noqa: E402


client = TestClient(app)


def _verify_world(world):
    req = VerifyRequest(
        packet=H0PacketSubset(
            packet_id=f"pkt_{world.world_id}",
            tenant_id="tenant_test",
            account_ref="fixture:robustness",
            goal="robustness_sample",
            hypothesis="recover_true_lift",
            causal_status="experimental",
            guardrails={},
            evidence_refs=[],
        ),
        data_uri=world.data_uri,
        metadata_uri=world.metadata_path.resolve().as_uri(),
        action_log_uri=None,
        hint=None,
    )
    response = client.post("/verify", json=req.model_dump(by_alias=True))
    if response.status_code != 200:
        return None, response.text
    return response.json(), None


SEEDS = [101, 102, 103, 104]


def _scenarios() -> list[tuple[str, dict]]:
    """Return (label, kwargs) pairs. kwargs are passed verbatim to
    SimulationConfig — seed is set per-iteration."""

    base = dict(n_users=3000, n_periods=30, n_geos=20)
    return [
        (
            "non_stationary_moderate",
            {
                **base,
                "world_type": WorldType.NON_STATIONARY,
                "true_lift": 0.04,
                "effect_decay_rate": 0.05,
                "learning_phase_periods": 5,
                "learning_phase_noise_multiplier": 2.0,
                "learning_phase_drift": 0.4,
            },
        ),
        (
            "non_stationary_steep_decay",
            {
                **base,
                "world_type": WorldType.NON_STATIONARY,
                "true_lift": 0.05,
                "effect_decay_rate": 0.15,
                "learning_phase_periods": 8,
                "learning_phase_noise_multiplier": 3.0,
                "learning_phase_drift": 0.6,
            },
        ),
        (
            "cross_campaign_mild_interference",
            {
                **base,
                "world_type": WorldType.CROSS_CAMPAIGN_INTERFERENCE,
                "true_lift": 0.04,
                "n_campaigns": 3,
                "interference_strength": 0.3,
            },
        ),
        (
            "cross_campaign_heavy_interference",
            {
                **base,
                "world_type": WorldType.CROSS_CAMPAIGN_INTERFERENCE,
                "true_lift": 0.05,
                "n_campaigns": 4,
                "interference_strength": 0.7,
            },
        ),
        (
            "adversarial_heavy_tail_only",
            {
                **base,
                "world_type": WorldType.ADVERSARIAL_MISSPECIFIED,
                "true_lift": 0.04,
                "confound_strength": 0.0,
                "noise_dist": "student_t",
                "noise_df": 3,
            },
        ),
        (
            "adversarial_hidden_confounder",
            {
                **base,
                "world_type": WorldType.ADVERSARIAL_MISSPECIFIED,
                "true_lift": 0.04,
                "confound_strength": 0.5,
                "hidden_confounder_strength": 1.2,
            },
        ),
        (
            "adversarial_full_stack",
            {
                **base,
                "world_type": WorldType.ADVERSARIAL_MISSPECIFIED,
                "true_lift": 0.04,
                "confound_strength": 0.7,
                "noise_dist": "student_t",
                "noise_df": 4,
                "time_varying_confound_amplitude": 0.4,
                "hidden_confounder_strength": 0.8,
                "spillover_strength": 0.3,
            },
        ),
        (
            "adversarial_zero_lift_placebo",
            {
                **base,
                "world_type": WorldType.ADVERSARIAL_MISSPECIFIED,
                "true_lift": 0.0,
                "confound_strength": 0.7,
                "noise_dist": "student_t",
                "noise_df": 4,
                "hidden_confounder_strength": 0.8,
                "spillover_strength": 0.3,
            },
        ),
    ]


def main() -> None:
    rows: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="robust_sample_") as tmp:
        tmp_path = Path(tmp)
        for label, kwargs in _scenarios():
            for seed in SEEDS:
                config = SimulationConfig(seed=seed, **kwargs)
                world = generate_world(config, tmp_path / f"{label}_seed{seed}")
                body, err = _verify_world(world)
                truth = world.ground_truth["ate"]
                if err is not None or body is None:
                    rows.append({
                        "label": label, "seed": seed, "truth": truth,
                        "error": err, "estimate": None, "ci_low": None,
                        "ci_high": None, "verdict": "ERROR", "method": "ERROR",
                    })
                    continue
                est = body["estimate"]
                ci_low = body["ci_low"]
                ci_high = body["ci_high"]
                covered = (
                    ci_low is not None and ci_high is not None
                    and ci_low <= truth <= ci_high
                )
                abs_err = abs(est - truth) if est is not None else None
                rows.append({
                    "label": label, "seed": seed, "truth": truth,
                    "estimate": est, "ci_low": ci_low, "ci_high": ci_high,
                    "covered": covered, "abs_err": abs_err,
                    "verdict": body["verdict"], "method": body["method"],
                })

    # Per-label aggregate
    by_label: dict[str, list[dict]] = {}
    for row in rows:
        by_label.setdefault(row["label"], []).append(row)

    print()
    print("=" * 100)
    print(f"{'world':40s} {'truth':>8s} {'mean_est':>10s} {'bias':>10s} {'rmse':>10s} {'cover':>7s} {'detect':>7s}")
    print("=" * 100)
    summary: list[dict] = []
    for label, label_rows in by_label.items():
        valid = [r for r in label_rows if r["estimate"] is not None]
        if not valid:
            continue
        truth = valid[0]["truth"]
        ests = [r["estimate"] for r in valid]
        errs = [r["estimate"] - r["truth"] for r in valid]
        rmse = math.sqrt(statistics.fmean([e * e for e in errs]))
        bias = statistics.fmean(errs)
        covered = sum(1 for r in valid if r["covered"]) / len(valid)
        detected = sum(1 for r in valid if r["verdict"] == "lift_detected") / len(valid)
        mean_est = statistics.fmean(ests)
        print(f"{label:40s} {truth:>8.4f} {mean_est:>10.4f} {bias:>+10.4f} {rmse:>10.4f} {covered:>7.2f} {detected:>7.2f}")
        summary.append({
            "label": label, "truth": truth, "mean_est": mean_est,
            "bias": bias, "rmse": rmse, "coverage": covered,
            "lift_detected_rate": detected, "n_seeds": len(valid),
        })
    print("=" * 100)
    out = ROOT / "data" / ".cache" / "robustness-worlds-verifier-sample.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"rows": rows, "summary": summary}, indent=2, default=str) + "\n", encoding="utf-8")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
