export function assertFixturesMode(): void {
  const mode = admatixMode();
  if (mode !== "fixtures") {
    throw new Error(
      `ADMATIX_MODE must be "fixtures" for fixture workflow tools (got "${mode}"). ` +
        `Use ADMATIX_MODE=readonly only for connector preview tools.`,
    );
  }
}

export function assertSupportedMcpMode(): void {
  const mode = admatixMode();
  if (mode === "fixtures" || mode === "readonly") return;
  throw new Error(
    `ADMATIX_MODE must be "fixtures" or "readonly" for MCP (got "${mode}").`,
  );
}

export function isReadonlyMode(): boolean {
  return admatixMode() === "readonly";
}

export function admatixMode(): string {
  return process.env["ADMATIX_MODE"] ?? "fixtures";
}
