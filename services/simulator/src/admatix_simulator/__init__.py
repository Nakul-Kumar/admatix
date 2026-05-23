from __future__ import annotations

import csv
import hashlib
import json
import math
import random
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any


class WorldType(str, Enum):
    CLEAN_AB = "clean_ab"
    GEO_STRUCTURED = "geo_structured"
    CONFOUNDED = "confounded"
    ZERO_LIFT_PLACEBO = "zero_lift_placebo"


@dataclass(frozen=True)
class SimulationConfig:
    world_type: WorldType | str
    baseline_cr: float = 0.03
    true_lift: float = 0.005
    budget: int = 50_000
    n_users: int = 200_000
    noise_sd: float = 0.4
    seasonality: float = 0.1
    confound_strength: float = 0.0
    treat_frac: float = 0.5
    n_periods: int = 90
    n_geos: int = 100
    seed: int = 17

    def __post_init__(self) -> None:
        world_type = self.world_type if isinstance(self.world_type, WorldType) else WorldType(str(self.world_type))
        object.__setattr__(self, "world_type", world_type)
        if self.n_users <= 0:
            raise ValueError("n_users must be positive")
        if not 0 < self.treat_frac < 1:
            raise ValueError("treat_frac must be between 0 and 1")
        if not 0 < self.baseline_cr < 1:
            raise ValueError("baseline_cr must be between 0 and 1")
        if self.n_periods <= 0:
            raise ValueError("n_periods must be positive")
        if self.n_geos <= 0:
            raise ValueError("n_geos must be positive")


@dataclass(frozen=True)
class SimulatedWorld:
    world_id: str
    world_type: WorldType
    n_rows: int
    data_path: Path
    metadata_path: Path
    data_uri: str
    output_hash: str
    ground_truth: dict[str, Any]


def _sigmoid(value: float) -> float:
    if value >= 0:
        z = math.exp(-value)
        return 1 / (1 + z)
    z = math.exp(value)
    return z / (1 + z)


def _logit(value: float) -> float:
    return math.log(value / (1 - value))


def _config_payload(config: SimulationConfig) -> dict[str, Any]:
    payload = asdict(config)
    payload["world_type"] = config.world_type.value
    return payload


def _config_hash(config: SimulationConfig) -> str:
    encoded = json.dumps(_config_payload(config), sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _covariates(config: SimulationConfig) -> list[dict[str, Any]]:
    rng = random.Random(config.seed)
    rows: list[dict[str, Any]] = []
    devices = ["desktop", "mobile", "tablet"]
    age_bands = ["18-24", "25-34", "35-44", "45-54", "55+"]
    for user_id in range(config.n_users):
        recency = rng.randint(0, 12)
        frequency = rng.randint(0, 20)
        prior_conversions = rng.randint(0, 5)
        device = devices[rng.randrange(len(devices))]
        age_band = age_bands[rng.randrange(len(age_bands))]
        period = user_id % config.n_periods
        geo_id = f"geo_{user_id % config.n_geos:03d}"
        intent = max(0.0, min(1.0, (12 - recency) / 12 * 0.55 + min(frequency, 20) / 20 * 0.3 + prior_conversions / 5 * 0.15))
        rows.append({
            "user_id": user_id,
            "recency": recency,
            "frequency": frequency,
            "prior_conversions": prior_conversions,
            "device": device,
            "age_band": age_band,
            "period": period,
            "geo_id": geo_id,
            "intent": intent,
        })
    return rows


def _assign_treatment(config: SimulationConfig, rows: list[dict[str, Any]]) -> None:
    rng = random.Random(config.seed + 10_003)
    if config.world_type == WorldType.GEO_STRUCTURED:
        geos = sorted({row["geo_id"] for row in rows})
        n_treated = max(1, min(len(geos) - 1, round(len(geos) * config.treat_frac)))
        treated_geos = set(rng.sample(geos, n_treated))
        for row in rows:
            row["treatment"] = 1 if row["geo_id"] in treated_geos else 0
        return

    if config.world_type == WorldType.CLEAN_AB:
        for row in rows:
            row["treatment"] = 1 if rng.random() < config.treat_frac else 0
        return

    logit_treat = _logit(config.treat_frac)
    strength = config.confound_strength if config.confound_strength else 1.0
    for row in rows:
        assignment_p = _sigmoid(logit_treat + strength * (row["intent"] - 0.5) * 3.0)
        row["treatment"] = 1 if rng.random() < assignment_p else 0


def _seasonality(config: SimulationConfig, period: int) -> float:
    weekly = math.sin((period % 7) / 7 * 2 * math.pi)
    slow = math.sin(period / max(config.n_periods, 1) * 2 * math.pi)
    return config.seasonality * (0.6 * weekly + 0.4 * slow)


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fieldnames = [
        "user_id",
        "period",
        "geo_id",
        "age_band",
        "device",
        "recency",
        "frequency",
        "prior_conversions",
        "baseline_propensity",
        "treatment",
        "outcome",
        "revenue",
        "tau",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({name: row[name] for name in fieldnames})


def generate_world(config: SimulationConfig, output_dir: Path) -> SimulatedWorld:
    config = config if isinstance(config.world_type, WorldType) else SimulationConfig(**_config_payload(config))
    rows = _covariates(config)
    _assign_treatment(config, rows)

    raw_modifiers = [0.8 + 0.4 * row["intent"] for row in rows]
    mean_modifier = sum(raw_modifiers) / len(raw_modifiers)
    effective_lift = 0.0 if config.world_type == WorldType.ZERO_LIFT_PLACEBO else config.true_lift
    rng = random.Random(config.seed + 30_007)
    confound_coeff = 0.0 if config.world_type == WorldType.CLEAN_AB else (config.confound_strength or 0.8)
    geo_rng = random.Random(config.seed + 40_009)
    geo_effects = {f"geo_{idx:03d}": geo_rng.gauss(0, 0.15) for idx in range(config.n_geos)}
    treated_taus: list[float] = []
    taus: list[float] = []

    for row, modifier in zip(rows, raw_modifiers):
        tau = effective_lift * modifier / mean_modifier if mean_modifier else effective_lift
        base_logit = _logit(config.baseline_cr)
        intent_term = 1.25 * (row["intent"] - 0.5)
        confound_term = confound_coeff * 0.35 * (row["intent"] - 0.5)
        geo_term = geo_effects[row["geo_id"]] if config.world_type == WorldType.GEO_STRUCTURED else 0.0
        noise = rng.gauss(0, config.noise_sd) if config.noise_sd else 0.0
        p0 = _sigmoid(base_logit + intent_term + confound_term + geo_term + _seasonality(config, row["period"]) + noise)
        p1 = max(0.0, min(1.0, p0 + row["treatment"] * tau))
        outcome = 1 if rng.random() < p1 else 0
        revenue = round(rng.lognormvariate(math.log(120), 0.35), 4) if outcome else 0.0
        row["baseline_propensity"] = f"{p0:.8f}"
        row["outcome"] = outcome
        row["revenue"] = f"{revenue:.4f}"
        row["tau"] = f"{tau:.10f}"
        taus.append(tau)
        if row["treatment"]:
            treated_taus.append(tau)

    config_hash = _config_hash(config)
    world_id = f"w_{config_hash[:12]}"
    output_dir = Path(output_dir)
    world_dir = output_dir / world_id
    data_path = world_dir / "events.csv"
    metadata_path = world_dir / "metadata.json"
    _write_csv(data_path, rows)
    output_hash = _sha256_file(data_path)
    seasonality_curve = [round(_seasonality(config, period), 8) for period in range(config.n_periods)]
    ground_truth: dict[str, Any] = {
        "ate": round(sum(taus) / len(taus), 10),
        "att": round(sum(treated_taus) / len(treated_taus), 10) if treated_taus else 0.0,
        "true_incremental_lift": effective_lift,
        "true_iroas": None,
        "seed": config.seed,
        "seasonality_curve": seasonality_curve,
        "confounder_coefficients": {
            "recency": confound_coeff,
            "frequency": round(confound_coeff * 0.6, 6),
            "prior_conversions": round(confound_coeff * 0.4, 6),
        },
        "geo_count": config.n_geos,
        "geo_random_effect_sd": 0.15 if config.world_type == WorldType.GEO_STRUCTURED else 0.0,
    }
    metadata = {
        "world_id": world_id,
        "config": _config_payload(config),
        "config_hash": config_hash,
        "n_rows": len(rows),
        "data_filename": data_path.name,
        "data_sha256": output_hash,
        "ground_truth": ground_truth,
    }
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return SimulatedWorld(
        world_id=world_id,
        world_type=config.world_type,
        n_rows=len(rows),
        data_path=data_path,
        metadata_path=metadata_path,
        data_uri=data_path.resolve().as_uri(),
        output_hash=output_hash,
        ground_truth=ground_truth,
    )


def naive_lift(data_path: Path) -> float:
    treated_outcomes: list[float] = []
    control_outcomes: list[float] = []
    with Path(data_path).open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            bucket = treated_outcomes if row["treatment"] == "1" else control_outcomes
            bucket.append(float(row["outcome"]))
    if not treated_outcomes or not control_outcomes:
        raise ValueError("naive_lift requires treated and control rows")
    return sum(treated_outcomes) / len(treated_outcomes) - sum(control_outcomes) / len(control_outcomes)


__all__ = ["SimulationConfig", "SimulatedWorld", "WorldType", "generate_world", "naive_lift"]
