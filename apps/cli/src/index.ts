#!/usr/bin/env node
import { Command } from "commander";
import { registerActivateCommand } from "./commands/activate.js";
import { registerApproveCommand } from "./commands/approve.js";
import { registerAuditCommand } from "./commands/audit.js";
import { registerBenchmarkCommand } from "./commands/benchmark.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerFixturesCommand } from "./commands/fixtures.js";
import { registerMeasureCommand } from "./commands/measure.js";
import { registerPacketCommand } from "./commands/packet.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerReflectCommand } from "./commands/reflect.js";
import { registerReportCommand } from "./commands/report.js";

export interface CliOptions {
  readonly storeRoot?: string;
  readonly output?: NodeJS.WritableStream;
  readonly errorOutput?: NodeJS.WritableStream;
}

export function createProgram(_opts: CliOptions = {}): Command {
  const program = new Command();
  registerDoctorCommand(program);
  registerFixturesCommand(program);
  registerAuditCommand(program);
  registerPlanCommand(program);
  registerPacketCommand(program);
  registerActivateCommand(program);
  registerApproveCommand(program);
  registerMeasureCommand(program);
  registerReflectCommand(program);
  registerBenchmarkCommand(program);
  registerReportCommand(program);
  return program;
}

export async function runCli(argv: readonly string[], opts: CliOptions = {}): Promise<void> {
  await createProgram(opts).parseAsync([...argv], { from: "user" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runCli(process.argv.slice(2));
}
