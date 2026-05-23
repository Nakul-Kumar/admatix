"""URI loaders for the verifier.

The simulator emits local `file://<abs path>` URIs. We accept those and bare
absolute paths. No other schemes are supported in this WP.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import pandas as pd


def _uri_to_path(uri: str) -> Path:
    if uri.startswith("file://"):
        parsed = urlparse(uri)
        # netloc is empty for absolute file:// URIs; the path holds the abs path.
        path = unquote(parsed.path)
        if os.name == "nt" and path.startswith("/") and len(path) >= 3 and path[2] == ":":
            path = path[1:]
        if os.name == "nt" and parsed.netloc not in {"", "localhost"}:
            path = f"//{parsed.netloc}{path}"
        return Path(path)
    path = Path(uri)
    if path.is_absolute():
        return path
    raise ValueError(
        f"unsupported URI {uri!r}: verifier accepts file:// or absolute paths only"
    )


def load_events(uri: str) -> pd.DataFrame:
    """Load a simulator-emitted events CSV into a typed DataFrame.

    Columns follow services/simulator/__init__.py: user_id, period, geo_id,
    age_band, device, recency, frequency, prior_conversions,
    baseline_propensity, treatment, outcome, revenue, tau. Optional columns
    (`logging_propensity`) may appear in synthetic OPE fixtures.
    """

    path = _uri_to_path(uri)
    if not path.exists():
        raise FileNotFoundError(f"events file not found: {path}")
    frame = pd.read_csv(path)
    numeric_cols = [
        "user_id",
        "period",
        "recency",
        "frequency",
        "prior_conversions",
        "baseline_propensity",
        "treatment",
        "outcome",
        "revenue",
        "tau",
        "logging_propensity",
    ]
    for col in numeric_cols:
        if col in frame.columns:
            frame[col] = pd.to_numeric(frame[col], errors="coerce")
    return frame


def load_metadata(uri: str | None) -> dict[str, Any] | None:
    """Load a simulator-emitted `metadata.json` if a URI is provided.

    Returns None when `uri is None` — verification still works without it,
    we just lose access to the recorded ground truth.
    """

    if uri is None:
        return None
    path = _uri_to_path(uri)
    if not path.exists():
        raise FileNotFoundError(f"metadata file not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_action_log(uri: str | None) -> list[dict[str, Any]]:
    """Load an action JSONL file. One JSON object per line."""

    if uri is None:
        return []
    path = _uri_to_path(uri)
    if not path.exists():
        raise FileNotFoundError(f"action log file not found: {path}")
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


__all__ = ["load_events", "load_metadata", "load_action_log"]
