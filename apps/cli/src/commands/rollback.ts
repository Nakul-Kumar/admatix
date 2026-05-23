import type { Command } from "commander";
import type { CliContext } from "../support.js";
import { getPacketOrDemo, getStore, rollbackPacket, writeResult } from "../support.js";

export function registerRollbackCommand(program: Command, ctx: CliContext): void {
  program
    .command("rollback")
    .argument("<packet_id>", "H0 packet id")
    .option("--json", "emit machine-readable JSON")
    .description("materialize a dry-run rollback checkpoint")
    .action(async (packetId: string, _opts: unknown, command: Command) => {
      const store = getStore(command);
      const packet = await getPacketOrDemo(store, packetId);
      const checkpoint = await rollbackPacket(store, packet);
      writeResult(
        command,
        checkpoint,
        (c) => `Rollback checkpoint ${c.checkpoint_id} for ${c.entity_id} (dry-run)\n`,
        ctx,
      );
    });
}
