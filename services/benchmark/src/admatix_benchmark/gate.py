"""AdMatixGate — wraps the real `admatix_verifier` for scale-up gating.

For arms B and D, BEFORE a buyer's `scale_up` action is applied, the gate:
  1. Constructs a real H0 packet describing the hypothesis "this campaign
     has positive incremental lift in the prior period".
  2. Calls `admatix_verifier.app.verify(VerifyRequest)` in-process. This is
     the SAME verifier the rest of AdMatix uses — we do not reimplement it.
  3. Maps the verifier's verdict to one of:
       - lift_detected  -> allow the scale_up
       - inconclusive   -> rewrite scale_up to `hold` (do not scale yet)
       - no_effect      -> rewrite scale_up to `pause` (cut spend)
  4. Non-scale-up actions pass through unchanged. The gate does not stop
     pauses, holds, or scale-downs — those are the buyer's safe-side judgment
     and AdMatix should not override them.

The no-AdMatix gate (used by arms A and C) is a strict pass-through. Tests
verify that the gate type is the ONLY difference between A↔B and C↔D within
a skill tier.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Literal, Protocol

from admatix_verifier.app import verify as verifier_verify
from admatix_verifier.models import H0PacketSubset, VerifyRequest, VerifyResponse

from .env import BuyerAction, SimulatedAdAccountEnv


GateOutcome = Literal["applied", "held", "cut"]


@dataclass
class GateDecision:
    proposal: BuyerAction
    final_action: BuyerAction
    outcome: GateOutcome
    gate_invoked: bool
    reason: str
    verifier_verdict: str | None = None
    verifier_estimate: float | None = None
    verifier_ci: tuple[float, float] | None = None
    verifier_method: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "campaign_id": self.proposal.campaign_id,
            "action": self.proposal.action_type,
            "delta_pct": self.proposal.delta_pct,
            "final_action": self.final_action.action_type,
            "final_delta_pct": self.final_action.delta_pct,
            "gate_invoked": self.gate_invoked,
            "verifier_verdict": self.verifier_verdict,
            "verifier_estimate": self.verifier_estimate,
            "verifier_ci": list(self.verifier_ci) if self.verifier_ci else None,
            "verifier_method": self.verifier_method,
            "outcome": self.outcome,
            "reason": self.reason,
        }


class Gate(Protocol):
    arm_label: str

    def apply(
        self, proposals: Iterable[BuyerAction], env: SimulatedAdAccountEnv
    ) -> list[GateDecision]: ...


class PassThroughGate:
    """Used by arms A and C — every proposed action is applied as-is."""

    arm_label = "no_admatix"

    def apply(
        self, proposals: Iterable[BuyerAction], env: SimulatedAdAccountEnv
    ) -> list[GateDecision]:
        decisions: list[GateDecision] = []
        for action in proposals:
            decisions.append(
                GateDecision(
                    proposal=action,
                    final_action=action,
                    outcome="applied",
                    gate_invoked=False,
                    reason="no_gate",
                )
            )
        return decisions


@dataclass
class AdMatixGateConfig:
    """How aggressive the gate is. Defaults match the spirit of the AdMatix
    policy guard: scale-ups require positive evidence of real lift.

    `min_estimate_for_lift` is a floor: even if the verifier returns
    `lift_detected`, we treat estimates below this as `inconclusive` (e.g.
    a measured lift of +0.00001 with a tight CI is statistically real but
    not economically meaningful). The default is 0 so we don't second-guess
    the verifier on this axis.
    """

    min_estimate_for_lift: float = 0.0
    # Tenant/account context for the H0 packet (synthetic in the benchmark).
    tenant_id: str = "tenant_bench"
    account_ref: str = "account_bench"


class AdMatixGate:
    """Used by arms B and D — calls the real verifier before each scale-up."""

    arm_label = "with_admatix"

    def __init__(self, config: AdMatixGateConfig | None = None) -> None:
        self.config = config or AdMatixGateConfig()

    def apply(
        self, proposals: Iterable[BuyerAction], env: SimulatedAdAccountEnv
    ) -> list[GateDecision]:
        decisions: list[GateDecision] = []
        for action in proposals:
            if action.action_type != "scale_up":
                decisions.append(
                    GateDecision(
                        proposal=action,
                        final_action=action,
                        outcome="applied",
                        gate_invoked=False,
                        reason="non_scale_up_passthrough",
                    )
                )
                continue
            # Build an H0 packet for "this campaign has positive incremental lift".
            packet = H0PacketSubset(
                packet_id=f"pkt_{env.config.account_id}_{action.campaign_id}_d{env.day}",
                tenant_id=self.config.tenant_id,
                account_ref=self.config.account_ref,
                goal="maximize return on ad spend within budget",
                hypothesis=(
                    f"Scaling campaign {action.campaign_id} budget by "
                    f"{action.delta_pct}% will produce positive incremental "
                    "revenue vs the no-change counterfactual."
                ),
                causal_status="directional_until_lift_test",
                guardrails={"max_daily_budget_delta_pct": 50.0},
                evidence_refs=[f"simulator://{env.world_data_uri(action.campaign_id)}"],
            )
            req = VerifyRequest(
                packet=packet,
                data_uri=env.world_data_uri(action.campaign_id),
                metadata_uri=env.world_metadata_uri(action.campaign_id),
            )
            try:
                resp: VerifyResponse = verifier_verify(req)
            except Exception as exc:  # pragma: no cover — defensive
                decisions.append(
                    GateDecision(
                        proposal=action,
                        final_action=BuyerAction(
                            campaign_id=action.campaign_id,
                            action_type="hold",
                            rationale=f"gate_error: {exc}",
                        ),
                        outcome="held",
                        gate_invoked=True,
                        reason=f"verifier_exception:{type(exc).__name__}",
                    )
                )
                continue
            ci = (
                (resp.ci_low, resp.ci_high)
                if resp.ci_low is not None and resp.ci_high is not None
                else None
            )
            est = resp.estimate
            # Map verifier verdict → benchmark outcome.
            verdict = resp.verdict
            if verdict == "lift_detected" and (
                est is None or est >= self.config.min_estimate_for_lift
            ):
                decisions.append(
                    GateDecision(
                        proposal=action,
                        final_action=action,
                        outcome="applied",
                        gate_invoked=True,
                        reason="verifier_confirmed_lift",
                        verifier_verdict=verdict,
                        verifier_estimate=est,
                        verifier_ci=ci,
                        verifier_method=resp.method,
                    )
                )
            elif verdict == "no_effect":
                # Strong evidence of no real lift — cut the spend rather than
                # just holding. This is what an evidence-gated operator would
                # do: stop pouring money into a confirmed dud.
                decisions.append(
                    GateDecision(
                        proposal=action,
                        final_action=BuyerAction(
                            campaign_id=action.campaign_id,
                            action_type="pause",
                            rationale="verifier reported no_effect; cutting spend",
                        ),
                        outcome="cut",
                        gate_invoked=True,
                        reason="verifier_no_effect",
                        verifier_verdict=verdict,
                        verifier_estimate=est,
                        verifier_ci=ci,
                        verifier_method=resp.method,
                    )
                )
            else:
                # inconclusive (or lift_detected below the floor) → hold.
                # Holding preserves prior spend level; we do not scale up
                # without positive evidence, but we do not pull spend either.
                decisions.append(
                    GateDecision(
                        proposal=action,
                        final_action=BuyerAction(
                            campaign_id=action.campaign_id,
                            action_type="hold",
                            rationale="verifier inconclusive; not scaling without evidence",
                        ),
                        outcome="held",
                        gate_invoked=True,
                        reason="verifier_inconclusive",
                        verifier_verdict=verdict,
                        verifier_estimate=est,
                        verifier_ci=ci,
                        verifier_method=resp.method,
                    )
                )
        return decisions


__all__ = [
    "AdMatixGate",
    "AdMatixGateConfig",
    "Gate",
    "GateDecision",
    "GateOutcome",
    "PassThroughGate",
]
