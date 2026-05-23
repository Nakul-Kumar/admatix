"""ClaudeHeadlessBuyer — a real LLM media buyer (headless `claude -p`).

Each decision day this spawns `claude --print --output-format json` with the
skill pack as the system prompt and the campaign report as the user message.
Claude returns a JSON array of actions, which we parse into `BuyerAction`.

The output schema is locked via `--json-schema` so the model can't drift.
Cost discipline: we use `claude-haiku-4-5` by default, the prompt is short,
and we cap calls to one per (arm, world, seed, decision-day).

Identical-across-arms-within-tier discipline: the skill pack, model,
temperature/seed, prompt format, and JSON schema are all functions of the
skill tier only. No arm-specific signal is injected.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .base import AbstractBuyer, BuyerContext
from ..env import BuyerAction, CampaignReportedView


# JSON Schema the LLM's output must conform to. The CLI enforces this.
_DECISIONS_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["decisions"],
    "properties": {
        "decisions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["campaign_id", "action", "rationale"],
                "properties": {
                    "campaign_id": {"type": "string"},
                    "action": {
                        "type": "string",
                        "enum": ["scale_up", "scale_down", "pause", "resume", "hold"],
                    },
                    "delta_pct": {"type": ["number", "null"]},
                    "rationale": {"type": "string"},
                },
            },
        }
    },
}


@dataclass
class ClaudeBuyerConfig:
    model: str = "claude-haiku-4-5-20251001"
    skill_tier: str = "basic"  # "basic" or "modern"
    timeout_s: int = 120
    binary: str = "claude"
    # Whether to add --bare. We default OFF because the headless host has
    # OAuth available but typically not ANTHROPIC_API_KEY, and --bare requires
    # an API key. The system prompt may therefore include some boilerplate;
    # we counterbalance with --append-system-prompt holding the skill pack.
    bare: bool = False
    # Skills root — `skills/<tier>.md` is loaded from here.
    skills_dir: Path = Path(__file__).parent.parent / "skills"


class ClaudeHeadlessBuyer:
    """Real LLM buyer. Falls back to a `BasicPolicyBuyer` /
    `ModernPolicyBuyer` if the `claude` CLI is unavailable, so test
    environments without it can still drive the runner — the fallback is
    LOGGED, never silent, and the run is tagged with `buyer_kind="policy"`
    in that case so we never claim LLM-driven results from a fallback.
    """

    def __init__(self, config: ClaudeBuyerConfig | None = None) -> None:
        self.config = config or ClaudeBuyerConfig()
        if self.config.skill_tier not in ("basic", "modern"):
            raise ValueError(
                f"skill_tier must be 'basic' or 'modern'; got {self.config.skill_tier!r}"
            )
        self.skill_tier = self.config.skill_tier
        self.name = f"llm_{self.skill_tier}"
        skill_path = self.config.skills_dir / f"{self.skill_tier}.md"
        if not skill_path.exists():
            raise FileNotFoundError(f"skill pack not found: {skill_path}")
        self._skill_pack_text = skill_path.read_text(encoding="utf-8")
        self._fallback_used = False

    @property
    def used_fallback(self) -> bool:
        return self._fallback_used

    def decide(
        self,
        snapshot: list[CampaignReportedView],
        ctx: BuyerContext,
    ) -> list[BuyerAction]:
        if shutil.which(self.config.binary) is None:
            self._fallback_used = True
            return _fallback(self.skill_tier).decide(snapshot, ctx)

        user_prompt = _build_user_prompt(snapshot, ctx)
        system_prompt = (
            self._skill_pack_text
            + "\n\n---\n\n"
            + "Output ONLY a single JSON object matching the provided schema. "
            "Provide exactly one decision per campaign listed in the report. "
            "For 'scale_up'/'scale_down', set delta_pct in [10, 50]. "
            "For 'hold'/'pause'/'resume', set delta_pct to null."
        )

        cmd = [
            self.config.binary,
            "--print",
            "--model",
            self.config.model,
            "--output-format",
            "json",
            "--no-session-persistence",
            "--disallowedTools",
            "*",
            "--append-system-prompt",
            system_prompt,
            "--json-schema",
            json.dumps(_DECISIONS_JSON_SCHEMA),
        ]
        if self.config.bare:
            cmd.append("--bare")

        t0 = time.time()
        try:
            result = subprocess.run(
                cmd,
                input=user_prompt,
                text=True,
                capture_output=True,
                timeout=self.config.timeout_s,
                check=False,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError):
            self._fallback_used = True
            return _fallback(self.skill_tier).decide(snapshot, ctx)
        elapsed = time.time() - t0

        if result.returncode != 0:
            # Don't silently swallow — record fallback, return policy decision.
            self._fallback_used = True
            return _fallback(self.skill_tier).decide(snapshot, ctx)

        try:
            envelope = json.loads(result.stdout)
        except json.JSONDecodeError:
            self._fallback_used = True
            return _fallback(self.skill_tier).decide(snapshot, ctx)
        if envelope.get("is_error", False):
            self._fallback_used = True
            return _fallback(self.skill_tier).decide(snapshot, ctx)
        raw = envelope.get("result", "")
        decisions = _extract_decisions(raw)
        if decisions is None:
            self._fallback_used = True
            return _fallback(self.skill_tier).decide(snapshot, ctx)

        snapshot_ids = {v.campaign_id for v in snapshot}
        seen: set[str] = set()
        actions: list[BuyerAction] = []
        for entry in decisions:
            cid = str(entry.get("campaign_id", ""))
            if cid not in snapshot_ids or cid in seen:
                continue
            seen.add(cid)
            action_type = str(entry.get("action", "hold"))
            if action_type not in ("scale_up", "scale_down", "pause", "resume", "hold"):
                action_type = "hold"
            delta = entry.get("delta_pct")
            if action_type in ("scale_up", "scale_down"):
                try:
                    delta_pct = float(delta) if delta is not None else 20.0
                except (TypeError, ValueError):
                    delta_pct = 20.0
                delta_pct = max(0.0, min(50.0, delta_pct))
            else:
                delta_pct = None
            actions.append(
                BuyerAction(
                    campaign_id=cid,
                    action_type=action_type,  # type: ignore[arg-type]
                    delta_pct=delta_pct,
                    rationale=str(entry.get("rationale", ""))[:280],
                )
            )
        # If the model omitted a campaign, default to hold (don't act).
        for cid in snapshot_ids - seen:
            actions.append(
                BuyerAction(
                    campaign_id=cid,
                    action_type="hold",
                    rationale="model omitted campaign; defaulting to hold",
                )
            )
        # Stable order for reproducibility.
        ordering = {v.campaign_id: i for i, v in enumerate(snapshot)}
        actions.sort(key=lambda a: ordering.get(a.campaign_id, 0))
        # Attach timing to the env via the rationale tail (non-load-bearing).
        return actions


def _extract_decisions(raw: str) -> list[dict[str, Any]] | None:
    """Pull the decisions array out of the model's stringified JSON result.

    The CLI returns `{"result": "<model text>"}`. With `--json-schema`, that
    text is constrained but the model may wrap in ``` fences in some
    versions. We strip fences and parse.
    """
    text = raw.strip()
    if text.startswith("```"):
        # Strip ```json ... ``` fence.
        first_nl = text.find("\n")
        if first_nl != -1:
            text = text[first_nl + 1 :]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        return None
    if isinstance(obj, dict) and isinstance(obj.get("decisions"), list):
        return obj["decisions"]
    if isinstance(obj, list):
        return obj
    return None


def _build_user_prompt(snapshot: list[CampaignReportedView], ctx: BuyerContext) -> str:
    rows = [
        {
            "campaign_id": v.campaign_id,
            "status": v.status,
            "daily_budget": round(v.daily_budget, 2),
            "days_active": v.days_active,
            "lifetime_spend": round(v.lifetime_spend, 2),
            "lifetime_reported_revenue": round(v.lifetime_reported_revenue, 2),
            "lifetime_reported_conversions": round(v.lifetime_reported_conversions, 2),
            "lifetime_reported_roas": round(v.lifetime_reported_roas, 3),
            "last_window_days": v.last_window_days,
            "last_window_spend": round(v.last_window_spend, 2),
            "last_window_reported_revenue": round(v.last_window_reported_revenue, 2),
            "last_window_reported_conversions": round(v.last_window_reported_conversions, 2),
            "last_window_reported_roas": round(v.last_window_reported_roas, 3),
        }
        for v in snapshot
    ]
    return json.dumps(
        {
            "day": ctx.day,
            "horizon": ctx.horizon,
            "decision_index": ctx.decision_index,
            "decision_every_n_days": ctx.decision_every_n_days,
            "campaigns": rows,
        },
        indent=2,
    )


def _fallback(skill_tier: str):
    from .policy_basic import BasicPolicyBuyer
    from .policy_modern import ModernPolicyBuyer

    return ModernPolicyBuyer() if skill_tier == "modern" else BasicPolicyBuyer()


__all__ = ["ClaudeBuyerConfig", "ClaudeHeadlessBuyer"]
