import type { Command } from "commander";
import type { CliContext } from "../support.js";
import { buildAuditForRef, getStore, DEFAULT_WINDOW, writeResult } from "../support.js";

export function registerAuditCommand(program: Command, ctx: CliContext): void {
  program
    .command("audit")
    .description("audit a fixture account and emit evidence-backed findings")
    .requiredOption("--account <ref>", "account ref, e.g. fixture:agency-demo")
    .option("--window <range>", "date window YYYY-MM-DD..YYYY-MM-DD", DEFAULT_WINDOW)
    .option("--json", "emit machine-readable JSON")
    .action(async (opts: { account: string; window: string }, command: Command) => {
      const { report } = await buildAuditForRef(opts.account, opts.window);
      await getStore(command).put("audit_reports", report.report_id, report);
      writeResult(
        command,
        report,
        (r) =>
          [
            `Audit ${r.report_id}`,
            `Account: ${r.account_id}`,
            `Window: ${r.window}`,
            `Findings: ${r.findings.length}`,
            `Estimated waste: ${r.total_estimated_waste.toFixed(2)}`,
            ...r.findings.map((f) => `- [${f.severity}] ${f.title} (${f.entity_id})`),
          ].join("\n") + "\n",
        ctx,
      );
    });
}
