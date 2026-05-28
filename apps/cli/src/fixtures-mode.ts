const READONLY_COMMANDS = new Set(["connectors", "import", "ingest"]);

/**
 * Fixture mode remains the default. Readonly mode is a narrow connector/import
 * preview runway and deliberately does not unlock audit, plan, activate, or
 * verifier flows against live refs.
 */
export function assertFixturesMode(): void {
  const mode = admatixMode();
  if (mode !== "fixtures") {
    throw new Error(
      `ADMATIX_MODE must be "fixtures" for fixture workflow commands (got "${mode}"). ` +
        `Use ADMATIX_MODE=readonly only for connector preview/import commands.`,
    );
  }
}

export function assertCliModeForArgs(argv: readonly string[]): void {
  const mode = admatixMode();
  if (mode === "fixtures") return;
  if (mode === "readonly") {
    const command = firstCommand(argv);
    if (command && READONLY_COMMANDS.has(command)) return;
    throw new Error(
      `ADMATIX_MODE=readonly only allows connector preview/import commands. ` +
        `Refusing command "${command ?? "(none)"}".`,
    );
  }
  throw new Error(
    `ADMATIX_MODE must be "fixtures" or "readonly" (got "${mode}").`,
  );
}

export function admatixMode(): string {
  return process.env["ADMATIX_MODE"] ?? "fixtures";
}

function firstCommand(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--store-root") {
      i += 1;
      continue;
    }
    if (arg.startsWith("--store-root=")) continue;
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return undefined;
}
