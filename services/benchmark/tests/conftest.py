"""Pytest config — ensure the simulator module is importable from the bench
worktree without installing the simulator as a package.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve()
_BENCH_ROOT = _HERE.parents[3]
_SIMULATOR_SRC = _BENCH_ROOT / "services" / "simulator" / "src"
if str(_SIMULATOR_SRC) not in sys.path and _SIMULATOR_SRC.exists():
    sys.path.insert(0, str(_SIMULATOR_SRC))
