"""Runner — execute one (arm × world × seed) and emit a decision timeline.

The runner is the only place where the buyer, the gate, and the env are
wired together. It enforces the honesty rules at the boundary:

  * The buyer's `decide` call only ever receives `reported_snapshot` —
    never ground truth.
  * The gate's `apply` call may freely look at the env's data uris (the
    verifier needs them) but never at the env's hidden truth view.
  * The env tracks both views and exposes ground truth only via
    `final_scores` and `ground_truth_snapshot` (which the runner records
    into the audit log, NOT back into the buyer).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

from .buyer import AbstractBuyer, BuyerContext
from .env import BuyerAction, EnvConfig, SimulatedAdAccountEnv
from .gate import Gate, GateDecision
from .leakage import assert_no_future_leakage


@dataclass
class ArmRunConfig:
    arm: str  # "A" | "B" | "C" | "D"
    skill_tier: str  # "basic" | "modern"
    gate_label: str  # "no_admatix" | "with_admatix"
    buyer_kind: str  # "policy" | "llm"
    world_type: str
    seed: int


@dataclass
class ScaleUpOutcome:
    """Per-proposal record used to attribute false/true scale-ups prevented."""

    proposal: BuyerAction
    gate_decision: GateDecision
    realised_true_iroas_at_day: float  # campaign's running iROAS at decision time


@dataclass
class RunResult:
    config: ArmRunConfig
    env_config_summary: dict[str, Any]
    decision_timeline: list[dict[str, Any]]
    final_scores: dict[str, Any]
    counts: dict[str, int]
    scale_up_outcomes: list[ScaleUpOutcome] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    row_kind: str = "policy"
    row_status: str = "completed"

    @property
    def run_id(self) -> str:
        c = self.config
        return (
            f"{c.arm}__{c.world_type}__seed={c.seed}__buyer={c.buyer_kind}"
            f"__tier={c.skill_tier}"
        )


def run_one(
    *,
    config: ArmRunConfig,
    env_config: EnvConfig,
    buyer: AbstractBuyer,
    gate: Gate,
    skill_pack_text: str,
    env_factory=SimulatedAdAccountEnv,
) -> RunResult:
    """Drive a single (arm × world × seed) run end to end.

    Returns a `RunResult` that contains everything needed for both the
    scorecard aggregation and the per-run decision timeline.
    """
    env = env_factory(env_config)
    timeline: list[dict[str, Any]] = []
    scale_up_outcomes: list[ScaleUpOutcome] = []
    counts = {
        "decisions": 0,
        "proposals": 0,
        "scale_up_proposals": 0,
        "scale_ups_applied": 0,
        "scale_ups_blocked_by_gate": 0,
        "false_scale_ups_prevented": 0,
        "true_scale_ups_prevented": 0,
        "pause_proposals": 0,
        "pauses_applied": 0,
    }
    decision_index = 0
    while not env.done:
        if env.is_decision_day:
            snapshot = env.reported_snapshot()
            assert_no_future_leakage(
                [view.to_dict() for view in snapshot],
                source="buyer reported_snapshot",
            )
            ctx = BuyerContext(
                day=env.day,
                horizon=env.horizon,
                decision_index=decision_index,
                decision_every_n_days=env_config.decision_every_n_days,
                skill_pack=skill_pack_text,
            )
            proposals = buyer.decide(snapshot, ctx)
            gate_decisions = gate.apply(proposals, env)
            # Record per-proposal counts.
            for prop, gdec in zip(proposals, gate_decisions):
                counts["proposals"] += 1
                if prop.action_type == "scale_up":
                    counts["scale_up_proposals"] += 1
                    # Capture the campaign's true_iroas at *decision time* —
                    # that's the right counterfactual for the "did the gate
                    # prevent a bad scale-up" question.
                    st = env.campaign_state(prop.campaign_id)
                    realised = st.true_iroas
                    scale_up_outcomes.append(
                        ScaleUpOutcome(
                            proposal=prop,
                            gate_decision=gdec,
                            realised_true_iroas_at_day=realised,
                        )
                    )
                    if gdec.outcome == "applied":
                        counts["scale_ups_applied"] += 1
                    else:
                        counts["scale_ups_blocked_by_gate"] += 1
                        # Was the scale-up "bad"? Use realised true_iroas at
                        # decision time as the ground-truth ledger; iroas <= 0
                        # = no incremental return on spend, so blocking
                        # prevented waste; iroas > 0 = blocking sacrificed
                        # some real lift (a cost of false-positive blocking).
                        if realised <= 0:
                            counts["false_scale_ups_prevented"] += 1
                        else:
                            counts["true_scale_ups_prevented"] += 1
                elif prop.action_type == "pause":
                    counts["pause_proposals"] += 1
                if gdec.final_action.action_type == "pause":
                    counts["pauses_applied"] += 1

            applied_actions = [gd.final_action for gd in gate_decisions]
            env.apply(applied_actions)

            timeline.append(
                {
                    "day": env.day,
                    "reported_snapshot": [v.to_dict() for v in snapshot],
                    "proposals": [
                        {
                            "campaign_id": p.campaign_id,
                            "action": p.action_type,
                            "delta_pct": p.delta_pct,
                            "rationale": p.rationale,
                        }
                        for p in proposals
                    ],
                    "gate_decisions": [gd.to_dict() for gd in gate_decisions],
                    "ground_truth_at_day": env.ground_truth_snapshot(),
                }
            )
            counts["decisions"] += 1
            decision_index += 1
        env.tick()

    final = env.final_scores()
    summary = {
        "account_id": env_config.account_id,
        "n_campaigns": len(env_config.campaigns),
        "n_periods": env.horizon,
        "decision_every_n_days": env_config.decision_every_n_days,
        "campaign_specs": [
            {
                "campaign_id": s.campaign_id,
                "world_type": s.world_type.value if hasattr(s.world_type, "value") else str(s.world_type),
                "true_lift": s.true_lift,
                "confound_strength": s.confound_strength,
                "revealed_world_label": s.revealed_world_label,
                "base_daily_budget": s.base_daily_budget,
                "n_users": s.n_users,
                "n_periods": s.n_periods,
            }
            for s in env_config.campaigns
        ],
    }
    return RunResult(
        config=config,
        env_config_summary=summary,
        decision_timeline=timeline,
        final_scores=final,
        counts=counts,
        scale_up_outcomes=scale_up_outcomes,
        row_kind="llm_real" if config.buyer_kind == "llm" else "policy",
        row_status="completed",
    )


def env_config_fingerprint(env_config: EnvConfig) -> str:
    """Stable hash of the env config — used to assert that A vs B (and C vs D)
    saw identical campaign worlds.
    """
    payload = {
        "account_id": env_config.account_id,
        "seed": env_config.seed,
        "decision_every_n_days": env_config.decision_every_n_days,
        "campaigns": [
            {
                "campaign_id": s.campaign_id,
                "world_type": s.world_type.value if hasattr(s.world_type, "value") else str(s.world_type),
                "true_lift": s.true_lift,
                "confound_strength": s.confound_strength,
                "base_daily_budget": s.base_daily_budget,
                "n_users": s.n_users,
                "n_periods": s.n_periods,
                "n_geos": s.n_geos,
                "treat_frac": s.treat_frac,
                "seasonality": s.seasonality,
                "noise_sd": s.noise_sd,
            }
            for s in env_config.campaigns
        ],
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


__all__ = [
    "ArmRunConfig",
    "RunResult",
    "ScaleUpOutcome",
    "env_config_fingerprint",
    "run_one",
]
