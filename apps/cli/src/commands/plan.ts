import type { Command } from "commander";
import { runWorkflow } from "@admatix/agents";
import type { CliContext } from "../support.js";
import {
  actionable,
  DEFAULT_GOAL,
  DEFAULT_TENANT,
  getStore,
  resolveFixtureAccount,
  withCliDemoId,
  writeResult,
} from "../support.js";

export function registerPlanCommand(program: Command, ctx: CliContext): void {
  program
    .command("plan")
    .description("run the deterministic Plan to Reflect workflow for a fixture account")
    .requiredOption("--account <ref>", "account ref, e.g. fixture:agency-demo")
    .option("--goal <goal>", "optimization goal", DEFAULT_GOAL)
    .option("--tenant <tenant_id>", "tenant id", DEFAULT_TENANT)
    .option("--json", "emit machine-readable JSON")
    .action(async (opts: { account: string; goal: string; tenant: string }, command: Command) => {
      const store = getStore(command);
      const { canonicalRef } = await resolveFixtureAccount(opts.account);
      const result = await runWorkflow(
        { accountRef: canonicalRef, goal: opts.goal, tenantId: opts.tenant },
        { store },
      );
      const aliasedPackets = result.packets.map((packet, index) => withCliDemoId(packet, index));
      for (const packet of aliasedPackets) {
        await store.put("h0_packets", packet.packet_id, packet);
      }
      const output = { ...result, packets: aliasedPackets };
      writeResult(
        command,
        output,
        (r) =>
          [
            `Workflow ${r.workflow_id}`,
            `Trace: ${r.trace_id}`,
            `Audit: ${r.audit.report_id}`,
            `Packets: ${r.packets.map((p) => p.packet_id).join(", ")}`,
            `Diffs: ${r.diffs.length}`,
            `Blocked: ${r.blocked.length}`,
          ].join("\n") + "\n",
        ctx,
      );
      if (result.decisions.some((decision) => decision.result === "block")) {
        throw actionable(
          "PolicyGuard blocked one or more actions.",
          "Inspect the blocked field in the JSON output or adjust the packet guardrails before activation.",
          3,
          "policy_guard_blocked",
          { blocked: result.blocked },
        );
      }
    });
}
