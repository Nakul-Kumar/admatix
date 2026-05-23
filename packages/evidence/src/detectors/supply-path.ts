import type { Finding } from "@admatix/schemas";
import type { DetectorInput } from "../index.js";
import { parseDetectorInput } from "../input.js";
import {
  booleanFromRaw,
  deterministicCreatedAt,
  DIRECTIONAL_CAUSAL_STATUS,
  findingId,
  metricEvidence,
  numberFromRaw,
  parseFinding,
  rowsByCampaign,
} from "./common.js";

export function supplyPathDetector(input: DetectorInput): Finding[] {
  const parsed = parseDetectorInput(input);
  const findings: Finding[] = [];

  for (const [campaignId, rows] of rowsByCampaign(parsed.daily)) {
    const flagged = rows.filter((row) => {
      const mfa = booleanFromRaw(row.raw, "mfa_flag") === true;
      const viewability = numberFromRaw(row.raw, "viewability");
      const ivtRate = numberFromRaw(row.raw, "ivt_rate");
      return mfa || (viewability !== null && viewability < 0.4) || (ivtRate !== null && ivtRate > 0.1);
    });
    const totalSpend = rows.reduce((sum, row) => sum + row.spend, 0);
    const flaggedSpend = flagged.reduce((sum, row) => sum + row.spend, 0);
    if (totalSpend === 0 || flaggedSpend / totalSpend < 0.25) continue;
    const latest = flagged.at(-1);
    if (!latest) continue;
    findings.push(
      parseFinding({
        finding_id: findingId("supply_path", campaignId, "mfa_low_viewability"),
        detector: "supply-path",
        severity: flaggedSpend / totalSpend >= 0.5 ? "high" : "medium",
        title: "Programmatic spend is concentrated in low-quality supply paths",
        description:
          `${Math.round((flaggedSpend / totalSpend) * 100)}% of spend is on MFA, low-viewability, or high-IVT supply paths.`,
        entity_id: campaignId,
        estimated_waste: flaggedSpend,
        evidence: flagged.slice(0, 3).map((row) => metricEvidence(row, "flagged_supply_path_spend", row.spend)),
        causal_status: DIRECTIONAL_CAUSAL_STATUS,
        created_at: deterministicCreatedAt(rows),
      }),
    );
  }

  return findings;
}
