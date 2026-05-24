"""AdMatix head-to-head benchmark.

Runs a real LLM media buyer (and a faithful behavioral policy) against the
AdMatix simulator under four arms: { basic | modern } × { no AdMatix | with
AdMatix gate }. Measures whether the AdMatix gate improves real (incremental)
spend efficiency vs the no-gate baseline.
"""

from __future__ import annotations

__version__ = "0.1.0"
