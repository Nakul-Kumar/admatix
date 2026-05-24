from __future__ import annotations

import csv
import hashlib
import json
import math
import random
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Iterable, Sequence


class WorldType(str, Enum):
    CLEAN_AB = "clean_ab"
    GEO_STRUCTURED = "geo_structured"
    CONFOUNDED = "confounded"
    ZERO_LIFT_PLACEBO = "zero_lift_placebo"
    NON_STATIONARY = "non_stationary"
    CROSS_CAMPAIGN_INTERFERENCE = "cross_campaign_interference"
    ADVERSARIAL_MISSPECIFIED = "adversarial_misspecified"


# RNG stream offsets — kept distinct so each layer of the data-generating
# process is independent. Same seed reproduces the same world.
SEED_OFFSET_COVARIATES = 0
SEED_OFFSET_TREATMENT = 10_003
SEED_OFFSET_OUTCOME = 30_007
SEED_OFFSET_GEO_EFFECT = 40_009
SEED_OFFSET_PANEL = 50_021
SEED_OFFSET_COMPETING_CAMPAIGNS = 60_023
SEED_OFFSET_HIDDEN_CONFOUNDER = 70_027
SEED_OFFSET_HEAVY_TAIL = 80_029

# Multiplier applied to the named confounder coefficients when building the
# treatment-assignment logit, so a moderate confound_strength still produces a
# visibly biased assignment. Recorded in the manifest so a verifier can use it.
ASSIGNMENT_BIAS_MULTIPLIER = 3.0
GEO_RANDOM_EFFECT_SD = 0.15

# World types that build treatment assignment from the confounder coefficients
# (logit on centered covariates). All others use a world-specific rule.
_CONFOUNDED_ASSIGNMENT_WORLDS = (
    WorldType.CONFOUNDED,
    WorldType.ZERO_LIFT_PLACEBO,
    WorldType.ADVERSARIAL_MISSPECIFIED,
)


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
    # For geo_structured worlds, periods >= intervention_period are the
    # post-action window. None defaults to the midpoint of n_periods.
    intervention_period: int | None = None
    # Heterogeneity scale on the per-user CATE modifier. The modifier is
    # `1 + heterogeneity_scale * (recency_z - 0.5)` so the population mean is 1
    # and the range is `[1 - 0.5*h, 1 + 0.5*h]`. Default of 0.4 reproduces the
    # original modifier range `[0.8, 1.2]`. Set to 0 to disable heterogeneity.
    heterogeneity_scale: float = 0.4
    # --- non_stationary world ----------------------------------------------
    # Exponential decay rate of the per-user effect across periods. tau_i is
    # multiplied by exp(-effect_decay_rate * period). 0 -> no decay.
    effect_decay_rate: float = 0.0
    # Periods after launch (period < K) during which baseline noise is
    # multiplied and a transient drift is added to logit(p0).
    learning_phase_periods: int = 0
    learning_phase_noise_multiplier: float = 1.0
    learning_phase_drift: float = 0.0
    # --- cross_campaign_interference ---------------------------------------
    # Number of campaigns sharing the audience. The focal campaign is index 0
    # and is what `treatment` represents; the other campaigns' assignments are
    # surfaced as `competing_load` (mean of competing assignments per user).
    n_campaigns: int = 1
    # 0 -> no interference; 1 -> a user fully exposed to all competing
    # campaigns has zero focal lift. Recorded in metadata so the verifier can
    # know what the net effect captures.
    interference_strength: float = 0.0
    # --- adversarial_misspecified ------------------------------------------
    # Heavy-tailed outcome noise via Student-t with `noise_df` degrees of
    # freedom when `noise_dist == "student_t"`. Default is "gaussian".
    noise_dist: str = "gaussian"
    noise_df: float = 5.0
    # Amplitude of a sinusoidal time-modulation applied to the confounder
    # coefficients. 0 -> stationary confounding. Realized factor at period t
    # is `1 + time_varying_confound_amplitude * sin(2*pi*t/n_periods)`.
    time_varying_confound_amplitude: float = 0.0
    # Strength of a hidden Bernoulli confounder U_i that drives both treatment
    # assignment and the outcome but is NOT emitted to the CSV.
    hidden_confounder_strength: float = 0.0
    # Strength of geo-period level spillover: a user's p0 is bumped by
    # `spillover_strength * focal_treatment_rate(geo, period)`. The user's
    # own tau is unchanged — spillover only inflates the baseline.
    spillover_strength: float = 0.0

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
        if self.intervention_period is not None and not 0 < self.intervention_period < self.n_periods:
            raise ValueError("intervention_period must be between 1 and n_periods - 1")
        if self.confound_strength < 0:
            raise ValueError("confound_strength must be >= 0")
        if self.heterogeneity_scale < 0:
            raise ValueError("heterogeneity_scale must be >= 0")
        if self.effect_decay_rate < 0:
            raise ValueError("effect_decay_rate must be >= 0")
        if self.learning_phase_periods < 0:
            raise ValueError("learning_phase_periods must be >= 0")
        if self.learning_phase_noise_multiplier < 0:
            raise ValueError("learning_phase_noise_multiplier must be >= 0")
        if self.n_campaigns < 1:
            raise ValueError("n_campaigns must be >= 1")
        if self.interference_strength < 0:
            raise ValueError("interference_strength must be >= 0")
        if self.noise_dist not in ("gaussian", "student_t"):
            raise ValueError("noise_dist must be 'gaussian' or 'student_t'")
        if self.noise_df < 1:
            raise ValueError("noise_df must be >= 1")
        if self.time_varying_confound_amplitude < 0:
            raise ValueError("time_varying_confound_amplitude must be >= 0")
        if self.hidden_confounder_strength < 0:
            raise ValueError("hidden_confounder_strength must be >= 0")
        if self.spillover_strength < 0:
            raise ValueError("spillover_strength must be >= 0")
        if world_type == WorldType.GEO_STRUCTURED and self.n_users < self.n_geos:
            raise ValueError(
                "geo_structured world requires n_users >= n_geos so every geo has at least one user"
            )
        if world_type == WorldType.GEO_STRUCTURED and self.n_users < self.n_geos * self.n_periods:
            raise ValueError(
                "geo_structured world requires n_users >= n_geos * n_periods "
                "so every geo-period cell is populated"
            )
        if world_type == WorldType.CROSS_CAMPAIGN_INTERFERENCE and self.n_campaigns < 2:
            raise ValueError(
                "cross_campaign_interference world requires n_campaigns >= 2"
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

    For clean A/B, geo-structured, and non-stationary worlds these are 0 by
    construction — user-level confounding is not part of those worlds'
    generative stories. For confounded, zero-lift placebo, cross-campaign and
    adversarial worlds, the user's configured `confound_strength` is honored
    verbatim (no falsy fallback).
    """
    if config.world_type in (
        WorldType.CLEAN_AB,
        WorldType.GEO_STRUCTURED,
        WorldType.NON_STATIONARY,
    ):
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
    hidden_rng = random.Random(config.seed + SEED_OFFSET_HIDDEN_CONFOUNDER)
    rows: list[dict[str, Any]] = []
    devices = ["desktop", "mobile", "tablet"]
    age_bands = ["18-24", "25-34", "35-44", "45-54", "55+"]
    is_geo_world = config.world_type == WorldType.GEO_STRUCTURED
    is_adversarial = config.world_type == WorldType.ADVERSARIAL_MISSPECIFIED

    for user_id in range(config.n_users):
        recency = rng.randint(0, 12)
        frequency = rng.randint(0, 20)
        prior_conversions = rng.randint(0, 5)
        device = devices[rng.randrange(len(devices))]
        age_band = age_bands[rng.randrange(len(age_bands))]

        if is_geo_world:
            # Build a true geo×period panel. Round-robin geo assignment guarantees
            # every geo is populated; period is drawn so that within each geo the
            # observations span all periods evenly. This keeps the geo-holdout /
            # DiD verifier from spending calibration power on avoidable panel
            # imbalance rather than on the modeled outcome noise.
            geo_index = user_id % config.n_geos
            period_index = (user_id // config.n_geos) % config.n_periods
            period = period_index
            geo_id = f"geo_{geo_index:03d}"
        else:
            geo_id = f"geo_{user_id % config.n_geos:03d}"
            period = user_id % config.n_periods

        recency_z, frequency_z, prior_z = _normalize_covariates(recency, frequency, prior_conversions)
        # Hidden confounder U_i ~ Bernoulli(0.5) — adversarial worlds only.
        # Drawn unconditionally so the RNG stream is independent of world type.
        hidden_u = 1 if hidden_rng.random() < 0.5 else 0
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
            "_hidden_u": hidden_u if is_adversarial else 0,
        })
    return rows


def _assign_treatment(config: SimulationConfig, rows: list[dict[str, Any]], coefs: dict[str, float]) -> None:
    rng = random.Random(config.seed + SEED_OFFSET_TREATMENT)

    if config.world_type == WorldType.GEO_STRUCTURED:
        geos = sorted({row["geo_id"] for row in rows})
        n_treated = max(1, min(len(geos) - 1, round(len(geos) * config.treat_frac)))
        treated_geos = set(rng.sample(geos, n_treated))
        intervention_period = (
            int(config.intervention_period)
            if config.intervention_period is not None
            else config.n_periods // 2
        )
        for row in rows:
            treated_geo = 1 if row["geo_id"] in treated_geos else 0
            post_period = 1 if int(row["period"]) >= intervention_period else 0
            row["treated_geo"] = treated_geo
            row["post_period"] = post_period
            row["treatment"] = 1 if treated_geo and post_period else 0
        return

    if config.world_type in (WorldType.CLEAN_AB, WorldType.NON_STATIONARY):
        for row in rows:
            row["treated_geo"] = 0
            row["post_period"] = 1
            row["treatment"] = 1 if rng.random() < config.treat_frac else 0
        return

    if config.world_type == WorldType.CROSS_CAMPAIGN_INTERFERENCE:
        # Focal campaign assigned at treat_frac, independent of X. Competing
        # campaigns assigned independently per user from a dedicated stream.
        competing_rng = random.Random(config.seed + SEED_OFFSET_COMPETING_CAMPAIGNS)
        n_competing = config.n_campaigns - 1
        for row in rows:
            row["treated_geo"] = 0
            row["post_period"] = 1
            row["treatment"] = 1 if rng.random() < config.treat_frac else 0
            competing = [
                1 if competing_rng.random() < config.treat_frac else 0
                for _ in range(n_competing)
            ]
            row["_competing"] = competing
            row["competing_load"] = (
                sum(competing) / n_competing if n_competing > 0 else 0.0
            )
        return

    # Confounded, zero-lift placebo, adversarial-misspecified: the same named
    # coefficients drive assignment (scaled by ASSIGNMENT_BIAS_MULTIPLIER). If
    # confound_strength is 0 the coefficients are 0 and assignment is unbiased
    # Bernoulli(treat_frac). For adversarial worlds the hidden confounder adds
    # an unobserved contribution to the assignment logit.
    is_adversarial = config.world_type == WorldType.ADVERSARIAL_MISSPECIFIED
    hidden_strength = float(config.hidden_confounder_strength) if is_adversarial else 0.0
    logit_treat = _logit(config.treat_frac)
    for row in rows:
        row["treated_geo"] = 0
        row["post_period"] = 1
        contribution = _covariate_contribution(
            coefs, row["recency_z"], row["frequency_z"], row["prior_z"]
        )
        hidden_term = hidden_strength * (row["_hidden_u"] - 0.5)
        assignment_p = _sigmoid(
            logit_treat
            + ASSIGNMENT_BIAS_MULTIPLIER * contribution
            + ASSIGNMENT_BIAS_MULTIPLIER * hidden_term
        )
        row["treatment"] = 1 if rng.random() < assignment_p else 0


def _seasonality(config: SimulationConfig, period: int) -> float:
    weekly = math.sin((period % 7) / 7 * 2 * math.pi)
    slow = math.sin(period / max(config.n_periods, 1) * 2 * math.pi)
    return config.seasonality * (0.6 * weekly + 0.4 * slow)


def _effect_decay(config: SimulationConfig, period: int) -> float:
    if config.world_type != WorldType.NON_STATIONARY:
        return 1.0
    return math.exp(-float(config.effect_decay_rate) * period)


def _learning_phase_terms(config: SimulationConfig, period: int) -> tuple[float, float]:
    """Returns (logit_drift, noise_multiplier) for the learning phase. The
    drift is a linear ramp from `learning_phase_drift` at t=0 down to 0 at
    t=K. The noise multiplier is constant within the learning phase.
    """
    if config.world_type != WorldType.NON_STATIONARY:
        return 0.0, 1.0
    K = config.learning_phase_periods
    if K <= 0 or period >= K:
        return 0.0, 1.0
    drift = float(config.learning_phase_drift) * (1.0 - period / K)
    return drift, float(config.learning_phase_noise_multiplier)


def _time_varying_confound_factor(config: SimulationConfig, period: int) -> float:
    if config.world_type != WorldType.ADVERSARIAL_MISSPECIFIED:
        return 1.0
    amp = float(config.time_varying_confound_amplitude)
    if amp == 0.0:
        return 1.0
    return 1.0 + amp * math.sin(2 * math.pi * period / max(config.n_periods, 1))


def _heavy_tail_noise(rng: random.Random, sd: float, df: float) -> float:
    """Student-t noise scaled to have variance `sd**2`. The Student-t with
    df > 2 has variance df/(df-2), so we divide by sqrt(df/(df-2)) to put it
    on the same scale as a Gaussian with sd `sd`. Uses the integer-df
    construction t = Z / sqrt(chi2(df)/df).
    """
    df_int = max(1, int(round(df)))
    z = rng.gauss(0.0, 1.0)
    chi2 = sum(rng.gauss(0.0, 1.0) ** 2 for _ in range(df_int))
    if chi2 <= 0:
        chi2 = 1e-12
    t = z / math.sqrt(chi2 / df_int)
    if df_int > 2:
        scale = math.sqrt((df_int - 2) / df_int)
    else:
        scale = 1.0
    return sd * scale * t


def _compute_spillover(
    config: SimulationConfig, rows: list[dict[str, Any]]
) -> dict[tuple[str, int], float]:
    """Geo-period focal-treatment rate, used as additive spillover on p0 in
    adversarial worlds. Returns 0 for non-adversarial worlds.
    """
    if (
        config.world_type != WorldType.ADVERSARIAL_MISSPECIFIED
        or float(config.spillover_strength) == 0.0
    ):
        return {}
    sums: dict[tuple[str, int], list[int]] = {}
    for row in rows:
        key = (row["geo_id"], int(row["period"]))
        bucket = sums.setdefault(key, [0, 0])
        bucket[0] += int(row["treatment"])
        bucket[1] += 1
    return {key: (s / max(n, 1)) for key, (s, n) in sums.items()}


# Output columns. `treated_propensity` (= clip(p0 + tau, 0, 1)) and
# `competing_load` (= fraction of competing campaigns active for this user)
# are emitted for every world type — they're 0 in worlds that don't use them
# but make the seed-paired counterfactual recoverable from the CSV alone.
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
    "treated_propensity",
    "treatment",
    "treated_geo",
    "post_period",
    "competing_load",
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

    spillover_by_geo_period = _compute_spillover(config, rows)

    # Heterogeneity modifier drives a per-user CATE around the population mean.
    # `1 + heterogeneity_scale * (recency_z - 0.5)` is symmetric about 1.0 so
    # the recency-z-mean=0.5 fixes mean(modifier) at exactly 1.0.
    h = float(config.heterogeneity_scale)
    raw_modifiers = [1.0 + h * (row["recency_z"] - 0.5) for row in rows]
    mean_modifier = sum(raw_modifiers) / len(raw_modifiers) if raw_modifiers else 1.0
    effective_lift = 0.0 if config.world_type == WorldType.ZERO_LIFT_PLACEBO else config.true_lift

    outcome_rng = random.Random(config.seed + SEED_OFFSET_OUTCOME)
    geo_rng = random.Random(config.seed + SEED_OFFSET_GEO_EFFECT)
    heavy_rng = random.Random(config.seed + SEED_OFFSET_HEAVY_TAIL)
    geo_effects = {
        f"geo_{idx:03d}": geo_rng.gauss(0, GEO_RANDOM_EFFECT_SD) for idx in range(config.n_geos)
    }

    base_logit = _logit(config.baseline_cr)
    treated_taus: list[float] = []
    taus: list[float] = []
    p0_sum = 0.0
    p1_sum = 0.0
    verification_target_taus: list[float] = []

    is_adversarial = config.world_type == WorldType.ADVERSARIAL_MISSPECIFIED
    is_cross_campaign = config.world_type == WorldType.CROSS_CAMPAIGN_INTERFERENCE
    is_non_stationary = config.world_type == WorldType.NON_STATIONARY
    use_heavy_tail = is_adversarial and config.noise_dist == "student_t"

    for row, modifier in zip(rows, raw_modifiers):
        period = int(row["period"])
        decay = _effect_decay(config, period)
        learning_drift, learning_noise_mult = _learning_phase_terms(config, period)

        # Per-row tau: base effect * heterogeneity modifier * (decay over time)
        # * (interference dilution). Normalized so that, in the absence of
        # decay/interference, mean(tau_i) == effective_lift.
        norm = (modifier / mean_modifier) if mean_modifier else 1.0
        interference_factor = 1.0
        if is_cross_campaign:
            interference_factor = max(
                0.0,
                1.0 - float(config.interference_strength) * float(row["competing_load"]),
            )
        tau = effective_lift * norm * decay * interference_factor
        if config.world_type == WorldType.GEO_STRUCTURED and int(row["post_period"]) == 0:
            tau = 0.0

        confounder_term = _covariate_contribution(
            coefs, row["recency_z"], row["frequency_z"], row["prior_z"]
        )
        # Time-varying confounding (adversarial): the recorded coefficients
        # are the period-0 / no-modulation values. The realized confounder
        # contribution at period t is scaled by `1 + amp * sin(2pi t / N)`.
        confounder_term *= _time_varying_confound_factor(config, period)

        geo_term = (
            geo_effects[row["geo_id"]] if config.world_type == WorldType.GEO_STRUCTURED else 0.0
        )
        seasonality_term = _seasonality(config, period)

        # Outcome noise. Adversarial worlds optionally use a Student-t with
        # variance-matched scale; everyone else uses Gaussian. `noise_sd` is
        # the population scale, optionally inflated by the learning-phase
        # multiplier on non-stationary worlds.
        effective_noise_sd = config.noise_sd * (learning_noise_mult if is_non_stationary else 1.0)
        if effective_noise_sd:
            if use_heavy_tail:
                noise = _heavy_tail_noise(heavy_rng, effective_noise_sd, config.noise_df)
            else:
                noise = outcome_rng.gauss(0, effective_noise_sd)
        else:
            noise = 0.0

        hidden_term = 0.0
        if is_adversarial:
            hidden_term = float(config.hidden_confounder_strength) * (row["_hidden_u"] - 0.5)

        spillover_term = 0.0
        if is_adversarial and float(config.spillover_strength):
            rate = spillover_by_geo_period.get((row["geo_id"], period), 0.0)
            spillover_term = float(config.spillover_strength) * rate

        p0 = _sigmoid(
            base_logit
            + confounder_term
            + geo_term
            + seasonality_term
            + learning_drift
            + hidden_term
            + spillover_term
            + noise
        )
        p1 = max(0.0, min(1.0, p0 + tau))
        realized_p = p1 if row["treatment"] else p0
        outcome = 1 if outcome_rng.random() < realized_p else 0
        # Draw revenue unconditionally so the RNG stream is independent of
        # outcome realizations (issue #16).
        revenue_draw = round(outcome_rng.lognormvariate(math.log(120), 0.35), 4)
        revenue = revenue_draw if outcome else 0.0

        row["baseline_propensity"] = f"{p0:.12f}"
        row["treated_propensity"] = f"{p1:.12f}"
        if "competing_load" not in row:
            row["competing_load"] = 0.0
        row["competing_load"] = f"{float(row['competing_load']):.10f}"
        row["outcome"] = outcome
        row["revenue"] = f"{revenue:.4f}"
        row["tau"] = f"{tau:.10f}"
        taus.append(tau)
        if config.world_type != WorldType.GEO_STRUCTURED or int(row["post_period"]) == 1:
            verification_target_taus.append(tau)
        p0_sum += p0
        p1_sum += p1
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

    n = len(taus)
    ate = sum(taus) / n if n else 0.0
    att = sum(treated_taus) / len(treated_taus) if treated_taus else 0.0
    verification_target_ate = (
        sum(verification_target_taus) / len(verification_target_taus)
        if verification_target_taus
        else ate
    )
    mean_p0 = p0_sum / n if n else 0.0
    mean_p1 = p1_sum / n if n else 0.0
    # seed-paired counterfactual difference at the propensity level (post-clip).
    paired_counterfactual = mean_p1 - mean_p0

    assignment_rule = {
        WorldType.CLEAN_AB: "bernoulli_independent_of_x",
        WorldType.GEO_STRUCTURED: "geo_level_prepost_holdout",
        WorldType.CONFOUNDED: "logit_centered_covariates",
        WorldType.ZERO_LIFT_PLACEBO: "logit_centered_covariates",
        WorldType.NON_STATIONARY: "bernoulli_independent_of_x",
        WorldType.CROSS_CAMPAIGN_INTERFERENCE: "bernoulli_independent_of_x_per_campaign",
        WorldType.ADVERSARIAL_MISSPECIFIED: "logit_centered_covariates_plus_hidden_u",
    }[config.world_type]
    geo_intervention_period = (
        int(config.intervention_period)
        if config.intervention_period is not None
        else config.n_periods // 2
    )

    ground_truth: dict[str, Any] = {
        "ate": round(ate, 10),
        "att": round(att, 10),
        "verification_target_ate": round(verification_target_ate, 10),
        "true_incremental_lift": effective_lift,
        "true_iroas": None,
        "seed": config.seed,
        "baseline_cr": config.baseline_cr,
        "seasonality_curve": seasonality_curve,
        "geo_count": config.n_geos,
        "geo_random_effect_sd": (
            GEO_RANDOM_EFFECT_SD if config.world_type == WorldType.GEO_STRUCTURED else 0.0
        ),
        "geo_holdout": {
            "intervention_period": geo_intervention_period if config.world_type == WorldType.GEO_STRUCTURED else None,
            "estimand": (
                "mean post-period tau across treated and control geos"
                if config.world_type == WorldType.GEO_STRUCTURED
                else None
            ),
            "treated_geo_column": "treated_geo",
            "post_period_column": "post_period",
        },
        # The three coefficient values below are the LITERAL slopes used in the
        # outcome model on the centered covariates documented in
        # `outcome_model.covariate_normalization`. They are also the slopes used
        # (scaled by `assignment_model.bias_multiplier`) in the treatment-
        # assignment logit for confounded / zero-lift placebo / adversarial
        # worlds.
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
                " + learning_phase_drift(period)"
                " + hidden_confounder_term"
                " + spillover_term"
                " + noise"
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
            "noise_dist": config.noise_dist if is_adversarial else "gaussian",
            "noise_df": config.noise_df if (is_adversarial and use_heavy_tail) else None,
            "seasonality_amplitude": config.seasonality,
            "heterogeneity_scale": config.heterogeneity_scale,
            "notes": (
                "tau_i = effective_lift * (modifier_i / mean_modifier) * decay(period_i)"
                " * interference_factor_i. modifier_i = 1 + heterogeneity_scale * (recency_z - 0.5)."
                " decay(t) = exp(-effect_decay_rate * t) (1 for non-non-stationary worlds);"
                " interference_factor = max(0, 1 - interference_strength * competing_load) (1 outside cross-campaign)."
                " ate is the sample mean of tau_i;"
                " p1 = clip(p0 + tau_i, 0, 1); outcome ~ Bernoulli(p1 if treated else p0)."
            ),
        },
        "assignment_model": {
            "rule": assignment_rule,
            "treat_frac": config.treat_frac,
            "bias_multiplier": (
                ASSIGNMENT_BIAS_MULTIPLIER
                if config.world_type in _CONFOUNDED_ASSIGNMENT_WORLDS
                else 0.0
            ),
            "coefficients": {
                "recency": round(coefs["recency"], 10),
                "frequency": round(coefs["frequency"], 10),
                "prior_conversions": round(coefs["prior_conversions"], 10),
            },
            "n_campaigns": config.n_campaigns,
            "hidden_confounder_strength": (
                float(config.hidden_confounder_strength) if is_adversarial else 0.0
            ),
        },
        "non_stationary": {
            "effect_decay_rate": config.effect_decay_rate,
            "learning_phase_periods": config.learning_phase_periods,
            "learning_phase_noise_multiplier": config.learning_phase_noise_multiplier,
            "learning_phase_drift": config.learning_phase_drift,
        },
        "cross_campaign_interference": {
            "n_campaigns": config.n_campaigns,
            "interference_strength": config.interference_strength,
        },
        "adversarial_misspecified": {
            "noise_dist": config.noise_dist,
            "noise_df": config.noise_df,
            "time_varying_confound_amplitude": config.time_varying_confound_amplitude,
            "hidden_confounder_strength": config.hidden_confounder_strength,
            "spillover_strength": config.spillover_strength,
        },
        # Population-level seed-paired counterfactual difference (post-clip).
        # By construction this equals mean(treated_propensity) - mean(baseline_propensity)
        # over the CSV — useful for verifying the per-row truth contract.
        "seed_paired_counterfactual_diff": round(paired_counterfactual, 10),
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


# ---------------------------------------------------------------------------
# CausalProfiler — config-driven sweep generator
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SweepCell:
    """One cell of a CausalProfiler-style sweep. The label is a stable,
    human-readable identifier ('confound=2.0|het=0.4|sign=neg|overlap=0.5');
    the config is the SimulationConfig to instantiate.
    """

    label: str
    config: SimulationConfig


# Default grid used by `causal_profiler_sweep()` when no axes are supplied.
# Chosen to cover the four axes named in PROOF-WAVE / SIMULATION-VERIFICATION:
# confounding, heterogeneity, sign of the effect (incl. negative), and
# treated/control overlap (treat_frac).
DEFAULT_SWEEP_AXES: dict[str, Sequence[float]] = {
    "confound_strength": (0.0, 1.0, 2.5),
    "heterogeneity_scale": (0.0, 0.4, 1.0),
    "effect_sign": (-1.0, 0.0, 1.0),
    "treat_frac": (0.1, 0.5, 0.9),
}


def causal_profiler_sweep(
    *,
    base: SimulationConfig | None = None,
    world_type: WorldType | str = WorldType.CONFOUNDED,
    axes: dict[str, Sequence[float]] | None = None,
    base_lift_magnitude: float = 0.02,
    seed: int = 17,
) -> list[SweepCell]:
    """Generate a grid of SimulationConfigs varying confound_strength,
    heterogeneity_scale, effect_sign, and treat_frac (overlap).

    The same seed is used across all cells so that two cells differing only in
    one axis are directly comparable. Each cell is labeled by its axis values
    so callers can correlate verifier results back to the generating config.

    Negative lift is realized via `true_lift = base_lift_magnitude * sign`.
    For `effect_sign == 0`, the cell is forced to a clean zero-effect setup so
    the placebo-style truth is exactly 0.
    """
    axes = dict(DEFAULT_SWEEP_AXES) if axes is None else {**DEFAULT_SWEEP_AXES, **axes}
    base = base or SimulationConfig(
        world_type=world_type,
        n_users=2_000,
        n_periods=30,
        n_geos=20,
        seed=seed,
    )
    cells: list[SweepCell] = []
    for confound in axes["confound_strength"]:
        for het in axes["heterogeneity_scale"]:
            for sign in axes["effect_sign"]:
                for overlap in axes["treat_frac"]:
                    sign_label = "pos" if sign > 0 else ("neg" if sign < 0 else "zero")
                    label = (
                        f"confound={confound:g}|het={het:g}|sign={sign_label}|overlap={overlap:g}"
                    )
                    true_lift = base_lift_magnitude * sign
                    cfg_kwargs = {
                        **_config_payload(base),
                        "confound_strength": float(confound),
                        "heterogeneity_scale": float(het),
                        "true_lift": float(true_lift),
                        "treat_frac": float(overlap),
                        "seed": seed,
                    }
                    cfg = SimulationConfig(**cfg_kwargs)
                    cells.append(SweepCell(label=label, config=cfg))
    return cells


__all__ = [
    "ASSIGNMENT_BIAS_MULTIPLIER",
    "DEFAULT_SWEEP_AXES",
    "GEO_RANDOM_EFFECT_SD",
    "SimulationConfig",
    "SimulatedWorld",
    "SweepCell",
    "WorldType",
    "causal_profiler_sweep",
    "generate_world",
    "naive_lift",
]
