from __future__ import annotations

from .criteo import CriteoBacktestResult, CriteoOutcomeResult, run_criteo_backtest
from .hillstrom import HillstromArmResult, HillstromBacktestResult, run_hillstrom_backtest
from .types import BacktestConfig

__version__ = "0.1.0"
__all__ = [
    "run_hillstrom_backtest",
    "HillstromBacktestResult",
    "HillstromArmResult",
    "run_criteo_backtest",
    "CriteoBacktestResult",
    "CriteoOutcomeResult",
    "BacktestConfig",
]
