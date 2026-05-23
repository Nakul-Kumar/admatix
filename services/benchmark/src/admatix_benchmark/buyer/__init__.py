"""Buyer implementations.

A buyer takes a list of `CampaignReportedView` (and the current day index)
and returns a list of `BuyerAction`. The buyer NEVER sees ground-truth lift
and NEVER sees AdMatix gate state — it is identical across arms within a
skill tier.

Two implementations:
  * `policy_basic.BasicPolicyBuyer` / `policy_modern.ModernPolicyBuyer`:
    deterministic behavioral policies. Used to extend seed counts cheaply
    while preserving the same input/output contract a real LLM agent has.
  * `llm.ClaudeHeadlessBuyer`: a real LLM agent (headless `claude -p`).
    Used on a representative arm×world×seed subset for the authentic
    decision log.
"""

from __future__ import annotations

from .base import AbstractBuyer, BuyerContext
from .policy_basic import BasicPolicyBuyer
from .policy_modern import ModernPolicyBuyer

__all__ = [
    "AbstractBuyer",
    "BasicPolicyBuyer",
    "BuyerContext",
    "ModernPolicyBuyer",
]
