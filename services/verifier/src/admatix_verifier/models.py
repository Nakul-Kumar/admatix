"""Pydantic v2 models for the AdMatix verifier HTTP surface.

These are the request/response contract WP-S consumes over HTTP. They are a
read-only mirror of the subset of `packages/schemas` the verifier needs;
the canonical contract lives in `packages/schemas/src/h0-packet.ts`.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


CausalStatusIn = Literal[
    "heuristic",
    "directional_until_lift_test",
    "experimental",
    "causal",
]

CausalStatusOut = Literal[
    "heuristic",
    "directional_until_lift_test",
    "experimental",
    "causal",
    "inconclusive",
]

MethodName = Literal[
    "guardrail_only",
    "bsts_synthetic_control",
    "cate_meta_learner",
    "geo_synthetic_control",
    "ope_ips_snips_dr",
]

Verdict = Literal["lift_detected", "no_effect", "inconclusive"]

WorldType = Literal[
    "clean_ab",
    "geo_structured",
    "confounded",
    "zero_lift_placebo",
]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    libs: dict[str, str]


class H0PacketSubset(BaseModel):
    """Read-only mirror of the H0 packet fields the verifier consumes.

    The canonical contract is `packages/schemas/src/h0-packet.ts`. This is not
    a redefinition — it is the subset of fields WP-R actually reads. Unknown
    fields are allowed so we accept future packet extensions without breaking.
    """

    model_config = ConfigDict(extra="allow")

    packet_id: str
    tenant_id: str
    account_ref: str
    goal: str
    hypothesis: str
    causal_status: CausalStatusIn
    guardrails: dict[str, Any] = Field(default_factory=dict)
    evidence_refs: list[str] = Field(default_factory=list)


class VerifyRequest(BaseModel):
    packet: H0PacketSubset
    data_uri: str
    metadata_uri: str | None = None
    action_log_uri: str | None = None
    hint: dict[str, Any] | None = None


class GuardrailRuleResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    rule_id: str
    predicate: str
    inputs: dict[str, Any] = Field(default_factory=dict)
    pass_: bool = Field(alias="pass")


class GuardrailProof(BaseModel):
    all_pass: bool
    rules: list[GuardrailRuleResult] = Field(default_factory=list)


class RejectedMethod(BaseModel):
    method: MethodName
    reason: str


class VerifyResponse(BaseModel):
    # The seven canonical fields from PROOF-WAVE-MASTER-PLAN §6.2.
    estimate: float | None
    ci_low: float | None
    ci_high: float | None
    method: MethodName
    causal_status: CausalStatusOut
    verdict: Verdict
    confounders: list[str] = Field(default_factory=list)

    # Required additional context.
    ci_level: float = 0.95
    guardrail_proof: GuardrailProof
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    rejected_methods: list[RejectedMethod] = Field(default_factory=list)
    packet_id: str
    tx_id: str


class SimulateRequest(BaseModel):
    world_type: WorldType
    params: dict[str, Any] = Field(default_factory=dict)
    seed: int = 17


class SimulateResponse(BaseModel):
    world_id: str
    world_type: str
    n_rows: int
    data_uri: str
    metadata_uri: str
    ground_truth: dict[str, Any]


class MethodResult(BaseModel):
    """Internal contract returned by each `methods/*.run` function.

    The router merges these into `VerifyResponse` — it never crosses the HTTP
    boundary as-is.
    """

    method: MethodName
    estimate: float | None
    ci_low: float | None
    ci_high: float | None
    ci_level: float = 0.95
    verdict: Verdict
    causal_status: CausalStatusOut
    confounders: list[str] = Field(default_factory=list)
    diagnostics: dict[str, Any] = Field(default_factory=dict)


__all__ = [
    "CausalStatusIn",
    "CausalStatusOut",
    "GuardrailProof",
    "GuardrailRuleResult",
    "H0PacketSubset",
    "HealthResponse",
    "MethodName",
    "MethodResult",
    "RejectedMethod",
    "SimulateRequest",
    "SimulateResponse",
    "Verdict",
    "VerifyRequest",
    "VerifyResponse",
    "WorldType",
]
