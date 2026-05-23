from __future__ import annotations

from ._paths import add_sibling_sources

add_sibling_sources()

from .loaders import load_criteo_uplift, load_hillstrom
from .placebo import PlaceboResult, run_placebo_suite
from .qini_criteo import QiniCriteoResult, run_qini_criteo
from .qini_simulator import QiniSimulatorResult, run_qini_simulator
from .types import UpliftConfig

__version__ = "0.1.0"
__all__ = [
    "run_qini_simulator",
    "QiniSimulatorResult",
    "run_qini_criteo",
    "QiniCriteoResult",
    "run_placebo_suite",
    "PlaceboResult",
    "load_criteo_uplift",
    "load_hillstrom",
    "UpliftConfig",
]
