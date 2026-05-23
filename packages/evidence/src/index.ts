import type {
  AuditReport,
  Campaign,
  CampaignDailyMetric,
  Finding,
  FirstPartyRevenueDaily,
  H0Packet,
  NormalizedMetrics,
  PlatformAccount,
} from "@admatix/schemas";
import { budgetWasteDetector } from "./detectors/budget-waste.js";
import { creativeFatigueDetector } from "./detectors/creative-fatigue.js";
import { pacingDetector } from "./detectors/pacing.js";
import { supplyPathDetector } from "./detectors/supply-path.js";
import { trackingDetector } from "./detectors/tracking.js";
import { buildH0Packets as buildPackets } from "./h0-builder.js";
import { runAudit as runAuditReport } from "./report.js";

export interface DetectorInput {
  account: PlatformAccount;
  campaigns: Campaign[];
  metrics: NormalizedMetrics[];
  daily: CampaignDailyMetric[];
  firstParty: FirstPartyRevenueDaily[];
}

export type Detector = (input: DetectorInput) => Finding[];

export const detectors: Record<string, Detector> = {
  tracking: trackingDetector,
  pacing: pacingDetector,
  budgetWaste: budgetWasteDetector,
  creativeFatigue: creativeFatigueDetector,
  supplyPath: supplyPathDetector,
};

export function runAudit(input: DetectorInput, window: string): AuditReport {
  return runAuditReport(input, window);
}

export function buildH0Packets(
  report: AuditReport,
  goal: string,
  tenantId: string,
): H0Packet[] {
  return buildPackets(report, goal, tenantId);
}

export { trackingDetector } from "./detectors/tracking.js";
export { pacingDetector } from "./detectors/pacing.js";
export { budgetWasteDetector } from "./detectors/budget-waste.js";
export { creativeFatigueDetector } from "./detectors/creative-fatigue.js";
export { supplyPathDetector } from "./detectors/supply-path.js";
