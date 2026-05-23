import type { Command } from "commander";
import type { CliContext } from "../support.js";
import {
  actionable,
  activatePacketDryRun,
  getPacketOrDemo,
  getStore,
  writeResult,
} from "../support.js";

export function registerActivateCommand(program: Command, ctx: CliContext): void {
  program
    .command("activate")
    .argument("<packet_id>", "H0 packet id")
    .description("build a dry-run execution diff for an H0 packet")
    .option("--dry-run", "required; activation never mutates a platform")
    .option("--json", "emit machine-readable JSON")
    .action(async (packetId: string, opts: { dryRun?: boolean }, command: Command) => {
      if (opts.dryRun !== true) {
        throw actionable(
          "Refusing activation without --dry-run.",
          "Rerun as `admatix activate <packet_id> --dry-run`; live platform writes do not exist in the MVP.",
          2,
          "dry_run_required",
          { packet_id: packetId },
        );
      }
      const store = getStore(command);
      const packet = await getPacketOrDemo(store, packetId);
      const result = await activatePacketDryRun(packet);
      if (result.diff) await store.put("execution_diffs", result.diff.diff_id, result.diff);
      writeResult(
        command,
        result,
        (r) => {
          if (!r.diff) {
            return `PolicyGuard blocked ${r.action.action_id}: ${r.decision.reasons.join("; ")}\n`;
          }
          return [
            `Dry-run diff ${r.diff.diff_id}`,
            `Action: ${r.action.action_id}`,
            `Decision: ${r.decision.result}`,
            ...r.diff.changes.map((c) => `- ${c.field}: ${String(c.before)} -> ${String(c.after)}`),
          ].join("\n") + "\n";
        },
        ctx,
      );
      if (result.decision.result === "block") {
        throw actionable(
          "PolicyGuard blocked activation.",
          "No diff was written; inspect decision.reasons and adjust the packet before retrying.",
          3,
          "policy_guard_blocked",
          { action_id: result.action.action_id, reasons: result.decision.reasons },
        );
      }
    });
}
