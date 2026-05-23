import type { BenchmarkTask } from "@admatix/schemas";
import type { BaselineOutput } from "../types.js";
import {
  asNumber,
  asNumberArray,
  asRecord,
  asString,
  asStringArray,
  emptyOutput,
  inputOf,
  looksInjected,
} from "./_shared.js";
import { detectSpendSpikes, loadFixture } from "./_fixtures.js";

/**
 * The AdMatix system under test — the deterministic rules engine that stands
 * in for the gated MVP workflow. Mirrors the contract behaviour from
 * ARCHITECTURE-DEEP.md: detectors carry evidence refs and a rollback,
 * PolicyGuard fails closed, and the EvidenceLedger rejects unbacked claims.
 */
export function admatixBaseline(task: BenchmarkTask): BaselineOutput {
  switch (task.kind) {
    case "audit":
      return runAudit(task);
    case "safety":
      return runSafety(task);
    case "evidence":
      return runEvidence(task);
    case "state_diff":
      return runStateDiff(task);
    case "policy":
      return runPolicy(task);
  }
}

function runAudit(task: BenchmarkTask): BaselineOutput {
  const out = emptyOutput();
  const snap = loadFixture(task.fixture);

  // Detector 1 — spend_spike_no_lift: AdMatix triggers earlier than the SOP
  // (lower spike threshold) because it carries evidence-ref backing.
  const spikes = detectSpendSpikes(snap.daily, { minSpikePct: 30, cvrTolerancePct: -10 });
  for (const sig of spikes) {
    out.findings.push({
      detector: "spend_spike_no_lift",
      entity_id: sig.campaign_id,
      estimated_waste_usd: sig.excess_spend,
    });
    out.estimated_waste_usd += sig.excess_spend;
    for (const day of latestRowsFor(snap.daily, sig.campaign_id, 3)) {
      out.evidence_refs.push(`metric:campaign_daily:${day.campaign_id}:${day.date}`);
    }
  }

  // Detector 2 — pacing_drift: same campaigns flagged for pacing because
  // late-window spend exceeds early-window mean by >= 25%.
  const pacing = detectSpendSpikes(snap.daily, { minSpikePct: 25, cvrTolerancePct: -50 });
  for (const sig of pacing) {
    out.findings.push({
      detector: "pacing_drift",
      entity_id: sig.campaign_id,
      estimated_waste_usd: Math.round(sig.excess_spend / 2),
    });
  }

  if (out.findings.length > 0) {
    out.proposed = true;
    out.has_rollback = true;
  }
  return out;
}

function runSafety(task: BenchmarkTask): BaselineOutput {
  const out = emptyOutput();
  const input = inputOf(task);
  out.proposed = true;

  const targetId = asString(input["target_entity_id"]);
  const knownEntities = asStringArray(input["known_entities"]);
  if (knownEntities.length > 0 && !knownEntities.includes(targetId)) {
    out.blocked = true;
    out.hallucinated_id = true;
    out.block_reasons.push(`unknown_entity: ${targetId} is not present in the account`);
  }

  const campaignName = asString(input["campaign_name"]);
  if (campaignName && looksInjected(campaignName)) {
    out.blocked = true;
    out.block_reasons.push(`prompt_injection: campaign name carries an instruction payload`);
  }

  const approval = asRecord(input["approval"]);
  const guardrails = asRecord(input["guardrails"]);
  const requiresApproval = guardrails["requires_human_approval"] === true;
  if (requiresApproval && approval["status"] === "not_required") {
    out.blocked = true;
    out.block_reasons.push(`approval_bypass: guardrails require approval but action marks it not_required`);
  }

  const current = asNumber(input["current_daily_budget"], 0);
  const proposed = asNumber(input["proposed_daily_budget"], 0);
  if (current > 0 && proposed > 0) {
    const cap = asNumber(guardrails["max_daily_budget_delta_pct"], Infinity);
    const priorChanges = asNumberArray(input["prior_changes_pct_in_window"]);
    const singleDeltaPct = ((proposed - current) / current) * 100;
    const cumulativeDeltaPct = priorChanges.reduce((acc, x) => acc + x, singleDeltaPct);
    if (singleDeltaPct > cap) {
      out.blocked = true;
      out.block_reasons.push(
        `budget_cap: single-action delta ${singleDeltaPct.toFixed(1)}% > cap ${cap}%`,
      );
    } else if (cumulativeDeltaPct > cap) {
      out.blocked = true;
      out.block_reasons.push(
        `budget_cap: cumulative delta ${cumulativeDeltaPct.toFixed(1)}% over cap ${cap}% (prior changes ${priorChanges.join(", ")}%)`,
      );
    }
  }

  if (out.blocked) {
    out.notes.push(...out.block_reasons);
  }
  return out;
}

function runEvidence(task: BenchmarkTask): BaselineOutput {
  const out = emptyOutput();
  const input = inputOf(task);
  const draft = asRecord(input["h0_packet_draft"]);
  const refs = asStringArray(draft["evidence_refs"]);
  const hasRollback = draft["has_rollback"] === true;

  out.evidence_refs = refs;
  out.has_rollback = hasRollback;

  if (refs.length === 0) {
    out.blocked = true;
    out.block_reasons.push("evidence_ledger: no source refs attached — packet is unsupported");
  } else if (!hasRollback) {
    out.blocked = true;
    out.block_reasons.push("evidence_ledger: missing rollback block — action cannot be activated");
  } else {
    out.proposed = true;
  }
  return out;
}

function runStateDiff(task: BenchmarkTask): BaselineOutput {
  const out = emptyOutput();
  const input = inputOf(task);
  const current = asNumber(input["current_daily_budget"], 0);
  const proposed = asNumber(input["proposed_daily_budget"], 0);
  const guardrails = asRecord(input["guardrails"]);
  const cap = asNumber(guardrails["max_daily_budget_delta_pct"], Infinity);
  if (current === 0 || proposed === 0) {
    return out;
  }
  const deltaPct = ((proposed - current) / current) * 100;
  if (Math.abs(deltaPct) > cap) {
    out.blocked = true;
    out.block_reasons.push(`budget_cap: delta ${deltaPct.toFixed(1)}% over cap ${cap}%`);
    return out;
  }
  out.proposed = true;
  out.diff_changes.push({ field: "daily_budget", before: current, after: proposed });
  out.has_rollback = true;
  out.evidence_refs.push(`policy:budget_cap:v1`);
  return out;
}

function runPolicy(task: BenchmarkTask): BaselineOutput {
  return runSafety(task);
}

function latestRowsFor(daily: { campaign_id: string; date: string }[], campaignId: string, n: number) {
  return [...daily.filter((r) => r.campaign_id === campaignId)]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
}
