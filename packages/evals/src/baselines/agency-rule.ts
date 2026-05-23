import type { BenchmarkTask } from "@admatix/schemas";
import type { BaselineOutput } from "../types.js";
import { emptyOutput, inputOf, asNumber, asRecord } from "./_shared.js";
import { detectSpendSpikes, loadFixture } from "./_fixtures.js";

/**
 * The scripted "competent human SOP" baseline: deterministic rules a media
 * agency would run as a Monday checklist. It catches the blatant cases but
 * does not produce H0 packets, does not handle subtle policy evasions, and
 * is blind to prompt injection.
 */
export function agencyRuleBaseline(task: BenchmarkTask): BaselineOutput {
  switch (task.kind) {
    case "audit":
      return auditAgencyRule(task);
    case "safety":
      return safetyAgencyRule(task);
    case "evidence":
      return evidenceAgencyRule(task);
    case "state_diff":
      return stateDiffAgencyRule(task);
    case "policy":
      return policyAgencyRule(task);
  }
}

function auditAgencyRule(task: BenchmarkTask): BaselineOutput {
  const out = emptyOutput();
  const snap = loadFixture(task.fixture);
  // SOP: flag campaigns whose late-window spend rose >= 30% with any CVR
  // softness. Lower-rigor than AdMatix and lacks the pacing_drift detector,
  // so it catches the obvious spend spike but misses pacing-class findings.
  const spikes = detectSpendSpikes(snap.daily, { minSpikePct: 30, cvrTolerancePct: 0 });
  for (const sig of spikes) {
    out.findings.push({
      detector: "spend_spike_no_lift",
      entity_id: sig.campaign_id,
      estimated_waste_usd: sig.excess_spend,
    });
    out.estimated_waste_usd += sig.excess_spend;
  }
  if (out.findings.length > 0) {
    out.notes.push(`agencyRule: surfaced ${out.findings.length} spike(s) but did not draft H0 packets`);
  }
  // Agency rule does not draft H0 packets, so no evidence_refs and no rollback.
  return out;
}

function safetyAgencyRule(task: BenchmarkTask): BaselineOutput {
  const out = emptyOutput();
  const input = inputOf(task);
  const guardrails = asRecord(input["guardrails"]);
  const cap = asNumber(guardrails["max_daily_budget_delta_pct"], Infinity);
  const current = asNumber(input["current_daily_budget"], 0);
  const proposed = asNumber(input["proposed_daily_budget"], 0);
  const deltaPct = current === 0 ? Infinity : ((proposed - current) / current) * 100;

  out.proposed = true;
  // The SOP only checks the single-action delta against the cap. Anything else
  // — split-cap evasion, hallucinated ids, approval bypass, prompt injection —
  // it does not see.
  if (deltaPct > cap) {
    out.blocked = true;
    out.block_reasons.push(`budget_cap: single-action delta ${deltaPct.toFixed(1)}% > cap ${cap}%`);
  }
  return out;
}

function evidenceAgencyRule(_task: BenchmarkTask): BaselineOutput {
  // The SOP does not register hypotheses, so it neither accepts nor rejects
  // H0 packet drafts. Treat as "no proposal made".
  const out = emptyOutput();
  out.notes.push("agencyRule: no H0 packet workflow");
  return out;
}

function stateDiffAgencyRule(task: BenchmarkTask): BaselineOutput {
  const out = emptyOutput();
  const input = inputOf(task);
  const current = asNumber(input["current_daily_budget"], 0);
  const proposed = asNumber(input["proposed_daily_budget"], 0);
  if (current !== proposed) {
    out.proposed = true;
    out.diff_changes.push({ field: "daily_budget", before: current, after: proposed });
  }
  return out;
}

function policyAgencyRule(task: BenchmarkTask): BaselineOutput {
  return safetyAgencyRule(task);
}
