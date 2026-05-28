#!/usr/bin/env tsx
import { Command } from "commander";
import { pathToFileURL } from "node:url";
import { registerActivateCommand } from "./commands/activate.js";
import { registerApproveCommand } from "./commands/approve.js";
import { registerAuditCommand } from "./commands/audit.js";
import { registerBenchmarkCommand } from "./commands/benchmark.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerFixturesCommand } from "./commands/fixtures.js";
import { registerImportCommand } from "./commands/import.js";
import { registerMeasureCommand } from "./commands/measure.js";
import { registerPacketCommand } from "./commands/packet.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerReflectCommand } from "./commands/reflect.js";
import { registerReportCommand } from "./commands/report.js";
import { registerRollbackCommand } from "./commands/rollback.js";
import { CliError, printError } from "./support.js";
import { assertFixturesMode } from "./fixtures-mode.js";

export interface CliOptions {
  readonly storeRoot?: string;
  readonly output?: NodeJS.WritableStream;
  readonly errorOutput?: NodeJS.WritableStream;
}

export function createProgram(_opts: CliOptions = {}): Command {
  const program = new Command();
  const opts = _opts;
  program
    .name("admatix")
    .description("Evidence-gated CLI for fixture-only paid-media workflows")
    .version("0.1.0")
    .option("--store-root <path>", "store root for state and event files", opts.storeRoot);
  program.configureOutput({
    writeOut: (str) => (opts.output ?? process.stdout).write(str),
    writeErr: (str) => (opts.errorOutput ?? process.stderr).write(str),
  });
  program
    .command("init")
    .description("initialize local AdMatix data directories")
    .option("--json", "emit machine-readable JSON")
    .action(async (cmd: Command) => {
      const { initLocalStore } = await import("./support.js");
      const { writeResult } = await import("./support.js");
      const result = await initLocalStore(resolveStoreRoot(cmd));
      writeResult(cmd, result, (r) => `Initialized ${r.root}\n`, opts);
    });
  registerDoctorCommand(program, opts);
  registerFixturesCommand(program, opts);
  registerImportCommand(program, opts);
  registerAuditCommand(program, opts);
  registerPlanCommand(program, opts);
  registerPacketCommand(program, opts);
  registerActivateCommand(program, opts);
  registerApproveCommand(program, opts);
  registerMeasureCommand(program, opts);
  registerReflectCommand(program, opts);
  registerRollbackCommand(program, opts);
  registerBenchmarkCommand(program, opts);
  registerReportCommand(program, opts);
  return program;
}

export async function runCli(argv: readonly string[], opts: CliOptions = {}): Promise<void> {
  try {
    assertFixturesMode();
  } catch (error) {
    const err = opts.errorOutput ?? process.stderr;
    err.write(`${(error as Error).message}\n`);
    process.exitCode = 2;
    return;
  }
  const program = createProgram(opts);
  try {
    await program.parseAsync([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CliError) {
      printError(error, opts);
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli(process.argv.slice(2));
}

function resolveStoreRoot(command: Command): string | undefined {
  const opts = command.optsWithGlobals<{ storeRoot?: string }>();
  return opts.storeRoot;
}
