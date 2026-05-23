import type { Command } from "commander";
import type { CliContext } from "../support.js";
import { approvePacket, getPacketOrDemo, getStore, writeResult } from "../support.js";

export function registerApproveCommand(program: Command, ctx: CliContext): void {
  program
    .command("approve")
    .argument("<packet_id>", "H0 packet id")
    .option("--by <user>", "approver id", "demo_media_manager")
    .option("--note <note>", "approval note")
    .option("--json", "emit machine-readable JSON")
    .description("record an approval receipt in the local Store")
    .action(async (packetId: string, opts: { by: string; note?: string }, command: Command) => {
      const store = getStore(command);
      const packet = await getPacketOrDemo(store, packetId);
      const receipt = await approvePacket(store, packet, opts.by, opts.note);
      writeResult(command, receipt, (r) => `Approved ${r.packet_id} as ${r.receipt_id}\n`, ctx);
    });
}
