"""AdMatix research-grade validation harness.

Public surface:
- `run_sbc` + `SbcResult` (sbc.py)
- `run_coverage` + `CoverageResult` (coverage.py)
- `run_rmse_bias` + `RmseBiasResult` (rmse_bias.py)
- `run_multiseed_variance` + `MultiSeedResult` (multiseed.py)
- `ValidationConfig` (types.py)
"""

from __future__ import annotations

__version__ = "0.1.0"

from .coverage import CoverageResult, run_coverage
from .multiseed import MultiSeedResult, run_multiseed_variance
from .rmse_bias import RmseBiasResult, run_rmse_bias
from .sbc import SbcResult, run_sbc
from .types import ValidationConfig, WorldRun

__all__ = [
    "__version__",
    "run_sbc",
    "SbcResult",
    "run_coverage",
    "CoverageResult",
    "run_rmse_bias",
    "RmseBiasResult",
    "run_multiseed_variance",
    "MultiSeedResult",
    "ValidationConfig",
    "WorldRun",
]
