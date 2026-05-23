import type { Finding } from "@admatix/schemas";
import type { DetectorInput } from "../index.js";
import { parseDetectorInput } from "../input.js";
import {
  avg,
  campaignEvidence,
  deterministicCreatedAt,
  DIRECTIONAL_CAUSAL_STATUS,
  findingId,
  metricEvidence,
  parseFinding,
  rowsByCampaign,
} from "./common.js";

export function pacingDetector(input: DetectorInput): Finding[] {
  const parsed = parseDetectorInput(input);
  const campaignsById = new Map(parsed.campaigns.map((campaign) => [campaign.campaign_id, campaign]));
  const findings: Finding[] = [];

  for (const [campaignId, rows] of rowsByCampaign(parsed.daily)) {
    const campaign = campaignsById.get(campaignId);
    const budget = campaign?.daily_budget;
    if (!campaign || budget === undefined || rows.length < 3) continue;
    const recent = rows.slice(-3);
    const recentSpend = avg(recent.map((row) => row.spend));
    const drift = (recentSpend - budget) / budget;
    if (Math.abs(drift) < 0.2) continue;
    const overspend = Math.max(0, recentSpend - budget) * recent.length;
    const latest = recent.at(-1);
    if (!latest) continue;
    findings.push(
      parseFinding({
        finding_id: findingId("pacing", campaignId, drift > 0 ? "over_budget" : "under_budget"),
        detector: "pacing",
        severity: Math.abs(drift) >= 0.35 ? "high" : "medium",
        title: drift > 0 ? "Campaign is pacing above daily budget" : "Campaign is pacing below daily budget",
        description:
          `Recent average spend is ${Math.round(Math.abs(drift) * 100)}% ${drift > 0 ? "above" : "below"} the configured daily budget.`,
        entity_id: campaignId,
        estimated_waste: overspend,
        evidence: [
          campaignEvidence(campaign),
          metricEvidence(latest, "recent_average_spend", recentSpend),
        ],
        causal_status: DIRECTIONAL_CAUSAL_STATUS,
        created_at: deterministicCreatedAt(rows),
      }),
    );
  }

  return findings;
}
