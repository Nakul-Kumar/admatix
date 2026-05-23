import type { Command } from "commander";
import type { CliContext } from "../support.js";
import { getPacketOrDemo, getStore, measurePacket, writeResult } from "../support.js";

export function registerMeasureCommand(program: Command, ctx: CliContext): void {
  program
    .command("measure")
    .argument("<packet_id>", "H0 packet id")
    .option("--json", "emit machine-readable JSON")
    .description("record an MVP outcome measurement placeholder")
    .action(async (packetId: string, _opts: unknown, command: Command) => {
      const store = getStore(command);
      const packet = await getPacketOrDemo(store, packetId);
      const measurement = await measurePacket(store, packet);
      writeResult(command, measurement, (m) => `Measured ${m.packet_id}: ${m.success_metric}\n`, ctx);
    });
}
