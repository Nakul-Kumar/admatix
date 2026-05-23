import {
  AgentOutput,
  type AuditReport,
  type Campaign,
  type CampaignDailyMetric,
  type FirstPartyRevenueDaily,
  type H0Packet,
  type NormalizedMetrics,
  type PlatformAccount,
} from "@admatix/schemas";
import { sha256 } from "@admatix/core";
import {
  buildH0Packets as defaultBuildH0Packets,
  runAudit as defaultRunAudit,
  type DetectorInput,
} from "@admatix/evidence";
import type { Agent } from "../agent.js";

export interface MediaAnalystInput {
  account: PlatformAccount;
  campaigns: Campaign[];
  metrics: NormalizedMetrics[];
  daily: CampaignDailyMetric[];
  firstParty: FirstPartyRevenueDaily[];
  window: string;
  goal: string;
  tenantId: string;
}

export interface MediaAnalystDeps {
  runAudit?: (input: DetectorInput, window: string) => AuditReport;
  buildH0Packets?: (
    report: AuditReport,
    goal: string,
    tenantId: string,
  ) => H0Packet[];
}

export interface MediaAnalystResult {
  output: AgentOutput;
  audit: AuditReport;
  packets: H0Packet[];
}

/**
 * MediaAnalyst is the only intelligence-tier agent in the MVP. It runs the
 * deterministic detectors and drafts H0 packets. It never approves, never
 * activates — those are control- and execution-tier responsibilities.
 *
 * Evidence functions are injectable so the orchestrator can run on top of
 * test fixtures while `@admatix/evidence` lands. The defaults are the real
 * detectors and packet builder.
 */
export function makeMediaAnalystAgent(opts: {
  traceId: string;
  deps?: MediaAnalystDeps;
}): {
  agent: Agent;
  analyse(input: MediaAnalystInput): Promise<MediaAnalystResult>;
} {
  const runAudit = opts.deps?.runAudit ?? defaultRunAudit;
  const buildH0Packets = opts.deps?.buildH0Packets ?? defaultBuildH0Packets;

  const analyse = async (input: MediaAnalystInput): Promise<MediaAnalystResult> => {
    const detectorInput: DetectorInput = {
      account: input.account,
      campaigns: input.campaigns,
      metrics: input.metrics,
      daily: input.daily,
      firstParty: input.firstParty,
    };
    const audit = runAudit(detectorInput, input.window);
    const packets = buildH0Packets(audit, input.goal, input.tenantId);
    const input_hash = sha256({
      account_id: input.account.account_id,
      window: input.window,
      campaign_ids: input.campaigns.map((c) => c.campaign_id).sort(),
    });
    const evidence_refs = audit.findings
      .flatMap((f) => f.evidence.map((e) => `${e.source}:${e.ref}`))
      .slice(0, 64);
    const output = AgentOutput.parse({
      agent_id: "media-analyst",
      agent_version: "0.1.0",
      input_hash,
      output_type: "audit.draft",
      confidence: audit.findings.length > 0 ? 0.8 : 0.4,
      evidence_refs,
      proposed_actions: packets.map((p) => p.packet_id),
      blocked_actions: [],
      warnings: audit.caveats,
      trace_id: opts.traceId,
    });
    return { output, audit, packets };
  };
  const agent: Agent = {
    id: "media-analyst",
    version: "0.1.0",
    async run(input: unknown): Promise<AgentOutput> {
      const ma = input as MediaAnalystInput;
      const { output } = await analyse(ma);
      return output;
    },
  };
  return { agent, analyse };
}
