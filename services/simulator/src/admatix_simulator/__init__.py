from __future__ import annotations

import csv
import hashlib
import json
import math
import random
from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path
from typing import Any


class WorldType(str, Enum):
    CLEAN_AB = "clean_ab"
    GEO_STRUCTURED = "geo_structured"
    CONFOUNDED = "confounded"
    ZERO_LIFT_PLACEBO = "zero_lift_placebo"


# RNG stream offsets — kept distinct so each layer of the data-generating
# process is independent. Same seed reproduces the same world.
SEED_OFFSET_COVARIATES = 0
SEED_OFFSET_TREATMENT = 10_003
SEED_OFFSET_OUTCOME = 30_007
SEED_OFFSET_GEO_EFFECT = 40_009
SEED_OFFSET_PANEL = 50_021

# Multiplier applied to the named confounder coefficients when building the
# treatment-assignment logit, so a moderate confound_strength still produces a
# visibly biased assignment. Recorded in the manifest so a verifier can use it.
ASSIGNMENT_BIAS_MULTIPLIER = 3.0
GEO_RANDOM_EFFECT_SD = 0.15


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
        world_type = (
            self.world_type
            if isinstance(self.world_type, WorldType)
            else WorldType(str(self.world_type))
        )
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
        if self.confound_strength < 0:
            raise ValueError("confound_strength must be >= 0")
        if world_type == WorldType.GEO_STRUCTURED and self.n_users < self.n_geos:
            raise ValueError(
                "geo_structured world requires n_users >= n_geos so every geo has at least one user"
            )


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


def _normalize_covariates(recency: int, frequency: int, prior_conversions: int) -> tuple[float, float, float]:
    """Map raw covariates onto [0, 1]. Each appears in the outcome model centered
    at 0.5, so the recorded coefficient is literally the slope on the centered
    z-variable.
    """
    recency_z = (12 - recency) / 12  # high = recent
    frequency_z = min(frequency, 20) / 20
    prior_z = min(prior_conversions, 5) / 5
    return recency_z, frequency_z, prior_z


def _confounder_coefficients(config: SimulationConfig) -> dict[str, float]:
    """The three named coefficients used identically in both the outcome model
    and (scaled by ASSIGNMENT_BIAS_MULTIPLIER) the treatment-assignment model.

    For clean A/B and geo-structured worlds these are 0 by construction —
    user-level confounding is not part of those worlds' generative stories.
    For confounded and zero-lift placebo worlds, the user's configured
    `confound_strength` is honored verbatim (no falsy fallback).
    """
    if config.world_type in (WorldType.CLEAN_AB, WorldType.GEO_STRUCTURED):
        return {"recency": 0.0, "frequency": 0.0, "prior_conversions": 0.0}
    c = float(config.confound_strength)
    return {
        "recency": c,
        "frequency": 0.6 * c,
        "prior_conversions": 0.4 * c,
    }


def _covariate_contribution(coefs: dict[str, float], recency_z: float, frequency_z: float, prior_z: float) -> float:
    return (
        coefs["recency"] * (recency_z - 0.5)
        + coefs["frequency"] * (frequency_z - 0.5)
        + coefs["prior_conversions"] * (prior_z - 0.5)
    )


def _covariates(config: SimulationConfig) -> list[dict[str, Any]]:
    rng = random.Random(config.seed + SEED_OFFSET_COVARIATES)
    panel_rng = random.Random(config.seed + SEED_OFFSET_PANEL)
    rows: list[dict[str, Any]] = []
    devices = ["desktop", "mobile", "tablet"]
    age_bands = ["18-24", "25-34", "35-44", "45-54", "55+"]
    is_geo_world = config.world_type == WorldType.GEO_STRUCTURED

    for user_id in range(config.n_users):
        recency = rng.randint(0, 12)
        frequency = rng.randint(0, 20)
        prior_conversions = rng.randint(0, 5)
        device = devices[rng.randrange(len(devices))]
        age_band = age_bands[rng.randrange(len(age_bands))]

        if is_geo_world:
            # Build a true geo×period panel. Round-robin geo assignment guarantees
            # every geo is populated; period is drawn so that within each geo the
            # observations span all periods evenly. Decoupled from user_id so the
            # geo-holdout / DiD verifier has a usable panel.
            geo_index = user_id % config.n_geos
            period_index = (user_id // config.n_geos) % config.n_periods
            # Shuffle within the within-geo period sequence so we don't get an
            # artificial ordering correlation between user_id and period.
            jitter = panel_rng.randrange(config.n_periods)
            period = (period_index + jitter) % config.n_periods
            geo_id = f"geo_{geo_index:03d}"
        else:
            geo_id = f"geo_{user_id % config.n_geos:03d}"
            period = user_id % config.n_periods

        recency_z, frequency_z, prior_z = _normalize_covariates(recency, frequency, prior_conversions)
        rows.append({
            "user_id": user_id,
            "recency": recency,
            "frequency": frequency,
            "prior_conversions": prior_conversions,
            "device": device,
            "age_band": age_band,
            "period": period,
            "geo_id": geo_id,
            "recency_z": recency_z,
            "frequency_z": frequency_z,
            "prior_z": prior_z,
        })
    return rows


def _assign_treatment(config: SimulationConfig, rows: list[dict[str, Any]], coefs: dict[str, float]) -> None:
    rng = random.Random(config.seed + SEED_OFFSET_TREATMENT)

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

    # Confounded and zero-lift placebo: the same named coefficients drive
    # assignment (scaled by ASSIGNMENT_BIAS_MULTIPLIER). If confound_strength is
    # 0 the coefficients are 0 and assignment is unbiased Bernoulli(treat_frac).
    logit_treat = _logit(config.treat_frac)
    for row in rows:
        contribution = _covariate_contribution(
            coefs, row["recency_z"], row["frequency_z"], row["prior_z"]
        )
        assignment_p = _sigmoid(logit_treat + ASSIGNMENT_BIAS_MULTIPLIER * contribution)
        row["treatment"] = 1 if rng.random() < assignment_p else 0


def _seasonality(config: SimulationConfig, period: int) -> float:
    weekly = math.sin((period % 7) / 7 * 2 * math.pi)
    slow = math.sin(period / max(config.n_periods, 1) * 2 * math.pi)
    return config.seasonality * (0.6 * weekly + 0.4 * slow)


_OUTPUT_FIELDS = [
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


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=_OUTPUT_FIELDS, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({name: row[name] for name in _OUTPUT_FIELDS})


def generate_world(config: SimulationConfig, output_dir: Path) -> SimulatedWorld:
    config = config if isinstance(config.world_type, WorldType) else SimulationConfig(**_config_payload(config))
    rows = _covariates(config)
    coefs = _confounder_coefficients(config)
    _assign_treatment(config, rows, coefs)

    # Heterogeneity modifier drives a per-user CATE around the population mean.
    # Normalized so mean(tau_i) == effective_lift exactly — recorded in the
    # outcome_model.notes so verifiers know ATE is the sample mean by construction.
    raw_modifiers = [0.8 + 0.4 * row["recency_z"] for row in rows]
    mean_modifier = sum(raw_modifiers) / len(raw_modifiers) if raw_modifiers else 1.0
    effective_lift = 0.0 if config.world_type == WorldType.ZERO_LIFT_PLACEBO else config.true_lift

    outcome_rng = random.Random(config.seed + SEED_OFFSET_OUTCOME)
    geo_rng = random.Random(config.seed + SEED_OFFSET_GEO_EFFECT)
    geo_effects = {
        f"geo_{idx:03d}": geo_rng.gauss(0, GEO_RANDOM_EFFECT_SD) for idx in range(config.n_geos)
    }

    base_logit = _logit(config.baseline_cr)
    treated_taus: list[float] = []
    taus: list[float] = []

    for row, modifier in zip(rows, raw_modifiers):
        tau = effective_lift * modifier / mean_modifier if mean_modifier else effective_lift
        confounder_term = _covariate_contribution(
            coefs, row["recency_z"], row["frequency_z"], row["prior_z"]
        )
        geo_term = (
            geo_effects[row["geo_id"]] if config.world_type == WorldType.GEO_STRUCTURED else 0.0
        )
        seasonality_term = _seasonality(config, row["period"])
        noise = outcome_rng.gauss(0, config.noise_sd) if config.noise_sd else 0.0
        p0 = _sigmoid(base_logit + confounder_term + geo_term + seasonality_term + noise)
        p1 = max(0.0, min(1.0, p0 + row["treatment"] * tau))
        outcome = 1 if outcome_rng.random() < p1 else 0
        # Draw revenue unconditionally so the RNG stream is independent of
        # outcome realizations (issue #16).
        revenue_draw = round(outcome_rng.lognormvariate(math.log(120), 0.35), 4)
        revenue = revenue_draw if outcome else 0.0
        row["baseline_propensity"] = f"{p0:.12f}"
        row["outcome"] = outcome
        row["revenue"] = f"{revenue:.4f}"
        row["tau"] = f"{tau:.10f}"
        taus.append(tau)
        if row["treatment"]:
            treated_taus.append(tau)

    config_hash = _config_hash(config)
    world_id = f"w_{config_hash[:16]}"
    output_dir = Path(output_dir)
    world_dir = output_dir / world_id
    data_path = world_dir / "events.csv"
    metadata_path = world_dir / "metadata.json"
    _write_csv(data_path, rows)
    output_hash = _sha256_file(data_path)
    seasonality_curve = [round(_seasonality(config, period), 8) for period in range(config.n_periods)]

    ate = sum(taus) / len(taus)
    att = sum(treated_taus) / len(treated_taus) if treated_taus else 0.0
    ground_truth: dict[str, Any] = {
        "ate": round(ate, 10),
        "att": round(att, 10),
        "true_incremental_lift": effective_lift,
        "true_iroas": None,
        "seed": config.seed,
        "baseline_cr": config.baseline_cr,
        "seasonality_curve": seasonality_curve,
        "geo_count": config.n_geos,
        "geo_random_effect_sd": (
            GEO_RANDOM_EFFECT_SD if config.world_type == WorldType.GEO_STRUCTURED else 0.0
        ),
        # The three coefficient values below are the LITERAL slopes used in the
        # outcome model on the centered covariates documented in
        # `outcome_model.covariate_normalization`. They are also the slopes used
        # (scaled by `assignment_model.bias_multiplier`) in the treatment-
        # assignment logit for confounded / zero-lift placebo worlds.
        "confounder_coefficients": {
            "recency": round(coefs["recency"], 10),
            "frequency": round(coefs["frequency"], 10),
            "prior_conversions": round(coefs["prior_conversions"], 10),
        },
        "outcome_model": {
            "formula": (
                "logit(p0) = intercept_logit"
                " + recency_coef * (recency_z - 0.5)"
                " + frequency_coef * (frequency_z - 0.5)"
                " + prior_conversions_coef * (prior_conversions_z - 0.5)"
                " + seasonality(period)"
                " + geo_effect[geo_id]"
                " + N(0, noise_sd)"
            ),
            "intercept_logit": round(base_logit, 10),
            "covariate_normalization": {
                "recency_z": "(12 - recency) / 12",
                "frequency_z": "min(frequency, 20) / 20",
                "prior_conversions_z": "min(prior_conversions, 5) / 5",
            },
            "coefficients": {
                "recency": round(coefs["recency"], 10),
                "frequency": round(coefs["frequency"], 10),
                "prior_conversions": round(coefs["prior_conversions"], 10),
            },
            "noise_sd": config.noise_sd,
            "seasonality_amplitude": config.seasonality,
            "notes": (
                "tau_i is normalized so mean(tau_i) == true_incremental_lift exactly;"
                " ate is the sample mean of tau_i and equals true_incremental_lift by construction."
                " p1 = clip(p0 + treatment * tau_i, 0, 1); outcome ~ Bernoulli(p1)."
            ),
        },
        "assignment_model": {
            "rule": {
                WorldType.CLEAN_AB: "bernoulli_independent_of_x",
                WorldType.GEO_STRUCTURED: "geo_level_random",
                WorldType.CONFOUNDED: "logit_centered_covariates",
                WorldType.ZERO_LIFT_PLACEBO: "logit_centered_covariates",
            }[config.world_type],
            "treat_frac": config.treat_frac,
            "bias_multiplier": (
                ASSIGNMENT_BIAS_MULTIPLIER
                if config.world_type in (WorldType.CONFOUNDED, WorldType.ZERO_LIFT_PLACEBO)
                else 0.0
            ),
            "coefficients": {
                "recency": round(coefs["recency"], 10),
                "frequency": round(coefs["frequency"], 10),
                "prior_conversions": round(coefs["prior_conversions"], 10),
            },
        },
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


__all__ = [
    "ASSIGNMENT_BIAS_MULTIPLIER",
    "GEO_RANDOM_EFFECT_SD",
    "SimulationConfig",
    "SimulatedWorld",
    "WorldType",
    "generate_world",
    "naive_lift",
]
