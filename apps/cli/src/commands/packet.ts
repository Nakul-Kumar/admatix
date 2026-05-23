import type { Command } from "commander";
import type { CliContext } from "../support.js";
import { getPacketOrDemo, getStore, writeResult } from "../support.js";

export function registerPacketCommand(program: Command, ctx: CliContext): void {
  const packet = program.command("packet").description("inspect H0 packets from the local Store");
  packet
    .command("show")
    .argument("<packet_id>", "H0 packet id")
    .option("--json", "emit machine-readable JSON")
    .description("show one H0 packet")
    .action(async (packetId: string, _opts: unknown, command: Command) => {
      const packetValue = await getPacketOrDemo(getStore(command), packetId);
      writeResult(
        command,
        packetValue,
        (p) =>
          [
            `${p.packet_id}: ${p.hypothesis}`,
            `Goal: ${p.goal}`,
            `Evidence refs: ${p.evidence.length}`,
            `Action: ${p.proposal.action} -> ${p.proposal.target_entity_id ?? "n/a"}`,
            `Rollback: ${p.rollback.method} (${p.rollback.checkpoint_id})`,
            `Approval: ${p.approval.status}`,
          ].join("\n") + "\n",
        ctx,
      );
    });
}
