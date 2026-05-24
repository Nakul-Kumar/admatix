"""Future-data leakage guards for benchmark-visible payloads."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


_FORBIDDEN_KEY_PARTS = (
    "future",
    "ground_truth",
    "true_iroas",
    "true_incremental",
    "revealed_world_label",
    "post_period",
    "next_window",
)


def assert_no_future_leakage(payload: Any, *, source: str) -> None:
    """Reject buyer/prompt/scoring payloads that expose future-looking fields.

    The benchmark's proof value depends on a hard boundary: buyers and prompts
    may see only reported metrics available at the current decision time. This
    guard intentionally checks names as well as the one semantic window invariant
    we expose (`last_window_days <= days_active`).
    """

    def walk(value: Any, path: str) -> None:
        if isinstance(value, Mapping):
            days_active = value.get("days_active")
            last_window_days = value.get("last_window_days")
            if (
                isinstance(days_active, (int, float))
                and isinstance(last_window_days, (int, float))
                and last_window_days > days_active
            ):
                raise ValueError(
                    f"{source} future-data leakage at {path}.last_window_days: "
                    "last_window_days cannot exceed days_active"
                )
            for key, child in value.items():
                key_text = str(key)
                lowered = key_text.lower()
                if any(part in lowered for part in _FORBIDDEN_KEY_PARTS):
                    raise ValueError(
                        f"{source} future-data leakage at {path}.{key_text}"
                    )
                walk(child, f"{path}.{key_text}")
        elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
            for idx, child in enumerate(value):
                walk(child, f"{path}[{idx}]")

    walk(payload, "$")


__all__ = ["assert_no_future_leakage"]
