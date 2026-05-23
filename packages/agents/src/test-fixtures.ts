/**
 * Test-only helpers. Builds a small in-memory evidence layer (audit +
 * H0 packets) on top of `data/fixtures/google_ads/demo_campaigns.json`
 * so the orchestrator can be exercised before WP-D lands its real
 * detector + packet-builder. The shape mirrors `@admatix/evidence`
 * exactly so swapping in the production layer is a one-line change.
 *
 * NOT exported from `src/index.ts` — keep this internal to the package.
 */
import {
  AuditReport,
  H0Packet,
  type Finding,
  type NormalizedMetrics,
} from "@admatix/schemas";
import { newId, nowIso } from "@admatix/core";
import type { DetectorInput } from "@admatix/evidence";
import type { MediaAnalystDeps } from "./index.js";

function mkFinding(args: {
  detector: string;
  severity: Finding["severity"];
  campaign_id: string;
  account_id?: string;
  title: string;
  description: string;
  estimated_waste?: number;
}): Finding {
  const accountId = args.account_id ?? "acc_demo";
  return {
    finding_id: newId("find"),
    detector: args.detector,
    severity: args.severity,
    title: args.title,
    description: args.description,
    entity_id: args.campaign_id,
    estimated_waste: args.estimated_waste ?? 0,
    evidence: [
      {
        source: "google_ads_fixture",
        ref: `campaign:${accountId}:${args.campaign_id}`,
        entity_id: args.campaign_id,
      },
    ],
    causal_status: "directional_until_lift_test",
    created_at: nowIso(),
  };
}

function detectorRules(input: DetectorInput): Finding[] {
  const findings: Finding[] = [];
  for (const m of input.metrics) {
    if (m.scope !== "campaign") continue;
    const baseline = baselineFor(m, input);
    if (baseline === null) continue;
    const cacDelta =
      m.cac !== null && baseline.cac !== null && baseline.cac > 0
        ? (m.cac - baseline.cac) / baseline.cac
        : null;
    if (cacDelta !== null && cacDelta > 0.2) {
      findings.push(
        mkFinding({
          detector: "pacing",
          severity: "high",
          campaign_id: m.entity_id,
          title: "Spend spike with flat conversions",
          description: `CAC rose ${(cacDelta * 100).toFixed(0)}% vs baseline; pacing drift on ${m.entity_id}`,
          estimated_waste: Math.max(0, m.spend - (m.conversions * (baseline.cac ?? 0))),
        }),
      );
    }
    if (m.ctr !== null && m.ctr < 0.04) {
      findings.push(
        mkFinding({
          detector: "creativeFatigue",
          severity: "medium",
          campaign_id: m.entity_id,
          title: "Below-benchmark CTR",
          description: `CTR ${(m.ctr * 100).toFixed(2)}% trails the 4% benchmark for ${m.entity_id}`,
        }),
      );
    }
    if (m.spend > 0 && m.conversions === 0) {
      findings.push(
        mkFinding({
          detector: "budgetWaste",
          severity: "high",
          campaign_id: m.entity_id,
          title: "Spend without conversions",
          description: `Campaign ${m.entity_id} spent $${m.spend.toFixed(0)} with zero conversions`,
          estimated_waste: m.spend,
        }),
      );
    }
  }
  // Always emit a tracking-quality finding so we have ≥3 packets on the
  // demo fixture. We anchor the ref to a real campaign (the first one in
  // the input) so the EvidenceLedger resolver can find the row.
  const anchor = input.campaigns[0];
  if (input.account && anchor) {
    findings.push(
      mkFinding({
        detector: "tracking",
        severity: "low",
        campaign_id: anchor.campaign_id,
        account_id: anchor.account_id,
        title: "Tracking parity check",
        description: `Platform-reported revenue should be validated against first-party for ${input.account.account_id}`,
      }),
    );
  }
  return findings;
}

function baselineFor(
  m: NormalizedMetrics,
  _input: DetectorInput,
): { cac: number | null } | null {
  // For the MVP fixture, treat the per-campaign aggregate as both baseline
  // and observed — the rule above demands a positive CAC delta vs baseline,
  // so this never fires unless real evidence (B/C/D) supply richer windows.
  // We synthesize a baseline by halving the spend to surface at least one
  // pacing finding on Campaign A in the demo fixture.
  if (m.conversions === 0 || m.spend === 0) return { cac: null };
  return { cac: (m.spend / m.conversions) * 0.7 };
}

export function makeTestEvidenceDeps(): MediaAnalystDeps {
  return {
    runAudit: (input, window) => {
      const findings = detectorRules(input);
      return AuditReport.parse({
        report_id: newId("rep"),
        account_id: input.account.account_id,
        window,
        findings,
        total_estimated_waste: findings.reduce(
          (acc, f) => acc + (f.estimated_waste ?? 0),
          0,
        ),
        caveats: [
          "test_fixture_evidence_layer: production detectors land in WP-D",
        ],
        generated_at: nowIso(),
        fixture_version: "demo-2026-05-22",
      });
    },
    buildH0Packets: (report, goal, tenantId) => {
      return report.findings.map((f) => buildPacketFromFinding(f, goal, tenantId));
    },
  };
}

function buildPacketFromFinding(
  f: Finding,
  goal: string,
  tenantId: string,
): H0Packet {
  const isBudgetTouching = f.detector === "pacing" || f.detector === "budgetWaste";
  return H0Packet.parse({
    packet_id: newId("h0"),
    tenant_id: tenantId,
    goal,
    hypothesis: `Addressing ${f.title.toLowerCase()} on ${f.entity_id} will reduce waste`,
    null_hypothesis: `Addressing ${f.title.toLowerCase()} has no effect`,
    baseline_window: "2026-05-12..2026-05-21",
    success_metric: "cac",
    guardrails: {
      // Percent points: 15 means |delta_pct| <= 15%.
      max_daily_budget_delta_pct: 15,
      requires_human_approval: true,
    },
    evidence: f.evidence,
    causal_status: f.causal_status,
    proposal: {
      action: isBudgetTouching ? "budget_shift" : "no_op",
      target_entity_id: f.entity_id,
      params: isBudgetTouching ? { delta_pct: -10 } : {},
      dry_run_only: true,
    },
    rollback: {
      method: "restore_previous_budget",
      checkpoint_id: newId("ckpt"),
    },
    approval: {
      status: "pending",
      required_role: "approver",
    },
    created_by_agent: "media-analyst",
    created_at: nowIso(),
    trace_id: "trace_test",
  });
}

/** Builds a packet whose budget-shift breaches the 25% policy cap so the
 *  PolicyGuard gate is exercised. */
export function makeUnsafeEvidenceDeps(): MediaAnalystDeps {
  const base = makeTestEvidenceDeps();
  return {
    runAudit: base.runAudit,
    buildH0Packets: (report, goal, tenantId) => {
      const packets = (base.buildH0Packets ?? (() => []))(report, goal, tenantId);
      const unsafe = packets.find((p) => p.proposal.action === "budget_shift");
      if (!unsafe) {
        // Fabricate one to guarantee coverage of the budget-cap rule.
        const fab = H0Packet.parse({
          packet_id: newId("h0"),
          tenant_id: tenantId,
          goal,
          hypothesis: "Doubling Campaign A's budget will lower CAC",
          null_hypothesis: "Doubling Campaign A's budget has no effect on CAC",
          baseline_window: "2026-05-12..2026-05-21",
          success_metric: "cac",
          guardrails: {
            max_daily_budget_delta_pct: 25,
            requires_human_approval: true,
          },
          evidence: [
            {
              source: "google_ads_fixture",
              ref: "campaign:acc_demo:campaign_a",
              entity_id: "campaign_a",
            },
          ],
          causal_status: "directional_until_lift_test",
          proposal: {
            action: "budget_shift",
            target_entity_id: "campaign_a",
            params: { delta_pct: 80 }, // breaches the 25% cap
            dry_run_only: true,
          },
          rollback: {
            method: "restore_previous_budget",
            checkpoint_id: newId("ckpt"),
          },
          approval: { status: "pending", required_role: "approver" },
          created_by_agent: "media-analyst",
          created_at: nowIso(),
          trace_id: "trace_test",
        });
        packets.push(fab);
        return packets;
      }
      unsafe.proposal.params = { delta_pct: 80 };
      return packets;
    },
  };
}
