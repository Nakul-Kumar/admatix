import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("warehouse/migrations/0007_connector_import_foundation.sql"),
  "utf8",
);
const applyMigrations = readFileSync(resolve("scripts/db/apply-migrations.ts"), "utf8");

describe("connector import foundation migration", () => {
  it("is wired into the migration runner", () => {
    expect(applyMigrations).toContain("0007_connector_import_foundation.sql");
  });

  it("defines the manifest, quality, cursor, job, and bronze manifest tables", () => {
    for (const table of [
      "app.connector_jobs",
      "app.connector_cursors",
      "app.connector_import_manifests",
      "app.connector_quality_checks",
      "warehouse.bronze_file_manifests",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("keeps manifests and quality checks append-only for the app role", () => {
    expect(migration).toContain("REVOKE UPDATE, DELETE, TRUNCATE ON");
    expect(migration).toContain("app.connector_import_manifests");
    expect(migration).toContain("app.connector_quality_checks");
    expect(migration).toContain("warehouse.bronze_file_manifests");
  });

  it("supports manual, read-only OAuth, and MCP-sourced batches", () => {
    expect(migration).toContain("'manual_export'");
    expect(migration).toContain("'oauth_readonly'");
    expect(migration).toContain("'platform_mcp'");
  });
});
