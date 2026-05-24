"""Helpers for enumerating (world_grid × seeds) and turning a SimulatedWorld
into a VerifyRequest the verifier methods accept.

Kept deterministic: cells iterate in the order the caller declared them,
and serialise to JSON with sorted keys + rounded floats so the
`runs.jsonl` byte-compare in `test_determinism.py` holds.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Any, Iterator

from admatix_simulator import SimulationConfig, SimulatedWorld, generate_world
from admatix_verifier.models import H0PacketSubset, VerifyRequest


_ROUND_DIGITS = 10
_SIMULATION_CONFIG_FIELDS = {field.name for field in fields(SimulationConfig)}


def cell_hash(cell: dict[str, Any]) -> str:
    """A stable hash over a single world_grid cell.

    Used as `config_hash` on `WorldRun`. Same kwargs → same hash regardless
    of declaration order.
    """
    payload = json.dumps(dict(sorted(cell.items())), sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:16]


@dataclass(frozen=True)
class GridCell:
    cell_kwargs: dict[str, Any]
    seed: int

    @property
    def config_hash(self) -> str:
        return cell_hash(self.cell_kwargs)


def enumerate_cells(world_grid: list[dict[str, Any]], seeds: list[int]) -> Iterator[GridCell]:
    """Yield one GridCell per (cell, seed) — full enumeration, no RNG behind it."""
    for cell in world_grid:
        for seed in seeds:
            yield GridCell(cell_kwargs=dict(cell), seed=int(seed))


def materialise(cell: GridCell, sim_root: Path) -> SimulatedWorld:
    """Materialise a world via services.simulator.generate_world."""
    kwargs = {key: value for key, value in cell.cell_kwargs.items() if key in _SIMULATION_CONFIG_FIELDS}
    kwargs["seed"] = cell.seed
    config = SimulationConfig(**kwargs)
    return generate_world(config, Path(sim_root))


def validation_role_for(cell_kwargs: dict[str, Any]) -> str:
    """Return whether a cell is part of the strict gate or robustness report."""
    return str(cell_kwargs.get("validation_role", "core"))


def target_ground_truth_ate(world: SimulatedWorld) -> float:
    """Return the verifier-facing estimand for a simulated world.

    Most worlds validate against population ATE. Geo pre/post holdouts validate
    against the post-period action estimand recorded by the simulator so the
    harness does not compare a post-action DiD estimate to a diluted whole-panel
    average.
    """
    truth = world.ground_truth
    return float(truth.get("verification_target_ate", truth.get("ate", 0.0)))


def build_verify_request(
    world: SimulatedWorld,
    *,
    hint_design: str | None = None,
    plausible_lift: float | None = None,
    extra_hint: dict[str, Any] | None = None,
    guardrails: dict[str, Any] | None = None,
) -> VerifyRequest:
    """Wrap a SimulatedWorld in the VerifyRequest the verifier methods expect."""
    hint: dict[str, Any] = {}
    if hint_design is not None:
        hint["design"] = hint_design
    if plausible_lift is not None:
        hint["plausible_lift"] = float(plausible_lift)
    if extra_hint:
        hint.update(extra_hint)

    data_path = _verifier_path(world.data_path)
    metadata_path = _verifier_path(world.metadata_path)
    packet = H0PacketSubset(
        packet_id=f"pkt_{world.world_id}",
        tenant_id="tenant_validation",
        account_ref=f"sim:{world.world_id}",
        goal="recover_ground_truth_ate",
        hypothesis=f"validation harness world {world.world_id}",
        causal_status="experimental",
        guardrails=guardrails or {},
        evidence_refs=[f"sim:{world.world_id}"],
    )
    return VerifyRequest(
        packet=packet,
        data_uri=data_path,
        metadata_uri=metadata_path,
        action_log_uri=None,
        hint=hint or None,
    )


def _verifier_path(path: Path) -> str:
    """Return an absolute path string accepted by admatix_verifier.loaders.

    On Windows, `Path.as_uri()` can percent-encode the long-path prefix as
    `%3F`; the verifier's loader intentionally only supports normal file URIs
    and absolute paths. Passing a normalized absolute path avoids that URI edge
    case while staying inside the verifier contract.
    """
    text = str(Path(path).resolve())
    if text.startswith("\\\\?\\"):
        return text[4:]
    return text


def run_production_verifier(req: VerifyRequest, verifier_method: str = "auto"):
    """Call the production verifier entry point in-process.

    The validation harness is allowed to avoid HTTP, but it must not duplicate
    verifier selection or method dispatch. Calling the FastAPI endpoint
    function exercises the same production load/select/guardrail/dispatch code
    that serves POST /verify.
    """
    if verifier_method != "auto":
        raise ValueError(
            "verifier_method overrides bypass the production verifier selector; "
            "use verifier_method='auto' for honest validation"
        )
    from admatix_verifier import app as verifier_app

    return verifier_app.verify(req)


def design_hint_for(world_type: str) -> str | None:
    """The selector hint per SIMULATION-VERIFICATION §2.6 for each world type.

    The simulator's `geo_structured` world has treatment varying *only* by
    geo with ≥ 10 geos, so the selector will already pick
    `geo_synthetic_control` without a hint. We still pass `geo_holdout` so
    the response carries the intent for downstream logs.
    """
    if world_type == "geo_structured":
        return "geo_holdout"
    return None


def round_float(value: float | None, digits: int = _ROUND_DIGITS) -> float | None:
    """Round a float to a fixed precision for byte-stable JSON output.

    Returns None for None, and 0.0 for NaN/Inf so JSON serialisation
    doesn't choke on a non-finite value.
    """
    if value is None:
        return None
    if not math.isfinite(float(value)):
        return None
    return round(float(value), digits)


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    """Write a list of dicts as JSONL with sorted keys and a deterministic separator."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, sort_keys=True, indent=2)
        handle.write("\n")


def write_progress(
    path: Path,
    *,
    stage: str,
    completed: int,
    total: int,
    status: str = "running",
    latest: dict[str, Any] | None = None,
) -> None:
    payload: dict[str, Any] = {
        "stage": stage,
        "completed": int(completed),
        "total": int(total),
        "status": status,
    }
    if latest:
        payload["latest"] = dict(latest)
    write_json(path, payload)


__all__ = [
    "GridCell",
    "build_verify_request",
    "cell_hash",
    "design_hint_for",
    "enumerate_cells",
    "materialise",
    "round_float",
    "run_production_verifier",
    "target_ground_truth_ate",
    "validation_role_for",
    "write_json",
    "write_jsonl",
    "write_progress",
]
