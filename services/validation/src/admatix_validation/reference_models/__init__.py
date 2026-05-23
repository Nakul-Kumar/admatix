"""Reference Bayesian estimators used by the SBC harness.

These are NOT production verifier methods — they exist solely so the SBC
harness has a well-specified Bayesian model whose posterior it can rank
ground truth within. The runbook documents the caveat: SBC validates these
reference estimators only; the frequentist production methods (BSTS,
CATE-DML, geo synthetic-control, OPE) are validated by CI-coverage.
"""

from __future__ import annotations

from .pymc_cate import (
    REFERENCE_MODEL_NAME,
    build_pymc_cate_model,
    sample_prior_gamma,
    simulate_world_from_prior,
)

__all__ = [
    "REFERENCE_MODEL_NAME",
    "build_pymc_cate_model",
    "sample_prior_gamma",
    "simulate_world_from_prior",
]
