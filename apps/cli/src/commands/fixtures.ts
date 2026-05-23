import type { Command } from "commander";
import type { CliContext } from "../support.js";
import { getStore, listFixtureFiles, seedDemo, writeResult } from "../support.js";

export function registerFixturesCommand(program: Command, ctx: CliContext): void {
  const fixtures = program.command("fixtures").description("manage fixture-backed demo data");
  fixtures
    .command("seed")
    .option("--json", "emit machine-readable JSON")
    .description("validate fixtures and seed demo packets into the local Store")
    .action(async (_opts: unknown, command: Command) => {
      const files = await listFixtureFiles();
      const seeded = await seedDemo(getStore(command));
      const result = { files, ...seeded };
      writeResult(
        command,
        result,
        (r) =>
          `fixtures: validated ${r.files.length} file(s); seeded packets ${r.packet_ids.join(", ")}\n`,
        ctx,
      );
    });
}
