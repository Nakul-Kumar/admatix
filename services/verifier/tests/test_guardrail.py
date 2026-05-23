"""Acceptance test 2 — guardrail method."""

from __future__ import annotations

import json
from pathlib import Path

from admatix_verifier.methods import guardrail
from admatix_verifier.models import H0PacketSubset, VerifyRequest


def _action_log(tmp_path: Path, rows: list[dict]) -> str:
    path = tmp_path / "actions.jsonl"
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row) + "\n")
    return path.resolve().as_uri()


def _packet_with_guardrails(guardrails: dict) -> H0PacketSubset:
    return H0PacketSubset(
        packet_id="pkt_test",
        tenant_id="tenant_test",
        account_ref="fixture:test",
        goal="goal",
        hypothesis="hypothesis",
        causal_status="directional_until_lift_test",
        guardrails=guardrails,
        evidence_refs=["metric:test:1"],
    )


def test_guardrail_passes_when_under_caps(tmp_path):
    action_uri = _action_log(
        tmp_path,
        [
            {"spend": 24_000, "frequency": 1},
            {"spend": 24_210, "frequency": 2},
        ],
    )
    req = VerifyRequest(
        packet=_packet_with_guardrails({"budget_cap": 50_000, "freq_cap": 3}),
        data_uri="file:///dev/null",
        action_log_uri=action_uri,
    )
    proof = guardrail.run(req)
    assert proof.all_pass is True
    assert {rule.rule_id for rule in proof.rules} == {"budget_cap", "freq_cap"}
    for rule in proof.rules:
        assert rule.pass_ is True


def test_guardrail_fails_when_budget_exceeded(tmp_path):
    action_uri = _action_log(
        tmp_path,
        [
            {"spend": 30_000, "frequency": 1},
            {"spend": 30_000, "frequency": 2},
        ],
    )
    req = VerifyRequest(
        packet=_packet_with_guardrails({"budget_cap": 50_000, "freq_cap": 3}),
        data_uri="file:///dev/null",
        action_log_uri=action_uri,
    )
    proof = guardrail.run(req)
    assert proof.all_pass is False
    by_id = {rule.rule_id: rule for rule in proof.rules}
    assert by_id["budget_cap"].pass_ is False
    assert by_id["freq_cap"].pass_ is True


def test_guardrail_unknown_rule_does_not_silently_skip():
    req = VerifyRequest(
        packet=_packet_with_guardrails({"mystery_rule": 42}),
        data_uri="file:///dev/null",
        action_log_uri=None,
    )
    proof = guardrail.run(req)
    assert proof.all_pass is False
    assert proof.rules[0].rule_id == "mystery_rule"
    assert proof.rules[0].predicate == "unknown_rule"
    assert proof.rules[0].pass_ is False


def test_guardrail_geo_allowlist_blocks_unknown_geo(tmp_path):
    action_uri = _action_log(
        tmp_path,
        [
            {"geo": "US-CA"},
            {"geo": "US-NY"},
            {"geo": "US-WA"},
        ],
    )
    req = VerifyRequest(
        packet=_packet_with_guardrails({"geo_allowlist": ["US-CA", "US-NY"]}),
        data_uri="file:///dev/null",
        action_log_uri=action_uri,
    )
    proof = guardrail.run(req)
    rule = proof.rules[0]
    assert rule.rule_id == "geo_allowlist"
    assert rule.pass_ is False
    assert "US-WA" in rule.inputs["violations"]
