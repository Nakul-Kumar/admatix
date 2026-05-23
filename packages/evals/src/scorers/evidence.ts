import type { BenchmarkResult, BenchmarkTask } from "@admatix/schemas";
import type { Scorer } from "../types.js";
import { asBaselineOutput } from "./_shared.js";

/**
 * Scores audit and evidence tasks. Two responsibilities:
 *   - audit: did the system surface the planted waste with evidence_refs and
 *     a rollback? Score is the fraction of expected detectors found, weighted
 *     by whether the estimated waste threshold was met.
 *   - evidence: did the EvidenceLedger accept/reject the draft packet as
 *     expected? Coverage flags propagate to the result either way.
 */
export const evidenceScorer: Scorer = {
  id: "evidence",
  score(task: BenchmarkTask, output: unknown): Partial<BenchmarkResult> {
    const out = asBaselineOutput(output);
    if (task.kind === "evidence") return scoreEvidenceTask(task, out);
    if (task.kind === "audit") return scoreAuditTask(task, out);
    return { task_id: task.task_id };
  },
};

function scoreEvidenceTask(
  task: BenchmarkTask,
  out: ReturnType<typeof asBaselineOutput>,
): Partial<BenchmarkResult> {
  const shouldReject = task.expected["should_reject"] === true;
  const rejected = out.blocked || !out.proposed;
  const passed = shouldReject ? rejected : !rejected;
  const score = passed ? 1 : 0;
  const evidenceCoverage = out.evidence_refs.length > 0 ? 1 : 0;
  const rollbackCoverage = out.has_rollback ? 1 : 0;
  const notes: string[] = [];
  if (shouldReject && !rejected) {
    notes.push("evidence: unsupported draft was accepted by the system");
  } else if (shouldReject && rejected) {
    notes.push(...out.block_reasons.map((r) => `evidence: rejected — ${r}`));
  } else if (!shouldReject && rejected) {
    notes.push(`evidence: well-formed draft was rejected — ${out.block_reasons.join("; ")}`);
  }
  return {
    task_id: task.task_id,
    passed,
    score,
    evidence_coverage: evidenceCoverage,
    rollback_coverage: rollbackCoverage,
    notes,
  };
}

function scoreAuditTask(
  task: BenchmarkTask,
  out: ReturnType<typeof asBaselineOutput>,
): Partial<BenchmarkResult> {
  const expectedDetectors = Array.isArray(task.expected["expected_finding_detectors"])
    ? (task.expected["expected_finding_detectors"] as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : [];
  const expectedEntity = typeof task.expected["expected_entity_id"] === "string" ? (task.expected["expected_entity_id"] as string) : "";
  const wasteFloor = typeof task.expected["planted_waste_min_usd"] === "number" ? (task.expected["planted_waste_min_usd"] as number) : 0;

  const detectorsFound = expectedDetectors.filter((d) =>
    out.findings.some((f) => f.detector === d && (expectedEntity === "" || f.entity_id === expectedEntity)),
  );
  const wasteMet = out.estimated_waste_usd >= wasteFloor;
  const denom = Math.max(expectedDetectors.length, 1);
  const detectorCoverage = detectorsFound.length / denom;
  const score = expectedDetectors.length === 0 ? (wasteMet ? 1 : 0) : detectorCoverage * (wasteMet ? 1 : 0.5);
  const passed = detectorCoverage === 1 && wasteMet;
  const evidenceCoverage = out.findings.length === 0 ? 0 : out.evidence_refs.length > 0 ? 1 : 0;
  const rollbackCoverage = out.findings.length === 0 ? 0 : out.has_rollback ? 1 : 0;

  const notes: string[] = [];
  if (!wasteMet) {
    notes.push(
      `audit: estimated waste $${out.estimated_waste_usd.toFixed(2)} below planted floor $${wasteFloor.toFixed(2)}`,
    );
  }
  for (const d of expectedDetectors) {
    if (!detectorsFound.includes(d)) notes.push(`audit: expected detector "${d}" did not fire`);
  }
  return {
    task_id: task.task_id,
    passed,
    score,
    evidence_coverage: evidenceCoverage,
    rollback_coverage: rollbackCoverage,
    notes,
  };
}
