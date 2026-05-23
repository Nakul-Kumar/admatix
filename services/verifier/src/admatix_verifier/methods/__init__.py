"""Verification methods.

Each module exposes a single `run(...)` function that returns either a
`GuardrailProof` (for `guardrail`) or a `MethodResult` (for everything else).
"""

from __future__ import annotations

from . import bsts, cate, geo, guardrail, ope

__all__ = ["bsts", "cate", "geo", "guardrail", "ope"]
