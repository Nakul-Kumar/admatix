/**
 * AGENTS.md §2 — `ADMATIX_MODE=fixtures` is the only supported mode for
 * the MVP. The CLI refuses to start in any other mode.
 */
export function assertFixturesMode(): void {
  const mode = process.env["ADMATIX_MODE"] ?? "fixtures";
  if (mode !== "fixtures") {
    throw new Error(
      `ADMATIX_MODE must be "fixtures" for the MVP (got "${mode}"). ` +
        `Live connectors are out of scope; unset ADMATIX_MODE or set it to "fixtures".`,
    );
  }
}
