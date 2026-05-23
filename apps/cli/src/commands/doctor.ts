import type { Command } from "commander";
import { existsSync } from "node:fs";
import type { CliContext } from "../support.js";
import { writeResult } from "../support.js";

export function registerDoctorCommand(program: Command, ctx: CliContext): void {
  program
    .command("doctor")
    .description("check local MVP prerequisites")
    .option("--json", "emit machine-readable JSON")
    .action((opts: unknown, command: Command) => {
      const checks = [
        { name: "Node >= 20", ok: Number(process.versions.node.split(".")[0] ?? "0") >= 20, detail: process.versions.node },
        { name: "pnpm-workspace.yaml", ok: existsSync("pnpm-workspace.yaml"), detail: "workspace root" },
        { name: "packages/schemas", ok: existsSync("packages/schemas/src/index.ts"), detail: "shared contract" },
        { name: "fixtures", ok: existsSync("data/fixtures/google_ads/demo_campaigns.json"), detail: "agency demo fixture" },
      ];
      const result = { ok: checks.every((check) => check.ok), checks };
      writeResult(
        command,
        result,
        (r) =>
          r.checks
            .map((check) => `[${check.ok ? "PASS" : "FAIL"}] ${check.name} - ${check.detail}`)
            .join("\n") + `\n\ndoctor: ${r.ok ? "all required checks passed" : "checks failed"}.\n`,
        ctx,
      );
      if (!result.ok) process.exitCode = 1;
    });
}
