import { sha256 } from "@admatix/core";
import { H0Packet } from "@admatix/schemas";
import type { AuditReport, Finding, H0Packet as H0PacketT } from "@admatix/schemas";

export function buildH0Packets(
  report: AuditReport,
  goal: string,
  tenantId: string,
): H0PacketT[] {
  const parsedReport = report;
  const candidates = parsedReport.findings.filter(
    (finding) => finding.severity === "high" || finding.severity === "medium",
  );
  return candidates.map((finding) =>
    H0Packet.parse({
      packet_id: packetId(parsedReport.report_id, finding),
      tenant_id: tenantId,
      goal,
      hypothesis: hypothesisFor(finding),
      null_hypothesis:
        `No intervention on ${finding.entity_id} will improve ${goal}; observed platform metrics may revert without action.`,
      baseline_window: parsedReport.window,
      success_metric: successMetricFor(finding),
      guardrails: {
        max_daily_budget_delta_pct: 0.2,
        min_mer: 1,
        requires_human_approval: true,
      },
      evidence: finding.evidence,
      causal_status: "directional_until_lift_test",
      proposal: {
        action: actionFor(finding),
        target_entity_id: finding.entity_id,
        params: paramsFor(finding),
        dry_run_only: true,
      },
      rollback: {
        method: rollbackMethodFor(finding),
        checkpoint_id: `checkpoint_${sha256({ report_id: parsedReport.report_id, finding_id: finding.finding_id }).slice(0, 12)}`,
      },
      approval: {
        status: "pending",
        required_role: "media_manager",
      },
      created_by_agent: "MediaAnalystAgent",
      created_at: parsedReport.generated_at,
      trace_id: `trace_${sha256({ report_id: parsedReport.report_id, finding_id: finding.finding_id }).slice(0, 16)}`,
    }),
  );
}

function packetId(reportId: string, finding: Finding): string {
  return `h0_${sha256({ reportId, finding_id: finding.finding_id }).slice(0, 16)}`;
}

function hypothesisFor(finding: Finding): string {
  if (finding.detector === "tracking") {
    return `Restoring tracking hygiene on ${finding.entity_id} will recover reported conversion visibility without relying on platform attribution as causal proof.`;
  }
  if (finding.detector === "pacing") {
    return `Constraining ${finding.entity_id} back to budget guardrails will reduce avoidable overspend while preserving conversion volume.`;
  }
  if (finding.detector === "budget-waste") {
    return `Reducing inefficient spend on ${finding.entity_id} will lower wasted spend while conversion volume remains inside guardrails.`;
  }
  if (finding.detector === "creative-fatigue") {
    return `Rotating fatigued creative ${finding.entity_id} will improve CTR and CVR directionally under spend guardrails.`;
  }
  return `Excluding low-quality supply paths for ${finding.entity_id} will reduce wasted programmatic spend under viewability guardrails.`;
}

function successMetricFor(finding: Finding): string {
  if (finding.detector === "tracking") return "conversion_tracking_recovery";
  if (finding.detector === "pacing") return "spend_vs_daily_budget";
  if (finding.detector === "creative-fatigue") return "ctr_cvr_recovery";
  if (finding.detector === "supply-path") return "viewable_spend_share";
  return "estimated_waste_reduction";
}

function actionFor(finding: Finding): string {
  if (finding.detector === "tracking") return "no_op";
  if (finding.detector === "creative-fatigue") return "creative_rotate";
  if (finding.detector === "supply-path") return "pause_entity";
  return "budget_shift";
}

function paramsFor(finding: Finding): Record<string, unknown> {
  if (finding.detector === "tracking") {
    return { required_fix: "restore_utm_or_tracking_template" };
  }
  if (finding.detector === "creative-fatigue") {
    return { rotation_reason: "frequency_ctr_cvr_decay" };
  }
  if (finding.detector === "supply-path") {
    return { exclusion_reason: "mfa_low_viewability_or_high_ivt" };
  }
  return { max_reduction_pct: 0.2, dry_run_reason: finding.title };
}

function rollbackMethodFor(finding: Finding): string {
  if (finding.detector === "creative-fatigue") return "restore_previous_creative_rotation";
  if (finding.detector === "tracking") return "restore_previous_tracking_template";
  if (finding.detector === "supply-path") return "restore_previous_supply_path_targets";
  return "restore_previous_budget";
}
