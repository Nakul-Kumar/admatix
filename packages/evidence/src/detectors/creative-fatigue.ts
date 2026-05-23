import type { CampaignDailyMetric, Finding } from "@admatix/schemas";
import type { DetectorInput } from "../index.js";
import { parseDetectorInput } from "../input.js";
import {
  avg,
  deterministicCreatedAt,
  DIRECTIONAL_CAUSAL_STATUS,
  findingId,
  metricEvidence,
  numberFromRaw,
  parseFinding,
  pctDelta,
  splitWindow,
  stringFromRaw,
} from "./common.js";

export function creativeFatigueDetector(input: DetectorInput): Finding[] {
  const parsed = parseDetectorInput(input);
  const grouped = new Map<string, CampaignDailyMetric[]>();
  for (const row of parsed.daily) {
    const creativeId = stringFromRaw(row.raw, "creative_id") ?? row.campaign_id;
    const current = grouped.get(creativeId) ?? [];
    current.push(row);
    grouped.set(creativeId, current);
  }

  const findings: Finding[] = [];
  for (const [creativeId, unsortedRows] of grouped) {
    const rows = [...unsortedRows].sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 8) continue;
    const { baseline, recent } = splitWindow(rows);
    const baselineCtr = rate(avg(baseline.map((row) => row.clicks)), avg(baseline.map((row) => row.impressions)));
    const recentCtr = rate(avg(recent.map((row) => row.clicks)), avg(recent.map((row) => row.impressions)));
    const baselineCvr = rate(avg(baseline.map((row) => row.conversions)), avg(baseline.map((row) => row.clicks)));
    const recentCvr = rate(avg(recent.map((row) => row.conversions)), avg(recent.map((row) => row.clicks)));
    const baselineFrequency = avg(baseline.map((row) => numberFromRaw(row.raw, "frequency") ?? 0));
    const recentFrequency = avg(recent.map((row) => numberFromRaw(row.raw, "frequency") ?? 0));
    const ctrDrop = pctDelta(recentCtr, baselineCtr);
    const cvrDrop = pctDelta(recentCvr, baselineCvr);
    const frequencyLift = recentFrequency - baselineFrequency;
    const latest = recent.at(-1);
    if (!latest || ctrDrop === null || cvrDrop === null) continue;

    if (recentFrequency >= 2.2 && frequencyLift >= 0.75 && ctrDrop <= -0.35 && cvrDrop <= -0.2) {
      findings.push(
        parseFinding({
          finding_id: findingId("creative_fatigue", creativeId, "frequency_ctr_cvr_decay"),
          detector: "creative-fatigue",
          severity: "medium",
          title: "Creative fatigue is degrading response",
          description:
            `Frequency climbed to ${recentFrequency.toFixed(2)} while CTR fell ${Math.round(Math.abs(ctrDrop) * 100)}% and CVR fell ${Math.round(Math.abs(cvrDrop) * 100)}%.`,
          entity_id: creativeId,
          estimated_waste: recent.reduce((sum, row) => sum + row.spend, 0),
          evidence: [
            metricEvidence(latest, "recent_frequency", recentFrequency),
            metricEvidence(latest, "recent_ctr", recentCtr),
            metricEvidence(latest, "recent_cvr", recentCvr),
          ],
          causal_status: DIRECTIONAL_CAUSAL_STATUS,
          created_at: deterministicCreatedAt(rows),
        }),
      );
    }
  }

  return findings;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}
