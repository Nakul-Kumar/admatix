import { AuditReport, z } from "@admatix/schemas";
import { runAudit } from "@admatix/evidence";
import {
  DEFAULT_WINDOW,
  buildAuditInput,
  okEnvelope,
  refsFromAudit,
  traceFor,
  type ToolContext,
  type ToolResultEnvelope,
} from "./common.js";

export const AuditAccountInput = z.object({
  account_ref: z.string(),
  window: z.string().optional(),
}).strict();
export type AuditAccountInput = z.infer<typeof AuditAccountInput>;

export async function auditAccountTool(
  input: AuditAccountInput,
  ctx: ToolContext,
): Promise<ToolResultEnvelope<z.infer<typeof AuditReport>>> {
  const parsed = AuditAccountInput.parse(input);
  const window = parsed.window ?? DEFAULT_WINDOW;
  const auditInput = await buildAuditInput(ctx, parsed.account_ref, window);
  const report = AuditReport.parse(runAudit(auditInput, window));
  return okEnvelope({
    trace_id: traceFor("audit_account", parsed),
    source_refs: refsFromAudit(report),
    risk_level: "low",
    data: report,
  });
}
