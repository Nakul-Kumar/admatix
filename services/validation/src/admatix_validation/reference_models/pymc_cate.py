"""A small, well-specified Bayesian CATE model used as the SBC reference.

Specification (per WP-T spec §Public surface — reference Bayesian estimator):

    Y ~ Bernoulli(p)
    logit(p) = α + γ·W + β·X        (X = recency, frequency, prior_conversions)
    γ ~ Normal(0, 0.05)             # prior on the ATE on logit scale
    α ~ Normal(0, 1)
    β ~ Normal(0, 0.5)

The reference model is deliberately small (one treatment coefficient, three
covariates) so PyMC inference is fast enough for ≥ 500 SBC simulations to
complete in ~10 minutes on the VPS. Each fit uses very few draws/tune
iterations because SBC needs many fits, not high-precision per fit — the
SBC procedure trades per-fit precision for ensemble uniformity.

This module also provides `simulate_world_from_prior(gamma, seed)` — a
model-consistent data generator. SBC requires the data-generating process
match the inferential model exactly; if it does not, rank uniformity fails
not from bad inference but from misspecification. The function writes
events in the simulator's CSV format (so the rest of the harness can
re-read it via `admatix_verifier.loaders.load_events`) but generates
outcomes via the logistic model above. The runbook documents this
deliberate choice — the production simulator's additive p1=p0+W·τ outcome
model is approximately but not exactly equivalent to the logistic model at
small γ; for SBC purity we use the exact-match generator here. Coverage,
RMSE, and multi-seed harnesses use `admatix_simulator.generate_world`
unchanged.
"""

from __future__ import annotations

import os
import warnings
from typing import Any

import numpy as np
import pandas as pd

# Quiet pymc/aesara progress + GPU detection; this module is import-time hot.
os.environ.setdefault("PYMC_LOGGING_LEVEL", "WARNING")
os.environ.setdefault("PYTENSOR_FLAGS", "mode=FAST_RUN,optimizer=fast_compile")


REFERENCE_MODEL_NAME = "pymc_bayesian_cate_v0_1"

# Prior hyperparameters — fixed in the spec. Kept here so SBC can sample from
# the same prior the model declares.
PRIOR_GAMMA_MEAN = 0.0
PRIOR_GAMMA_SD = 0.05
PRIOR_ALPHA_MEAN = 0.0
PRIOR_ALPHA_SD = 1.0
PRIOR_BETA_MEAN = 0.0
PRIOR_BETA_SD = 0.5


def sample_prior_gamma(seed: int) -> float:
    """Draw one γ from the model's declared prior. Used by the SBC loop step (1)."""
    rng = np.random.default_rng(seed)
    return float(rng.normal(PRIOR_GAMMA_MEAN, PRIOR_GAMMA_SD))


def _sample_prior_alpha_beta(seed: int) -> tuple[float, np.ndarray]:
    """Draw α and the β vector from the priors. Used so the simulated world's
    nuisance parameters match the model's prior, not arbitrary defaults."""
    rng = np.random.default_rng(seed + 1_000)
    alpha = float(rng.normal(PRIOR_ALPHA_MEAN, PRIOR_ALPHA_SD))
    beta = rng.normal(PRIOR_BETA_MEAN, PRIOR_BETA_SD, size=3)
    return alpha, beta


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-z))


def simulate_world_from_prior(
    gamma: float,
    *,
    seed: int,
    n_users: int = 400,
    output_dir,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Generate a small, model-consistent world for one SBC iteration.

    Writes `events.csv` and `metadata.json` under
    `output_dir/sbc_world_<seed>/` so the rest of the harness can re-read
    it through the simulator's loaders if needed. Returns the in-memory
    DataFrame and the ground-truth dict (so the caller doesn't pay a
    re-parse cost).

    The data-generating process is exactly the PyMC reference model:
      W ~ Bernoulli(0.5)            (independent of X — clean A/B)
      X = (recency_z, frequency_z, prior_z) ~ Uniform([-0.5, 0.5]^3)
      Y ~ Bernoulli(sigmoid(α + γ·W + β·X))
    """
    from pathlib import Path

    rng = np.random.default_rng(seed + 2_000)
    alpha, beta = _sample_prior_alpha_beta(seed)

    # Covariates on [-0.5, 0.5] so they're centered at 0 (matches the simulator's
    # centered-covariate convention in services/simulator).
    recency_z = rng.uniform(-0.5, 0.5, size=n_users)
    frequency_z = rng.uniform(-0.5, 0.5, size=n_users)
    prior_z = rng.uniform(-0.5, 0.5, size=n_users)
    X = np.stack([recency_z, frequency_z, prior_z], axis=1)

    W = rng.binomial(1, 0.5, size=n_users).astype(int)

    logit_p = alpha + gamma * W + X @ beta
    p = _sigmoid(logit_p)
    Y = rng.binomial(1, p).astype(int)

    # Recover ground-truth ATE on probability scale (sample average of
    # τ_i = sigmoid(α + γ + β·X_i) − sigmoid(α + β·X_i)) for downstream
    # diagnostics. SBC ranks γ within the posterior of γ, so this is not
    # used by SBC — it is recorded for the metadata only.
    p_t = _sigmoid(alpha + gamma + X @ beta)
    p_c = _sigmoid(alpha + X @ beta)
    ate = float(np.mean(p_t - p_c))

    events = pd.DataFrame({
        "user_id": np.arange(n_users, dtype=int),
        "period": np.zeros(n_users, dtype=int),
        "geo_id": ["geo_000"] * n_users,
        "age_band": ["18-24"] * n_users,
        "device": ["mobile"] * n_users,
        # Original (un-z'd) covariates kept zero — verifier doesn't read them
        # for the SBC path; the centered _z columns below are the truth.
        "recency": np.zeros(n_users, dtype=int),
        "frequency": np.zeros(n_users, dtype=int),
        "prior_conversions": np.zeros(n_users, dtype=int),
        "baseline_propensity": p,
        "treatment": W,
        "outcome": Y,
        "revenue": 0.0,
        "tau": np.full(n_users, ate, dtype=float),
        "recency_z": recency_z + 0.5,
        "frequency_z": frequency_z + 0.5,
        "prior_z": prior_z + 0.5,
    })

    output_dir = Path(output_dir)
    world_dir = output_dir / f"sbc_world_{seed:09d}"
    world_dir.mkdir(parents=True, exist_ok=True)
    events.to_csv(world_dir / "events.csv", index=False)

    ground_truth: dict[str, Any] = {
        "gamma_truth": float(gamma),
        "alpha_truth": float(alpha),
        "beta_truth": [float(b) for b in beta],
        "ate_probability_scale": ate,
        "n_users": int(n_users),
        "seed": int(seed),
    }
    (world_dir / "ground_truth.json").write_text(
        __import__("json").dumps(ground_truth, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    return events, ground_truth


def build_pymc_cate_model(
    events: pd.DataFrame,
    *,
    n_draws: int = 1000,
    n_tune: int = 1000,
    random_seed: int = 17,
):
    """Fit the reference Bayesian CATE model on an events frame.

    Returns the arviz InferenceData with posterior samples of γ — the
    quantity the SBC harness ranks ground truth within.
    """
    # Lazy import: pymc + arviz are heavy and we don't want to pay the
    # import cost when callers only need `sample_prior_gamma` /
    # `simulate_world_from_prior` (e.g., the determinism test path).
    import arviz as az  # noqa: F401  (imported for type clarity in callers)
    import pymc as pm

    w = events["treatment"].to_numpy(dtype=float)
    y = events["outcome"].to_numpy(dtype=int)
    x_cols = [c for c in ("recency_z", "frequency_z", "prior_z") if c in events.columns]
    if not x_cols:
        # Should not happen via simulate_world_from_prior, but stay defensive.
        x = np.zeros((len(events), 0))
    else:
        x = events[x_cols].to_numpy(dtype=float)
        # Center to match the prior's symmetry (β ~ N(0, 0.5) on centered X).
        x = x - 0.5

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with pm.Model():
            alpha = pm.Normal("alpha", mu=PRIOR_ALPHA_MEAN, sigma=PRIOR_ALPHA_SD)
            gamma = pm.Normal("gamma", mu=PRIOR_GAMMA_MEAN, sigma=PRIOR_GAMMA_SD)
            if x.shape[1] > 0:
                beta = pm.Normal("beta", mu=PRIOR_BETA_MEAN, sigma=PRIOR_BETA_SD, shape=x.shape[1])
                logit_p = alpha + gamma * w + pm.math.dot(x, beta)
            else:
                logit_p = alpha + gamma * w
            pm.Bernoulli("y_obs", logit_p=logit_p, observed=y)

            idata = pm.sample(
                draws=n_draws,
                tune=n_tune,
                chains=1,
                cores=1,
                random_seed=int(random_seed),
                progressbar=False,
                compute_convergence_checks=False,
                return_inferencedata=True,
            )

    return idata


__all__ = [
    "REFERENCE_MODEL_NAME",
    "build_pymc_cate_model",
    "sample_prior_gamma",
    "simulate_world_from_prior",
]
