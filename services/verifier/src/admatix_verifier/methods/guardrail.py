"""Layer (a) — Deterministic guardrail-compliance proof.

Walks the action log against the H0 packet's declared guardrails and returns a
structured proof: one rule per declared guardrail key. No statistics, no
external libraries. Always runs.
"""

from __future__ import annotations

from typing import Any, Callable

from ..loaders import load_action_log
from ..models import GuardrailProof, GuardrailRuleResult, VerifyRequest


def _sum_field(actions: list[dict[str, Any]], key: str) -> float:
    total = 0.0
    for action in actions:
        value = action.get(key)
        if isinstance(value, (int, float)):
            total += float(value)
    return total


def _max_field(actions: list[dict[str, Any]], key: str) -> float:
    best = 0.0
    for action in actions:
        value = action.get(key)
        if isinstance(value, (int, float)):
            best = max(best, float(value))
    return best


def _min_field(actions: list[dict[str, Any]], key: str) -> float | None:
    best: float | None = None
    for action in actions:
        value = action.get(key)
        if isinstance(value, (int, float)):
            best = float(value) if best is None else min(best, float(value))
    return best


def _all_in(actions: list[dict[str, Any]], key: str, allow: list[str]) -> tuple[bool, list[str]]:
    seen: set[str] = set()
    for action in actions:
        value = action.get(key)
        if isinstance(value, str):
            seen.add(value)
    violations = sorted(v for v in seen if v not in set(allow))
    return (len(violations) == 0, violations)


def _rule_budget_cap(limit: float, actions: list[dict[str, Any]]) -> GuardrailRuleResult:
    total = _sum_field(actions, "spend")
    return GuardrailRuleResult(
        rule_id="budget_cap",
        predicate="total_spend<=limit",
        inputs={"limit": limit, "total_spend": total, "n_actions": len(actions)},
        **{"pass": total <= limit},
    )


def _rule_freq_cap(limit: float, actions: list[dict[str, Any]]) -> GuardrailRuleResult:
    observed = _max_field(actions, "frequency")
    return GuardrailRuleResult(
        rule_id="freq_cap",
        predicate="max_frequency<=limit",
        inputs={"limit": limit, "max_frequency": observed},
        **{"pass": observed <= limit},
    )


def _rule_pacing_min(limit: float, actions: list[dict[str, Any]]) -> GuardrailRuleResult:
    observed = _min_field(actions, "pacing")
    ok = observed is None or observed >= limit
    return GuardrailRuleResult(
        rule_id="pacing_min",
        predicate="min_pacing>=limit",
        inputs={"limit": limit, "min_pacing": observed},
        **{"pass": ok},
    )


def _rule_pacing_max(limit: float, actions: list[dict[str, Any]]) -> GuardrailRuleResult:
    observed = _max_field(actions, "pacing")
    ok = observed <= limit
    return GuardrailRuleResult(
        rule_id="pacing_max",
        predicate="max_pacing<=limit",
        inputs={"limit": limit, "max_pacing": observed},
        **{"pass": ok},
    )


def _rule_geo_allowlist(allow: list[str], actions: list[dict[str, Any]]) -> GuardrailRuleResult:
    ok, violations = _all_in(actions, "geo", allow)
    return GuardrailRuleResult(
        rule_id="geo_allowlist",
        predicate="every_geo_in_allowlist",
        inputs={"allow": allow, "violations": violations},
        **{"pass": ok},
    )


def _rule_audience_allowlist(allow: list[str], actions: list[dict[str, Any]]) -> GuardrailRuleResult:
    ok, violations = _all_in(actions, "audience", allow)
    return GuardrailRuleResult(
        rule_id="audience_allowlist",
        predicate="every_audience_in_allowlist",
        inputs={"allow": allow, "violations": violations},
        **{"pass": ok},
    )


_DISPATCH: dict[str, Callable[[Any, list[dict[str, Any]]], GuardrailRuleResult]] = {
    "budget_cap": _rule_budget_cap,
    "freq_cap": _rule_freq_cap,
    "pacing_min": _rule_pacing_min,
    "pacing_max": _rule_pacing_max,
    "geo_allowlist": _rule_geo_allowlist,
    "audience_allowlist": _rule_audience_allowlist,
}


def run(req: VerifyRequest) -> GuardrailProof:
    """Evaluate every declared guardrail against the action log.

    Unknown rule keys yield a `pass=False, predicate="unknown_rule"` row
    rather than silently skipping — the verifier is strict about novel
    constraints to keep the proof complete.
    """

    actions = load_action_log(req.action_log_uri)
    rules: list[GuardrailRuleResult] = []
    for key, value in req.packet.guardrails.items():
        handler = _DISPATCH.get(key)
        if handler is None:
            rules.append(
                GuardrailRuleResult(
                    rule_id=key,
                    predicate="unknown_rule",
                    inputs={"declared_value": value},
                    **{"pass": False},
                )
            )
            continue
        rules.append(handler(value, actions))
    return GuardrailProof(all_pass=all(r.pass_ for r in rules), rules=rules)


__all__ = ["run"]
