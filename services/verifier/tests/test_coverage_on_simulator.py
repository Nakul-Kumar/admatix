"""Acceptance test 9 — coverage on the simulator (Phase 3 gate contribution).

Iterates over 20 distinct seeds, materialises a `clean_ab` world per seed at
`n_users=2000`, `true_lift=0.04`, `noise_sd=0.0`, calls the full `/verify`
pipeline, and records (a) whether each 95% CI contains the recorded
`metadata.ground_truth.ate`, and (b) whether the verdict is `lift_detected`.

Pass: ≥ 0.85 coverage AND ≥ 0.85 lift_detected rate.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from admatix_simulator import SimulationConfig, generate_world

from admatix_verifier.app import app
from admatix_verifier.models import H0PacketSubset, VerifyRequest


client = TestClient(app)

SEEDS = list(range(101, 121))  # 20 distinct seeds


def _verify_world(world):
    req = VerifyRequest(
        packet=H0PacketSubset(
            packet_id=f"pkt_{world.world_id}",
            tenant_id="tenant_test",
            account_ref="fixture:coverage",
            goal="coverage_gate",
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
    assert response.status_code == 200, response.text
    return response.json()


def test_ci_coverage_and_lift_detected_rate(tmp_path):
    covered = 0
    detected = 0
    misses: list[dict] = []
    for seed in SEEDS:
        config = SimulationConfig(
            world_type="clean_ab",
            baseline_cr=0.05,
            true_lift=0.04,
            n_users=2000,
            noise_sd=0.0,
            seasonality=0.0,
            n_periods=30,
            n_geos=20,
            seed=seed,
        )
        world = generate_world(config, tmp_path / f"seed_{seed}")
        body = _verify_world(world)
        truth = world.ground_truth["ate"]
        if body["ci_low"] is not None and body["ci_high"] is not None and body["ci_low"] <= truth <= body["ci_high"]:
            covered += 1
        else:
            misses.append({"seed": seed, "truth": truth, "ci_low": body["ci_low"], "ci_high": body["ci_high"], "method": body["method"]})
        if body["verdict"] == "lift_detected":
            detected += 1

    coverage = covered / len(SEEDS)
    detection = detected / len(SEEDS)
    assert coverage >= 0.85, (
        f"CI coverage {coverage:.2f} below Phase 3 floor 0.85; misses={misses[:3]}"
    )
    assert detection >= 0.85, f"lift_detected rate {detection:.2f} below 0.85"
