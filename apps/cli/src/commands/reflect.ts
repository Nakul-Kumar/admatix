import type { Command } from "commander";
import type { CliContext } from "../support.js";
import { getPacketOrDemo, getStore, writeResult } from "../support.js";

export function registerReflectCommand(program: Command, ctx: CliContext): void {
  program
    .command("reflect")
    .argument("<packet_id>", "H0 packet id")
    .option("--json", "emit machine-readable JSON")
    .description("emit the next-plan reflection note for a packet")
    .action(async (packetId: string, _opts: unknown, command: Command) => {
      const packet = await getPacketOrDemo(getStore(command), packetId);
      const result = {
        packet_id: packet.packet_id,
        note: "Keep the packet gated until verifier-backed outcome measurement is available.",
        evidence_refs: packet.evidence,
      };
      writeResult(command, result, (r) => `Reflection ${r.packet_id}: ${r.note}\n`, ctx);
    });
}
