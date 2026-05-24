"""ModernPolicyBuyer — a faithful deterministic implementation of the MODERN
skill pack (`skills/modern.md`).

Same input contract as `BasicPolicyBuyer`. The judgment differs.
"""

from __future__ import annotations

from .base import AbstractBuyer, BuyerContext
from ..env import BuyerAction, CampaignReportedView


class ModernPolicyBuyer:
    name = "policy_modern"
    skill_tier = "modern"

    MIN_DAYS_FOR_SCALE = 14
    MIN_CONVERSIONS_TO_ACT = 3
    PAUSE_ROAS_THRESHOLD = 1.5
    SCALE_UP_PCT = 20.0
    SCALE_LIFETIME_ROAS = 3.0
    SCALE_WINDOW_ROAS = 2.5

    def decide(
        self,
        snapshot: list[CampaignReportedView],
        ctx: BuyerContext,
    ) -> list[BuyerAction]:
        actions: list[BuyerAction] = []
        for view in snapshot:
            if view.status == "paused":
                # Modern playbook: do not churn. Stay paused.
                actions.append(
                    BuyerAction(
                        campaign_id=view.campaign_id,
                        action_type="hold",
                        rationale="paused; modern playbook avoids churn",
                    )
                )
                continue

            if view.last_window_spend <= 0:
                actions.append(
                    BuyerAction(
                        campaign_id=view.campaign_id,
                        action_type="hold",
                        rationale="no spend in window; need data",
                    )
                )
                continue

            # Rule 1: too early to act.
            if view.days_active < self.MIN_DAYS_FOR_SCALE:
                actions.append(
                    BuyerAction(
                        campaign_id=view.campaign_id,
                        action_type="hold",
                        rationale=(
                            f"only {view.days_active}d active; need "
                            f"{self.MIN_DAYS_FOR_SCALE}d before any move"
                        ),
                    )
                )
                continue

            # Rule 2: too few conversions to trust the signal.
            if view.last_window_reported_conversions < self.MIN_CONVERSIONS_TO_ACT:
                actions.append(
                    BuyerAction(
                        campaign_id=view.campaign_id,
                        action_type="hold",
                        rationale=(
                            f"{view.last_window_reported_conversions:.0f} conversions in "
                            f"window; sample too small to act"
                        ),
                    )
                )
                continue

            lifetime_roas = view.lifetime_reported_roas
            window_roas = view.last_window_reported_roas

            # Rule 3: two consecutive bad windows → cut.
            if (
                lifetime_roas < self.PAUSE_ROAS_THRESHOLD
                and window_roas < self.PAUSE_ROAS_THRESHOLD
            ):
                actions.append(
                    BuyerAction(
                        campaign_id=view.campaign_id,
                        action_type="pause",
                        rationale=(
                            f"lifetime ROAS {lifetime_roas:.2f} and window ROAS "
                            f"{window_roas:.2f} both below {self.PAUSE_ROAS_THRESHOLD}; pause"
                        ),
                    )
                )
                continue

            # Rule 4: consistent strong signal → scale modestly.
            if (
                lifetime_roas > self.SCALE_LIFETIME_ROAS
                and window_roas > self.SCALE_WINDOW_ROAS
            ):
                actions.append(
                    BuyerAction(
                        campaign_id=view.campaign_id,
                        action_type="scale_up",
                        delta_pct=self.SCALE_UP_PCT,
                        rationale=(
                            f"lifetime ROAS {lifetime_roas:.2f} > {self.SCALE_LIFETIME_ROAS} "
                            f"and window {window_roas:.2f} > {self.SCALE_WINDOW_ROAS}; "
                            f"scale {self.SCALE_UP_PCT:.0f}%"
                        ),
                    )
                )
                continue

            # Default: hold.
            actions.append(
                BuyerAction(
                    campaign_id=view.campaign_id,
                    action_type="hold",
                    rationale=(
                        f"reported ROAS {window_roas:.2f}, lifetime {lifetime_roas:.2f}; "
                        "neither a clear scale nor a clear cut — hold"
                    ),
                )
            )
        return actions


__all__ = ["ModernPolicyBuyer"]
