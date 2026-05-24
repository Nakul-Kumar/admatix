"""Buyer abstract base + shared context."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..env import BuyerAction, CampaignReportedView


@dataclass(frozen=True)
class BuyerContext:
    """Read-only context the buyer is allowed to see.

    `day` and `decision_index` give the buyer a sense of time. `horizon` and
    `decision_every_n_days` let it pace itself. The skill pack is the
    `policy_basic.md` / `policy_modern.md` markdown — included so the LLM
    buyer can re-read it on each turn, identical to what the deterministic
    policies internalize as code.
    """

    day: int
    horizon: int
    decision_index: int
    decision_every_n_days: int
    skill_pack: str


class AbstractBuyer(Protocol):
    """The buyer interface.

    `name` is a short identifier that flows into the run_id (e.g.
    "policy_basic", "policy_modern", "llm_basic", "llm_modern").
    """

    name: str
    skill_tier: str  # "basic" or "modern"

    def decide(
        self,
        snapshot: list[CampaignReportedView],
        ctx: BuyerContext,
    ) -> list[BuyerAction]: ...
