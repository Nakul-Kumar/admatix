from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from ._paths import add_sibling_sources

add_sibling_sources()

from admatix_simulator import SimulationConfig, WorldType, generate_world
from admatix_verifier.models import H0PacketSubset, VerifyRequest

from .types import UpliftConfig


def iter_world_configs(config: UpliftConfig, defaults: dict[str, Any]) -> Iterable[SimulationConfig]:
    grid = config.world_grid or [defaults]
    for seed in config.seeds:
        for cell in grid:
            payload = dict(defaults)
            payload.update(cell)
            payload["seed"] = seed
            if "world_type" not in payload:
                payload["world_type"] = defaults["world_type"]
            yield SimulationConfig(**payload)


def materialize_world(sim_config: SimulationConfig, output_dir: Path):
    return generate_world(sim_config, output_dir)


def verify_request_for_world(world, *, design: str = "auto", plausible_lift: float = 0.0) -> VerifyRequest:
    world_type = world.world_type.value if isinstance(world.world_type, WorldType) else str(world.world_type)
    packet = H0PacketSubset(
        packet_id=f"pkt_{world.world_id}",
        tenant_id="tenant_uplift",
        account_ref=f"fixture:{world_type}",
        goal="phase4_uplift_validation",
        hypothesis=f"{world_type} plausible_lift={plausible_lift}",
        causal_status="experimental",
        guardrails={"budget_cap": 1_000_000.0, "freq_cap": 10},
        evidence_refs=[f"metric:sim:{world.world_id}"],
    )
    return VerifyRequest(
        packet=packet,
        data_uri=world.data_uri,
        metadata_uri=world.metadata_path.resolve().as_uri(),
        action_log_uri=None,
        hint={"design": design, "plausible_lift": plausible_lift},
    )
