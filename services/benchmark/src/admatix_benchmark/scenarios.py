"""Scenario definitions — the per-world ad accounts the benchmark runs.

Each scenario is a function `build(seed: int) -> EnvConfig` returning a full
multi-campaign ad account that exercises one of the seven simulator world
types. The campaign mix per scenario is designed so the buyer's decisions
matter:

  * At least one OBVIOUS WINNER (positive true_lift, low confounding) —
    scaling it is the right call.
  * At least one OBVIOUS LOSER (zero or negative true_lift) — scaling it
    on reported ROAS is the trap the modern playbook + AdMatix gate should
    catch.
  * Where the world type applies (confounded, adversarial_misspecified),
    additional TRAP campaigns whose reported ROAS overstates real lift.

The campaign worlds are generated via the simulator (each campaign = one
simulator world). The benchmark seed plus the campaign id determine the
simulator seed (in `env._spec_to_sim_config`), so the campaign mix is
deterministic.
"""

from __future__ import annotations

from pathlib import Path

from admatix_simulator import WorldType

from .env import CampaignSpec, EnvConfig


# Default global parameters. Tweak via `make_env(...).config.data_dir`.
_DEFAULT_N_USERS = 4_000
_DEFAULT_N_PERIODS = 28
_DEFAULT_N_GEOS = 20
_DEFAULT_BASE_DAILY_BUDGET = 100.0
_DEFAULT_DATA_DIR = Path("data/benchmark")


def _spec(
    campaign_id: str,
    world_type: WorldType,
    *,
    true_lift: float,
    confound_strength: float = 0.0,
    label: str = "",
    n_users: int = _DEFAULT_N_USERS,
    n_periods: int = _DEFAULT_N_PERIODS,
    n_geos: int = _DEFAULT_N_GEOS,
    base_daily_budget: float = _DEFAULT_BASE_DAILY_BUDGET,
    treat_frac: float = 0.5,
    seasonality: float = 0.1,
    noise_sd: float = 0.4,
    n_campaigns: int = 1,
    interference_strength: float = 0.0,
    effect_decay_rate: float = 0.0,
    learning_phase_periods: int = 0,
    learning_phase_drift: float = 0.0,
    noise_dist: str = "gaussian",
    noise_df: float = 5.0,
    time_varying_confound_amplitude: float = 0.0,
    hidden_confounder_strength: float = 0.0,
    spillover_strength: float = 0.0,
) -> CampaignSpec:
    return CampaignSpec(
        campaign_id=campaign_id,
        world_type=world_type,
        true_lift=true_lift,
        confound_strength=confound_strength,
        revealed_world_label=label,
        base_daily_budget=base_daily_budget,
        n_users=n_users,
        n_periods=n_periods,
        n_geos=n_geos,
        treat_frac=treat_frac,
        seasonality=seasonality,
        noise_sd=noise_sd,
        n_campaigns=n_campaigns,
        interference_strength=interference_strength,
        effect_decay_rate=effect_decay_rate,
        learning_phase_periods=learning_phase_periods,
        learning_phase_drift=learning_phase_drift,
        noise_dist=noise_dist,
        noise_df=noise_df,
        time_varying_confound_amplitude=time_varying_confound_amplitude,
        hidden_confounder_strength=hidden_confounder_strength,
        spillover_strength=spillover_strength,
    )


def clean_ab_account(seed: int, data_dir: Path = _DEFAULT_DATA_DIR) -> EnvConfig:
    return EnvConfig(
        account_id=f"clean_ab__seed{seed}",
        campaigns=(
            _spec("c_winner", WorldType.CLEAN_AB, true_lift=0.02, label="positive_lift"),
            _spec("c_meh", WorldType.CLEAN_AB, true_lift=0.005, label="small_positive_lift"),
            _spec("c_dud", WorldType.CLEAN_AB, true_lift=0.0, label="no_lift"),
        ),
        seed=seed,
        data_dir=data_dir,
    )


def confounded_account(seed: int, data_dir: Path = _DEFAULT_DATA_DIR) -> EnvConfig:
    # The trap: high reported ROAS purely from selection bias (recent, high-
    # frequency users being over-targeted AND naturally converting more).
    return EnvConfig(
        account_id=f"confounded__seed{seed}",
        campaigns=(
            _spec(
                "c_real_lift",
                WorldType.CONFOUNDED,
                true_lift=0.015,
                confound_strength=0.4,
                label="real_lift_with_confounding",
            ),
            _spec(
                "c_trap",
                WorldType.CONFOUNDED,
                true_lift=0.0,
                confound_strength=2.0,
                label="zero_lift_high_confound_trap",
            ),
            _spec(
                "c_baseline",
                WorldType.CONFOUNDED,
                true_lift=0.005,
                confound_strength=0.2,
                label="small_lift_low_confound",
            ),
        ),
        seed=seed,
        data_dir=data_dir,
    )


def geo_structured_account(seed: int, data_dir: Path = _DEFAULT_DATA_DIR) -> EnvConfig:
    return EnvConfig(
        account_id=f"geo_structured__seed{seed}",
        campaigns=(
            _spec(
                "c_geo_winner",
                WorldType.GEO_STRUCTURED,
                true_lift=0.018,
                label="geo_positive_lift",
                n_geos=30,
                n_users=6_000,
            ),
            _spec(
                "c_geo_flat",
                WorldType.GEO_STRUCTURED,
                true_lift=0.0,
                label="geo_no_lift",
                n_geos=30,
                n_users=6_000,
            ),
        ),
        seed=seed,
        data_dir=data_dir,
    )


def placebo_account(seed: int, data_dir: Path = _DEFAULT_DATA_DIR) -> EnvConfig:
    # Adversarial: all campaigns have ZERO true lift, but the platform reports
    # plenty of "conversions" because treated users would have converted
    # anyway. A naïve agent will scale into all of them; AdMatix should hold.
    return EnvConfig(
        account_id=f"placebo__seed{seed}",
        campaigns=(
            _spec(
                "c_placebo_1",
                WorldType.ZERO_LIFT_PLACEBO,
                true_lift=0.0,
                confound_strength=1.0,
                label="placebo_with_confound",
            ),
            _spec(
                "c_placebo_2",
                WorldType.ZERO_LIFT_PLACEBO,
                true_lift=0.0,
                confound_strength=2.0,
                label="placebo_high_confound",
            ),
            _spec(
                "c_placebo_3",
                WorldType.ZERO_LIFT_PLACEBO,
                true_lift=0.0,
                confound_strength=0.5,
                label="placebo_low_confound",
            ),
        ),
        seed=seed,
        data_dir=data_dir,
    )


def non_stationary_account(seed: int, data_dir: Path = _DEFAULT_DATA_DIR) -> EnvConfig:
    return EnvConfig(
        account_id=f"non_stationary__seed{seed}",
        campaigns=(
            _spec(
                "c_stable",
                WorldType.NON_STATIONARY,
                true_lift=0.015,
                label="stable_positive_lift",
                effect_decay_rate=0.0,
            ),
            _spec(
                "c_decaying",
                WorldType.NON_STATIONARY,
                true_lift=0.02,
                label="decaying_positive_lift",
                effect_decay_rate=0.08,
            ),
            _spec(
                "c_learning",
                WorldType.NON_STATIONARY,
                true_lift=0.012,
                label="learning_phase_then_steady",
                learning_phase_periods=10,
                learning_phase_drift=0.6,
            ),
        ),
        seed=seed,
        data_dir=data_dir,
    )


def interference_account(seed: int, data_dir: Path = _DEFAULT_DATA_DIR) -> EnvConfig:
    return EnvConfig(
        account_id=f"interference__seed{seed}",
        campaigns=(
            _spec(
                "c_clean_focal",
                WorldType.CROSS_CAMPAIGN_INTERFERENCE,
                true_lift=0.015,
                label="focal_lift_low_interference",
                n_campaigns=3,
                interference_strength=0.2,
            ),
            _spec(
                "c_cannibalised",
                WorldType.CROSS_CAMPAIGN_INTERFERENCE,
                true_lift=0.02,
                label="focal_lift_high_interference",
                n_campaigns=4,
                interference_strength=0.8,
            ),
        ),
        seed=seed,
        data_dir=data_dir,
    )


def adversarial_account(seed: int, data_dir: Path = _DEFAULT_DATA_DIR) -> EnvConfig:
    return EnvConfig(
        account_id=f"adversarial__seed{seed}",
        campaigns=(
            _spec(
                "c_hidden_u",
                WorldType.ADVERSARIAL_MISSPECIFIED,
                true_lift=0.012,
                confound_strength=0.6,
                hidden_confounder_strength=0.8,
                label="hidden_unmeasured_confounder",
            ),
            _spec(
                "c_time_varying",
                WorldType.ADVERSARIAL_MISSPECIFIED,
                true_lift=0.0,
                confound_strength=1.2,
                time_varying_confound_amplitude=0.6,
                label="zero_lift_time_varying_confound",
            ),
            _spec(
                "c_spillover",
                WorldType.ADVERSARIAL_MISSPECIFIED,
                true_lift=0.01,
                confound_strength=0.4,
                spillover_strength=0.4,
                noise_dist="student_t",
                noise_df=5.0,
                label="spillover_plus_heavy_tail",
            ),
        ),
        seed=seed,
        data_dir=data_dir,
    )


SCENARIO_BUILDERS = {
    "clean_ab": clean_ab_account,
    "confounded": confounded_account,
    "geo_structured": geo_structured_account,
    "zero_lift_placebo": placebo_account,
    "non_stationary": non_stationary_account,
    "cross_campaign_interference": interference_account,
    "adversarial_misspecified": adversarial_account,
}


WORLD_TYPES = tuple(SCENARIO_BUILDERS.keys())


def build_env_config(world_type: str, seed: int, data_dir: Path = _DEFAULT_DATA_DIR) -> EnvConfig:
    try:
        builder = SCENARIO_BUILDERS[world_type]
    except KeyError as exc:
        raise KeyError(
            f"unknown world_type {world_type!r}; known: {sorted(SCENARIO_BUILDERS)}"
        ) from exc
    return builder(seed=seed, data_dir=data_dir)


__all__ = ["SCENARIO_BUILDERS", "WORLD_TYPES", "build_env_config"]
