"""Acceptance test 1 — API contract via TestClient."""

from __future__ import annotations

import math

from fastapi.testclient import TestClient

from admatix_verifier.app import app
from admatix_verifier.models import VerifyResponse


client = TestClient(app)


_REQUIRED_REQ_LIBS = {
    "fastapi",
    "uvicorn",
    "pydantic",
    "numpy",
    "pandas",
    "scipy",
    "statsmodels",
    "econml",
    "causalml",
    "pytest",
    "httpx",
}


def test_healthz_returns_status_version_and_libs():
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["version"], str) and body["version"]
    assert isinstance(body["libs"], dict)
    libs = body["libs"]
    assert _REQUIRED_REQ_LIBS.issubset(libs.keys())
    for name, ver in libs.items():
        assert isinstance(ver, str) and ver, f"empty version for {name}"


def test_verify_returns_exact_response_field_shape(clean_ab_world):
    payload = clean_ab_world.request.model_dump(by_alias=True)
    response = client.post("/verify", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    expected_fields = set(VerifyResponse.model_fields.keys())
    assert set(body.keys()) == expected_fields
    canonical = {
        "estimate",
        "ci_low",
        "ci_high",
        "method",
        "causal_status",
        "verdict",
        "confounders",
    }
    assert canonical.issubset(body.keys())
    assert body["packet_id"] == clean_ab_world.request.packet.packet_id
    assert body["tx_id"] == clean_ab_world.request.packet.packet_id
    assert isinstance(body["confounders"], list)
    assert body["method"] in {
        "guardrail_only",
        "bsts_synthetic_control",
        "cate_meta_learner",
        "geo_synthetic_control",
        "ope_ips_snips_dr",
    }


def test_verify_handles_unknown_hint_design(clean_ab_world):
    payload = clean_ab_world.request.model_dump(by_alias=True)
    payload["hint"] = {"design": "totally_unknown_design"}
    response = client.post("/verify", json=payload)
    assert response.status_code == 200
    assert response.json()["method"] in {
        "guardrail_only",
        "bsts_synthetic_control",
        "cate_meta_learner",
        "geo_synthetic_control",
        "ope_ips_snips_dr",
    }


def test_verify_rejects_malformed_payload():
    response = client.post("/verify", json={"packet": "not_a_packet"})
    assert response.status_code == 422


def test_simulate_round_trips_ground_truth():
    response = client.post(
        "/simulate",
        json={
            "world_type": "clean_ab",
            "params": {
                "baseline_cr": 0.03,
                "true_lift": 0.05,
                "n_users": 1500,
                "noise_sd": 0.0,
                "seasonality": 0.0,
                "n_periods": 20,
                "n_geos": 10,
            },
            "seed": 23,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["world_type"] == "clean_ab"
    assert body["n_rows"] == 1500
    assert body["data_uri"].startswith("file://")
    assert body["metadata_uri"].startswith("file://")
    truth = body["ground_truth"]["ate"]
    # Sanity tolerance from §1.5 noise * sqrt(n) bound (noise_sd=0 → ate==true_lift).
    tol = 1.5 * (0.0 / math.sqrt(1500)) + 0.01
    assert abs(truth - 0.05) <= tol
