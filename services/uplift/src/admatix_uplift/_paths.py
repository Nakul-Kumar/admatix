from __future__ import annotations

import sys
from pathlib import Path


def add_sibling_sources() -> None:
    root = Path(__file__).resolve().parents[3]
    for relative in ("simulator/src", "verifier/src", "ingest/src"):
        candidate = root / relative
        if candidate.exists():
            value = str(candidate)
            if value not in sys.path:
                sys.path.insert(0, value)
