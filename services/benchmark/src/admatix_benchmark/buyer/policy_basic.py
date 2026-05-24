"""BasicPolicyBuyer — a faithful deterministic implementation of the BASIC
skill pack (`skills/basic.md`).

This is what a naive AI media buyer pointed at a Google/Meta Ads dashboard
would do: scale what shows good reported ROAS, pause what shows poor
reported ROAS. It has access to exactly the same information the LLM gets;
the only difference is the LLM may exercise more nuanced judgment.

We use this policy to extend the seed count beyond what the LLM can afford
to drive directly. Per the prompt, the policy MUST optimize against the same
reported metrics the LLM sees — never against ground truth.
"""

from __future__ import annotations

from .base import AbstractBuyer, BuyerContext
from ..env import BuyerAction, CampaignReportedView


class BasicPolicyBuyer:
    name = "policy_basic"
    skill_tier = "basic"

    def decide(
        self,
        snapshot: list[CampaignReportedView],
        ctx: BuyerContext,
    ) -> list[BuyerAction]:
        actions: list[BuyerAction] = []
        for view in snapshot:
            # Paused campaigns stay paused — naive playbook trusts its prior call.
            if view.status == "paused":
                actions.append(
                    BuyerAction(
                        campaign_id=view.campaign_id,
                        action_type="hold",
                        rationale="campaign already paused; trust prior decision",
                    )
                )
                continue

            # No data yet (first decision day, before any spend): hold.
            if view.last_window_spend <= 0:
                actions.append(
                    BuyerAction(
                        campaign_id=view.campaign_id,
                        action_type="hold",
                        rationale="no spend yet; need a window of data",
                    )
                )
                continue

            roas = view.last_window_reported_roas
            if roas > 2.0:
                actions.append(
                    BuyerAction(
                        campaign_id=view.campaign_id,
                        action_type="scale_up",
                        delta_pct=30.0,
                        rationale=f"reported ROAS {roas:.2f} > 2.0; scale 30%",
                    )
                )
            elif roas < 1.0:
                actions.append(
                    BuyerAction(
                        campaign_id=view.campaign_id,
                        action_type="pause",
                        rationale=f"reported ROAS {roas:.2f} < 1.0; pause",
                    )
                )
            else:
                actions.append(
                    BuyerAction(
                        campaign_id=view.campaign_id,
                        action_type="hold",
                        rationale=f"reported ROAS {roas:.2f} in hold zone",
                    )
                )
        return actions


__all__ = ["BasicPolicyBuyer"]
