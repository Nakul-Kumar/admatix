"""Tests for the deterministic buyer policies and the LLM buyer's parser."""

from __future__ import annotations

import json
import subprocess

from admatix_benchmark.buyer import BasicPolicyBuyer, ModernPolicyBuyer
from admatix_benchmark.buyer.base import BuyerContext
from admatix_benchmark.env import CampaignReportedView


def _ctx(day: int = 0) -> BuyerContext:
    return BuyerContext(
        day=day,
        horizon=28,
        decision_index=day // 7,
        decision_every_n_days=7,
        skill_pack="(test)",
    )


def _view(
    cid: str,
    *,
    roas_window: float,
    roas_lifetime: float | None = None,
    spend_window: float = 700.0,
    conv_window: float = 10.0,
    days_active: int = 14,
    status: str = "active",
) -> CampaignReportedView:
    return CampaignReportedView(
        campaign_id=cid,
        status=status,
        daily_budget=100.0,
        lifetime_spend=spend_window * 4,
        lifetime_reported_revenue=spend_window * 4 * (roas_lifetime or roas_window),
        lifetime_reported_conversions=40.0,
        lifetime_reported_roas=roas_lifetime or roas_window,
        last_window_days=7,
        last_window_spend=spend_window,
        last_window_reported_revenue=spend_window * roas_window,
        last_window_reported_conversions=conv_window,
        last_window_reported_roas=roas_window,
        days_active=days_active,
    )


def test_basic_buyer_scales_high_roas():
    buyer = BasicPolicyBuyer()
    actions = buyer.decide([_view("c1", roas_window=3.0)], _ctx(7))
    assert actions[0].action_type == "scale_up"
    assert actions[0].delta_pct == 30.0


def test_basic_buyer_pauses_low_roas():
    buyer = BasicPolicyBuyer()
    actions = buyer.decide([_view("c1", roas_window=0.5)], _ctx(7))
    assert actions[0].action_type == "pause"


def test_basic_buyer_holds_mid_roas():
    buyer = BasicPolicyBuyer()
    actions = buyer.decide([_view("c1", roas_window=1.5)], _ctx(7))
    assert actions[0].action_type == "hold"


def test_modern_buyer_holds_when_days_active_lt_14():
    buyer = ModernPolicyBuyer()
    # Strong-looking ROAS but only 7 days of data → hold.
    actions = buyer.decide(
        [_view("c1", roas_window=4.0, roas_lifetime=4.0, days_active=7)], _ctx(7)
    )
    assert actions[0].action_type == "hold"
    assert "active" in actions[0].rationale


def test_modern_buyer_holds_on_thin_conversion_volume():
    buyer = ModernPolicyBuyer()
    actions = buyer.decide(
        [_view("c1", roas_window=4.0, roas_lifetime=4.0, days_active=21, conv_window=2)],
        _ctx(21),
    )
    assert actions[0].action_type == "hold"


def test_modern_buyer_scales_on_consistent_strong_signal():
    buyer = ModernPolicyBuyer()
    actions = buyer.decide(
        [_view("c1", roas_window=3.0, roas_lifetime=3.5, days_active=21, conv_window=20)],
        _ctx(21),
    )
    assert actions[0].action_type == "scale_up"
    assert actions[0].delta_pct == 20.0


def test_modern_buyer_pauses_on_two_consecutive_bad_windows():
    buyer = ModernPolicyBuyer()
    actions = buyer.decide(
        [_view("c1", roas_window=0.8, roas_lifetime=1.0, days_active=21, conv_window=10)],
        _ctx(21),
    )
    assert actions[0].action_type == "pause"


def test_both_buyers_hold_with_no_window_spend():
    for buyer in (BasicPolicyBuyer(), ModernPolicyBuyer()):
        actions = buyer.decide(
            [_view("c1", roas_window=0.0, roas_lifetime=0.0, spend_window=0.0)], _ctx(0)
        )
        assert actions[0].action_type == "hold"


def test_buyer_returns_one_action_per_campaign():
    buyer = BasicPolicyBuyer()
    actions = buyer.decide(
        [_view("c1", roas_window=3.0), _view("c2", roas_window=0.5)], _ctx(7)
    )
    assert {a.campaign_id for a in actions} == {"c1", "c2"}


def test_llm_buyer_extract_decisions_strips_code_fence():
    from admatix_benchmark.buyer.llm import _extract_decisions

    raw = '```json\n{"decisions": [{"campaign_id": "c1", "action": "hold"}]}\n```'
    assert _extract_decisions(raw) == [{"campaign_id": "c1", "action": "hold"}]


def test_llm_buyer_extract_decisions_handles_bare_object():
    from admatix_benchmark.buyer.llm import _extract_decisions

    raw = '{"decisions": [{"campaign_id": "c1", "action": "scale_up", "delta_pct": 20}]}'
    out = _extract_decisions(raw)
    assert out and out[0]["action"] == "scale_up"


def test_llm_buyer_extract_decisions_returns_none_on_garbage():
    from admatix_benchmark.buyer.llm import _extract_decisions

    assert _extract_decisions("not even json") is None


def test_llm_buyer_omits_hanging_cli_json_schema_by_default(monkeypatch):
    from admatix_benchmark.buyer import llm
    from admatix_benchmark.buyer.llm import ClaudeBuyerConfig, ClaudeHeadlessBuyer

    captured: dict[str, list[str]] = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = list(cmd)
        return subprocess.CompletedProcess(
            cmd,
            0,
            stdout=json.dumps(
                {
                    "is_error": False,
                    "result": json.dumps(
                        {
                            "decisions": [
                                {
                                    "campaign_id": "c1",
                                    "action": "hold",
                                    "delta_pct": None,
                                    "rationale": "healthy enough to keep observing",
                                }
                            ]
                        }
                    ),
                }
            ),
        )

    monkeypatch.setattr(llm.shutil, "which", lambda binary: binary)
    monkeypatch.setattr(llm.subprocess, "run", fake_run)

    buyer = ClaudeHeadlessBuyer(ClaudeBuyerConfig(skill_tier="basic"))
    actions = buyer.decide([_view("c1", roas_window=2.0)], _ctx(7))

    assert actions[0].action_type == "hold"
    assert "--json-schema" not in captured["cmd"]


def test_llm_buyer_can_opt_into_cli_json_schema(monkeypatch):
    from admatix_benchmark.buyer import llm
    from admatix_benchmark.buyer.llm import ClaudeBuyerConfig, ClaudeHeadlessBuyer

    captured: dict[str, list[str]] = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = list(cmd)
        return subprocess.CompletedProcess(
            cmd,
            0,
            stdout=json.dumps(
                {
                    "is_error": False,
                    "result": json.dumps(
                        {
                            "decisions": [
                                {
                                    "campaign_id": "c1",
                                    "action": "hold",
                                    "delta_pct": None,
                                    "rationale": "schema flag enabled by operator",
                                }
                            ]
                        }
                    ),
                }
            ),
        )

    monkeypatch.setattr(llm.shutil, "which", lambda binary: binary)
    monkeypatch.setattr(llm.subprocess, "run", fake_run)

    buyer = ClaudeHeadlessBuyer(
        ClaudeBuyerConfig(skill_tier="basic", use_cli_json_schema=True)
    )
    actions = buyer.decide([_view("c1", roas_window=2.0)], _ctx(7))

    assert actions[0].action_type == "hold"
    assert "--json-schema" in captured["cmd"]
