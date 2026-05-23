export interface MigrationResult {
  readonly file: string;
  readonly status: "applied" | "already-applied";
}

export async function applyMigrations(): Promise<MigrationResult[]> {
  throw new Error("applyMigrations is not implemented yet.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await applyMigrations();
}
