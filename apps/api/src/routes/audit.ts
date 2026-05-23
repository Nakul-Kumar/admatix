import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AuditReport,
  H0Packet,
  type AuditReport as AuditReportT,
  type H0Packet as H0PacketT,
} from "@admatix/schemas";
import { normalizeMetrics, type Store } from "@admatix/core";
import { fixtureConnector, resolveAccountRef } from "@admatix/connectors";
import { buildH0Packets, runAudit } from "@admatix/evidence";

const AuditRequest = z.object({
  accountRef: z.string().default("fixture:acc_demo"),
  goal: z.string().default("reduce_cac"),
  window: z.string().default("2026-05-12..2026-05-21"),
});
type AuditRequest = z.infer<typeof AuditRequest>;

const AuditResponse = z.object({
  audit: AuditReport,
  packets: z.array(H0Packet),
});

export interface AuditDeps {
  store: Store;
}

/** POST /api/v1/audit — run the deterministic audit on a (fixture) account. */
export function registerAuditRoutes(app: FastifyInstance, deps: AuditDeps): void {
  app.post("/api/v1/audit", async (req, reply) => {
    const parsed = AuditRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "invalid_request", issues: parsed.error.issues };
    }
    const identity = req.identity;
    if (!identity) {
      reply.code(401);
      return { error: "unauthorized" };
    }
    const { audit, packets } = await runAuditForRequest(parsed.data, identity.tenant_id, deps);
    return AuditResponse.parse({ audit, packets });
  });

  app.get("/api/v1/audit/:reportId", async (req, reply) => {
    const params = z.object({ reportId: z.string() }).safeParse(req.params);
    if (!params.success) {
      reply.code(400);
      return { error: "invalid_request" };
    }
    const stored = await deps.store.get<AuditReportT>("audit_reports", params.data.reportId);
    if (!stored) {
      reply.code(404);
      return { error: "not_found" };
    }
    const report = AuditReport.parse(stored);
    // The MVP fixture-mode story is single-tenant per account_id; if a
    // report's account belongs to another tenant via convention
    // (account_id prefix), we'd filter here. For now any authenticated
    // caller can read.
    return report;
  });

  app.get("/api/v1/audits", async (req, reply) => {
    if (!req.identity) {
      reply.code(401);
      return { error: "unauthorized" };
    }
    const reports = await deps.store.list<AuditReportT>("audit_reports");
    return { reports: reports.map((r) => AuditReport.parse(r)) };
  });
}

async function runAuditForRequest(
  req: AuditRequest,
  tenantId: string,
  deps: AuditDeps,
): Promise<{ audit: AuditReportT; packets: H0PacketT[] }> {
  const ref = resolveAccountRef(req.accountRef);
  if (ref.kind !== "fixture") {
    throw new Error(
      `audit: live account refs are not supported in the MVP (got "${req.accountRef}"). Use fixture:<account_id>.`,
    );
  }
  const connector = fixtureConnector();
  const accounts = await connector.listAccounts();
  const account = accounts.find((a) => a.account_id === ref.id);
  if (!account) {
    throw new Error(
      `audit: unknown fixture account "${ref.id}" (available: ${accounts.map((a) => a.account_id).join(", ") || "<none>"}).`,
    );
  }
  const campaigns = await connector.getCampaigns(account.account_id);
  const daily = await connector.getCampaignDailyMetrics(account.account_id, req.window);
  const firstParty = await connector.getFirstPartyRevenue(account.account_id, req.window);
  const metrics = normalizeMetrics(daily, firstParty, {
    scope: "campaign",
    window: req.window,
  });
  const audit = runAudit(
    { account, campaigns, metrics, daily, firstParty },
    req.window,
  );
  const packets = buildH0Packets(audit, req.goal, tenantId);
  await deps.store.put("audit_reports", audit.report_id, audit);
  for (const packet of packets) {
    await deps.store.put("h0_packets", packet.packet_id, packet);
  }
  return { audit, packets };
}
