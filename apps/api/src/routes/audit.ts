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
  tenantId: z.string().default("tenant_demo"),
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
    const { audit, packets } = await runAuditForRequest(parsed.data, deps);
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
    return AuditReport.parse(stored);
  });

  app.get("/api/v1/audits", async () => {
    const reports = await deps.store.list<AuditReportT>("audit_reports");
    return { reports: reports.map((r) => AuditReport.parse(r)) };
  });
}

async function runAuditForRequest(
  req: AuditRequest,
  deps: AuditDeps,
): Promise<{ audit: AuditReportT; packets: H0PacketT[] }> {
  const ref = resolveAccountRef(req.accountRef);
  const connector = fixtureConnector();
  const accounts = await connector.listAccounts();
  const account =
    accounts.find((a) => a.account_id === ref.id) ?? accounts[0];
  if (!account) {
    throw new Error(`audit: no accounts available from connector ${connector.platform}`);
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
  const packets = buildH0Packets(audit, req.goal, req.tenantId);
  await deps.store.put("audit_reports", audit.report_id, audit);
  for (const packet of packets) {
    await deps.store.put("h0_packets", packet.packet_id, packet);
  }
  return { audit, packets };
}
