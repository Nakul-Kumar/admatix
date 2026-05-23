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
  pctDelta,
  rowsByCampaign,
  splitWindow,
} from "./common.js";

export function trackingDetector(input: DetectorInput): Finding[] {
  const parsed = parseDetectorInput(input);
  const campaignsById = new Map(parsed.campaigns.map((campaign) => [campaign.campaign_id, campaign]));
  const findings: Finding[] = [];

  for (const [campaignId, rows] of rowsByCampaign(parsed.daily)) {
    if (rows.length < 6) continue;
    const campaign = campaignsById.get(campaignId);
    const { baseline, recent } = splitWindow(rows);
    const baselineConversions = avg(baseline.map((row) => row.conversions));
    const recentConversions = avg(recent.map((row) => row.conversions));
    const baselineClicks = avg(baseline.map((row) => row.clicks));
    const recentClicks = avg(recent.map((row) => row.clicks));
    const baselineSpend = avg(baseline.map((row) => row.spend));
    const recentSpend = avg(recent.map((row) => row.spend));

    const conversionDrop = pctDelta(recentConversions, baselineConversions);
    const clicksStable = Math.abs(pctDelta(recentClicks, baselineClicks) ?? 0) <= 0.15;
    const spendStable = Math.abs(pctDelta(recentSpend, baselineSpend) ?? 0) <= 0.15;
    const raw = campaign?.raw;
    const finalUrl = typeof raw?.["final_url"] === "string" ? raw["final_url"] : "";
    const template = typeof raw?.["tracking_template"] === "string" ? raw["tracking_template"] : "";
    const utmPattern = raw?.["utm_pattern_present"];
    const missingUtm = utmPattern === false || (!finalUrl.includes("utm_") && !template.includes("utm_"));

    if (conversionDrop !== null && conversionDrop <= -0.6 && clicksStable && spendStable && missingUtm) {
      const latest = recent.at(-1);
      if (!latest) continue;
      findings.push(
        parseFinding({
          finding_id: findingId("tracking", campaignId, "conversion_drop_missing_utm"),
          detector: "tracking",
          severity: "high",
          title: "Tracking likely broke after conversion collapse",
          description:
            `Conversions fell ${Math.round(Math.abs(conversionDrop) * 100)}% while clicks and spend stayed stable, and campaign tracking metadata has no UTM pattern.`,
          entity_id: campaignId,
          estimated_waste: recent.reduce((sum, row) => sum + row.spend, 0),
          evidence: [
            metricEvidence(baseline[0] ?? latest, "baseline_conversions_per_day", baselineConversions),
            metricEvidence(latest, "recent_conversions_per_day", recentConversions),
            ...(campaign ? [campaignEvidence(campaign)] : []),
          ],
          causal_status: DIRECTIONAL_CAUSAL_STATUS,
          created_at: deterministicCreatedAt(rows),
        }),
      );
    }
  }

  return findings;
}
