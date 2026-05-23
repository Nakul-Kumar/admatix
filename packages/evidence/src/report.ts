import { sha256 } from "@admatix/core";
import { AuditReport } from "@admatix/schemas";
import type { AuditReport as AuditReportT, Finding } from "@admatix/schemas";
import { budgetWasteDetector } from "./detectors/budget-waste.js";
import { creativeFatigueDetector } from "./detectors/creative-fatigue.js";
import { pacingDetector } from "./detectors/pacing.js";
import { supplyPathDetector } from "./detectors/supply-path.js";
import { trackingDetector } from "./detectors/tracking.js";
import type { Detector, DetectorInput } from "./index.js";
import { parseDetectorInput } from "./input.js";

const DIRECTIONAL_CAVEAT = "Platform-reported metrics are directional, not causal.";
const AUDIT_DETECTORS: Detector[] = [
  trackingDetector,
  pacingDetector,
  budgetWasteDetector,
  creativeFatigueDetector,
  supplyPathDetector,
];

export function runAudit(input: DetectorInput, window: string): AuditReportT {
  const parsed = parseDetectorInput(input);
  const findings = AUDIT_DETECTORS.flatMap((detector) => detector(parsed));
  const sortedFindings = [...findings].sort(compareFindings);
  const generatedAt = `${window.split("..")[1] ?? "1970-01-01"}T00:00:00.000Z`;
  return AuditReport.parse({
    report_id: `audit_${sha256({
      account_id: parsed.account.account_id,
      window,
      findings: sortedFindings.map((finding) => finding.finding_id),
    }).slice(0, 16)}`,
    account_id: parsed.account.account_id,
    window,
    findings: sortedFindings,
    total_estimated_waste: sortedFindings.reduce(
      (sum, finding) => sum + (finding.estimated_waste ?? 0),
      0,
    ),
    caveats: [DIRECTIONAL_CAVEAT],
    generated_at: generatedAt,
  });
}

function compareFindings(a: Finding, b: Finding): number {
  const severityRank = new Map([
    ["high", 0],
    ["medium", 1],
    ["low", 2],
    ["info", 3],
  ]);
  const severityDiff =
    (severityRank.get(a.severity) ?? 99) - (severityRank.get(b.severity) ?? 99);
  if (severityDiff !== 0) return severityDiff;
  const detectorDiff = a.detector.localeCompare(b.detector);
  if (detectorDiff !== 0) return detectorDiff;
  return a.entity_id.localeCompare(b.entity_id);
}
