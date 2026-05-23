"""FastAPI application for the AdMatix verifier."""

from __future__ import annotations

import importlib
import os
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException

from . import __version__
from .loaders import load_events, load_metadata
from .methods import bsts, cate, geo, guardrail, ope
from .models import (
    GuardrailProof,
    HealthResponse,
    MethodResult,
    SimulateRequest,
    SimulateResponse,
    VerifyRequest,
    VerifyResponse,
)
from .select import selection_with_reasons


app = FastAPI(title="admatix-verifier", version=__version__)


_TRACKED_LIBS = [
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
]


def _lib_version(name: str) -> str:
    try:
        return version(name)
    except PackageNotFoundError:
        try:
            module = importlib.import_module(name)
            return str(getattr(module, "__version__", "unknown"))
        except Exception:
            return "unknown"


@app.get("/healthz", response_model=HealthResponse)
def healthz() -> HealthResponse:
    libs = {name: _lib_version(name) for name in _TRACKED_LIBS}
    return HealthResponse(status="ok", version=__version__, libs=libs)


def _dispatch_method(method: str, req: VerifyRequest, events: Any) -> MethodResult:
    if method == "ope_ips_snips_dr":
        return ope.run(req, events)
    if method == "geo_synthetic_control":
        return geo.run(req, events)
    if method == "cate_meta_learner":
        return cate.run(req, events)
    if method == "bsts_synthetic_control":
        return bsts.run(req, events)
    return MethodResult(
        method="guardrail_only",
        estimate=None,
        ci_low=None,
        ci_high=None,
        verdict="inconclusive",
        causal_status="inconclusive",
        confounders=[],
        diagnostics={"reason": "no_quantitative_method_available"},
    )


@app.post("/verify", response_model=VerifyResponse)
def verify(req: VerifyRequest) -> VerifyResponse:
    try:
        events = load_events(req.data_uri)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    metadata = None
    if req.metadata_uri:
        try:
            metadata = load_metadata(req.metadata_uri)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    guardrail_proof: GuardrailProof = guardrail.run(req)
    selection = selection_with_reasons(req, events)

    method_result = _dispatch_method(selection.method, req, events)

    diagnostics: dict[str, Any] = dict(method_result.diagnostics)
    if metadata is not None and "ground_truth" in metadata:
        diagnostics["ground_truth_hint"] = metadata["ground_truth"]

    return VerifyResponse(
        estimate=method_result.estimate,
        ci_low=method_result.ci_low,
        ci_high=method_result.ci_high,
        method=method_result.method,
        causal_status=method_result.causal_status,
        verdict=method_result.verdict,
        confounders=method_result.confounders,
        ci_level=method_result.ci_level,
        guardrail_proof=guardrail_proof,
        diagnostics=diagnostics,
        rejected_methods=selection.rejected,
        packet_id=req.packet.packet_id,
        tx_id=req.packet.packet_id,
    )


def _resolve_sim_output_dir() -> Path:
    candidates = [
        os.environ.get("ADMATIX_SIM_DIR"),
        "data/sim",
        "../../data/sim",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate)
        if path.parent.exists() or path.exists():
            path.mkdir(parents=True, exist_ok=True)
            return path.resolve()
    fallback = Path.cwd() / "data" / "sim"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback.resolve()


@app.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest) -> SimulateResponse:
    try:
        from admatix_simulator import SimulationConfig, generate_world  # type: ignore
    except ImportError as exc:  # pragma: no cover - environment misconfig
        raise HTTPException(
            status_code=503,
            detail=(
                "admatix_simulator is not importable from this environment. "
                "Install services/simulator or run the verifier with services/simulator/src on PYTHONPATH. "
                f"underlying error: {exc}"
            ),
        )

    params = dict(req.params)
    params["world_type"] = req.world_type
    params["seed"] = req.seed
    try:
        config = SimulationConfig(**params)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"invalid SimulationConfig: {exc}")

    output_dir = _resolve_sim_output_dir()
    world = generate_world(config, output_dir)
    metadata_path = world.metadata_path.resolve()
    return SimulateResponse(
        world_id=world.world_id,
        world_type=world.world_type.value if hasattr(world.world_type, "value") else str(world.world_type),
        n_rows=world.n_rows,
        data_uri=world.data_uri,
        metadata_uri=metadata_path.as_uri(),
        ground_truth=world.ground_truth,
    )


__all__ = ["app"]
