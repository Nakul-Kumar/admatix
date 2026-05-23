import type { Finding } from "@admatix/schemas";
import type { DetectorInput } from "../index.js";
import { parseDetectorInput } from "../input.js";
import {
  avg,
  deterministicCreatedAt,
  DIRECTIONAL_CAUSAL_STATUS,
  findingId,
  metricEvidence,
  parseFinding,
  pctDelta,
  rowsByCampaign,
  splitWindow,
} from "./common.js";

export function budgetWasteDetector(input: DetectorInput): Finding[] {
  const parsed = parseDetectorInput(input);
  const findings: Finding[] = [];

  for (const [campaignId, rows] of rowsByCampaign(parsed.daily)) {
    if (rows.length < 6) continue;
    const { baseline, recent } = splitWindow(rows);
    const baselineSpend = avg(baseline.map((row) => row.spend));
    const recentSpend = avg(recent.map((row) => row.spend));
    const baselineConversions = avg(baseline.map((row) => row.conversions));
    const recentConversions = avg(recent.map((row) => row.conversions));
    const spendLift = pctDelta(recentSpend, baselineSpend);
    const conversionLift = pctDelta(recentConversions, baselineConversions);
    const latest = recent.at(-1);
    if (!latest) continue;

    if (
      spendLift !== null &&
      spendLift >= 0.25 &&
      (conversionLift === null || conversionLift <= 0.1)
    ) {
      const estimatedWaste = Math.max(0, recentSpend - baselineSpend) * recent.length;
      findings.push(
        parseFinding({
          finding_id: findingId("budget_waste", campaignId, "spend_spike_no_lift"),
          detector: "budget-waste",
          severity: estimatedWaste >= 500 ? "high" : "medium",
          title: "Spend increased without conversion lift",
          description:
            `Spend rose ${Math.round(spendLift * 100)}% while conversions stayed flat or declined, making platform-attributed efficiency directional only.`,
          entity_id: campaignId,
          estimated_waste: estimatedWaste,
          evidence: [
            metricEvidence(baseline[0] ?? latest, "baseline_spend_per_day", baselineSpend),
            metricEvidence(latest, "recent_spend_per_day", recentSpend),
            metricEvidence(latest, "recent_conversions_per_day", recentConversions),
          ],
          causal_status: DIRECTIONAL_CAUSAL_STATUS,
          created_at: deterministicCreatedAt(rows),
        }),
      );
    }

    const baselineCac = baselineConversions > 0 ? baselineSpend / baselineConversions : null;
    const recentCac = recentConversions > 0 ? recentSpend / recentConversions : null;
    if (baselineCac !== null && recentCac !== null) {
      const cacLift = pctDelta(recentCac, baselineCac);
      if (cacLift !== null && cacLift >= 0.3) {
        findings.push(
          parseFinding({
            finding_id: findingId("budget_waste", campaignId, "high_cac"),
            detector: "budget-waste",
            severity: cacLift >= 0.5 ? "high" : "medium",
            title: "CAC deteriorated materially",
            description:
              `Recent CAC is ${Math.round(cacLift * 100)}% higher than the baseline window.`,
            entity_id: campaignId,
            estimated_waste: Math.max(0, recentCac - baselineCac) * recentConversions * recent.length,
            evidence: [
              metricEvidence(baseline[0] ?? latest, "baseline_cac", baselineCac),
              metricEvidence(latest, "recent_cac", recentCac),
            ],
            causal_status: DIRECTIONAL_CAUSAL_STATUS,
            created_at: deterministicCreatedAt(rows),
          }),
        );
      }
    }
  }

  return findings;
}
