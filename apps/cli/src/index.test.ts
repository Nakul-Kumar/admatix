import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildCsvImportManifest, type QueryExecutor } from "@admatix/connectors";
import { auditManifest } from "./commands/ingest.js";
import { runCli } from "./index.js";

const tempRoots: string[] = [];

afterEach(async () => {
  process.exitCode = undefined;
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("admatix CLI acceptance", () => {
  it("audit --json emits valid JSON with 3-5 findings", async () => {
    const result = await invoke(["audit", "--account", "fixture:agency-demo", "--json"]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as { findings: unknown[] };
    expect(json.findings.length).toBeGreaterThanOrEqual(3);
    expect(json.findings.length).toBeLessThanOrEqual(5);
  });

  it("audit --json golden output is stable", async () => {
    const first = await invoke(["audit", "--account", "fixture:agency-demo", "--json"]);
    const second = await invoke(["audit", "--account", "fixture:agency-demo", "--json"]);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toMatchSnapshot();
  });

  it("activate requires --dry-run and dry-run writes only a local diff", async () => {
    const withoutDryRun = await invoke(["activate", "h0_001", "--json"]);
    expect(withoutDryRun.exitCode).toBe(2);
    expect(withoutDryRun.stderr).toContain("dry_run_required");

    const withDryRun = await invoke(["activate", "h0_001", "--dry-run", "--json"]);
    expect(withDryRun.exitCode).toBe(0);
    const json = JSON.parse(withDryRun.stdout) as {
      action: { dry_run_only: boolean };
      diff: { dry_run: boolean; changes: unknown[] };
    };
    expect(json.action.dry_run_only).toBe(true);
    expect(json.diff.dry_run).toBe(true);
    expect(json.diff.changes.length).toBeGreaterThan(0);
  });

  it("invalid account refs return actionable non-zero errors", async () => {
    const result = await invoke(["audit", "--account", "fixture:not-real", "--json"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unknown_fixture_account");
    expect(result.stderr).toContain("fixture:agency-demo");
  });

  it("benchmark run --suite safety-v1 prints a scorecard", async () => {
    const result = await invoke(["benchmark", "run", "--suite", "safety-v1"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Scorecard");
    expect(result.stdout).toContain("Suite: safety-v1");
  });

  it("import --json previews a CSV manifest", async () => {
    const storeRoot = await mkdtemp(join(tmpdir(), "admatix-cli-import-"));
    tempRoots.push(storeRoot);
    const csvPath = join(storeRoot, "google-ads.csv");
    await writeFile(
      csvPath,
      [
        "date,account_id,campaign_id,spend,impressions,clicks",
        "2026-05-20,acc_1,campaign_1,100,1000,50",
      ].join("\n"),
      "utf8",
    );

    const result = await invoke([
      "import",
      "--file",
      csvPath,
      "--source",
      "google_ads_export",
      "--platform",
      "google_ads",
      "--object-type",
      "platform_report",
      "--account",
      "acc_1",
      "--required-columns",
      "date,campaign_id,spend,impressions,clicks",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as {
      platform: string;
      row_count: number;
      quality: { status: string };
    };
    expect(json.platform).toBe("google_ads");
    expect(json.row_count).toBe(1);
    expect(json.quality.status).toBe("pass");
  });

  it("accepts whitespace-separated column lists from PowerShell comma expansion", async () => {
    const storeRoot = await mkdtemp(join(tmpdir(), "admatix-cli-import-pwsh-"));
    tempRoots.push(storeRoot);
    const csvPath = join(storeRoot, "google-ads.csv");
    await writeFile(
      csvPath,
      [
        "date,account_id,campaign_id,spend,impressions,clicks",
        "2026-05-20,acc_1,campaign_1,100,1000,50",
      ].join("\n"),
      "utf8",
    );

    const result = await invoke([
      "import",
      "--file",
      csvPath,
      "--source",
      "google_ads_export",
      "--platform",
      "google_ads",
      "--object-type",
      "platform_report",
      "--required-columns",
      "date campaign_id spend impressions clicks",
      "--semantic-key",
      "date campaign_id",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      quality: { status: "pass" },
    });
  });

  it("import --json fails closed on data quality errors", async () => {
    const storeRoot = await mkdtemp(join(tmpdir(), "admatix-cli-import-bad-"));
    tempRoots.push(storeRoot);
    const csvPath = join(storeRoot, "bad-google-ads.csv");
    await writeFile(
      csvPath,
      [
        "date,account_id,campaign_id,spend,impressions,clicks",
        "2026-05-20,acc_1,campaign_1,-100,1000,50",
      ].join("\n"),
      "utf8",
    );

    const result = await invoke([
      "import",
      "--file",
      csvPath,
      "--source",
      "google_ads_export",
      "--platform",
      "google_ads",
      "--object-type",
      "platform_report",
      "--required-columns",
      "date,campaign_id,spend,impressions,clicks",
      "--json",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('"quality"');
    expect(result.stderr).toContain("import_quality_failed");
    expect(result.stderr).toContain("non_negative_numeric_metrics");
  });

  it("F8: refuses to start if ADMATIX_MODE != fixtures", async () => {
    const prev = process.env["ADMATIX_MODE"];
    process.env["ADMATIX_MODE"] = "live";
    try {
      const result = await invoke(["doctor", "--json"]);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("ADMATIX_MODE");
    } finally {
      if (prev === undefined) delete process.env["ADMATIX_MODE"];
      else process.env["ADMATIX_MODE"] = prev;
    }
  });

  it("allows connector preview commands in readonly mode but blocks fixture workflows", async () => {
    const prev = process.env["ADMATIX_MODE"];
    process.env["ADMATIX_MODE"] = "readonly";
    try {
      const capabilities = await invoke([
        "connectors",
        "capabilities",
        "--platform",
        "google_ads",
        "--json",
      ]);
      expect(capabilities.exitCode).toBe(0);
      expect(JSON.parse(capabilities.stdout).status).toBe("available");

      const audit = await invoke(["audit", "--account", "fixture:agency-demo", "--json"]);
      expect(audit.exitCode).toBe(2);
      expect(audit.stderr).toContain("ADMATIX_MODE=readonly");
    } finally {
      if (prev === undefined) delete process.env["ADMATIX_MODE"];
      else process.env["ADMATIX_MODE"] = prev;
    }
  });

  it("connectors preview --cassette emits directional, non-proof metadata", async () => {
    const cassettePath = fileURLToPath(
      new URL("../../../packages/connectors/testdata/cassettes/google_ads/campaign_metrics.json", import.meta.url),
    );
    const result = await invoke([
      "connectors",
      "preview",
      "--platform",
      "google_ads",
      "--cassette",
      cassettePath,
      "--account",
      "1234567890",
      "--window",
      "2026-05-20..2026-05-21",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as {
      row_count: number;
      proof_ready: boolean;
      causal_status: string;
    };
    expect(json.row_count).toBe(2);
    expect(json.proof_ready).toBe(false);
    expect(json.causal_status).toBe("directional_until_lift_test");
  });

  it("import persist --dry-run plans warehouse writes without touching a database", async () => {
    const storeRoot = await mkdtemp(join(tmpdir(), "admatix-cli-import-persist-"));
    tempRoots.push(storeRoot);
    const csvPath = join(storeRoot, "google-ads.csv");
    await writeFile(
      csvPath,
      [
        "date,account_id,campaign_id,spend,impressions,clicks",
        "2026-05-20,acc_1,campaign_1,100,1000,50",
      ].join("\n"),
      "utf8",
    );

    const result = await invoke([
      "import",
      "persist",
      "--file",
      csvPath,
      "--source",
      "google_ads_export",
      "--platform",
      "google_ads",
      "--object-type",
      "platform_report",
      "--tenant-uuid",
      "00000000-0000-0000-0000-000000000001",
      "--required-columns",
      "date,campaign_id,spend,impressions,clicks",
      "--dry-run",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as {
      dry_run: boolean;
      raw_rows_total: number;
      raw_rows_inserted: number;
    };
    expect(json.dry_run).toBe(true);
    expect(json.raw_rows_total).toBe(1);
    expect(json.raw_rows_inserted).toBe(0);
  });

  it("ingest audit keeps imported manifests directional and non-proof", async () => {
    const storeRoot = await mkdtemp(join(tmpdir(), "admatix-cli-ingest-audit-"));
    tempRoots.push(storeRoot);
    const csvPath = join(storeRoot, "google-ads.csv");
    const manifestPath = join(storeRoot, "manifest.json");
    await writeFile(
      csvPath,
      [
        "date,account_id,campaign_id,spend,impressions,clicks",
        "2026-05-20,acc_1,campaign_1,100,1000,50",
      ].join("\n"),
      "utf8",
    );
    const manifest = await invoke([
      "import",
      "--file",
      csvPath,
      "--source",
      "google_ads_export",
      "--platform",
      "google_ads",
      "--object-type",
      "platform_report",
      "--out",
      manifestPath,
      "--json",
    ]);
    expect(manifest.exitCode).toBe(0);

    const result = await invoke([
      "ingest",
      "audit",
      "--manifest",
      manifestPath,
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as {
      proof_ready: boolean;
      causal_status: string;
      h0_packets: unknown[];
    };
    expect(json.proof_ready).toBe(false);
    expect(json.causal_status).toBe("directional_until_lift_test");
    expect(json.h0_packets).toEqual([]);
  });

  it("ingest audit can read a persisted manifest id without promoting proof", async () => {
    const manifest = buildCsvImportManifest(
      [
        "date,account_id,campaign_id,spend,impressions,clicks",
        "2026-05-20,acc_1,campaign_1,100,1000,50",
      ].join("\n"),
      {
        tenant_id: "tenant_demo",
        source: "google_ads_export",
        source_kind: "manual_export",
        platform: "google_ads",
        object_type: "platform_report",
        file_name: "google-ads.csv",
        account_id: "acc_1",
        required_columns: ["date", "campaign_id", "spend", "impressions", "clicks"],
      },
    );

    const result = await auditManifest(
      manifest.manifest_id,
      { tenantUuid: "00000000-0000-0000-0000-000000000001" },
      fakeManifestReader({
        manifestId: "44444444-4444-4444-4444-444444444444",
        manifestKey: manifest.manifest_id,
        manifestBody: manifest,
        platformRows: 1,
        conversionRows: 0,
      }),
    );

    expect(result).toMatchObject({
      connector_import_manifest_id: "44444444-4444-4444-4444-444444444444",
      causal_status: "directional_until_lift_test",
      proof_ready: false,
      h0_packets: [],
      warehouse_inputs: {
        raw_platform_report_rows: 1,
        raw_conversion_event_rows: 0,
        raw_rows_total: 1,
      },
    });
  });

  it("import preview and dry-run support first-party order exports", async () => {
    const storeRoot = await mkdtemp(join(tmpdir(), "admatix-cli-first-party-"));
    tempRoots.push(storeRoot);
    const csvPath = join(storeRoot, "orders.csv");
    await writeFile(
      csvPath,
      [
        "date,external_account_id,order_id,revenue,gross_margin,currency",
        "2026-05-20,store_1,order_1,200,80,USD",
      ].join("\n"),
      "utf8",
    );

    const preview = await invoke([
      "import",
      "--file",
      csvPath,
      "--source",
      "first_party_orders_export",
      "--platform",
      "first_party",
      "--object-type",
      "order",
      "--required-columns",
      "date,order_id,revenue",
      "--semantic-key",
      "date,order_id",
      "--json",
    ]);
    expect(preview.exitCode).toBe(0);
    expect(JSON.parse(preview.stdout)).toMatchObject({
      platform: "first_party",
      object_type: "order",
      quality: { status: "pass" },
    });

    const dryRun = await invoke([
      "import",
      "persist",
      "--file",
      csvPath,
      "--source",
      "first_party_orders_export",
      "--platform",
      "first_party",
      "--object-type",
      "order",
      "--tenant-uuid",
      "00000000-0000-0000-0000-000000000001",
      "--required-columns",
      "date,order_id,revenue",
      "--semantic-key",
      "date,order_id",
      "--dry-run",
      "--json",
    ]);
    expect(dryRun.exitCode).toBe(0);
    expect(JSON.parse(dryRun.stdout)).toMatchObject({
      dry_run: true,
      raw_rows_total: 1,
      raw_rows_inserted: 0,
      quality_blocked: false,
    });
  });
});

async function invoke(args: readonly string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const storeRoot = await mkdtemp(join(tmpdir(), "admatix-cli-test-"));
  tempRoots.push(storeRoot);
  const stdout = capture();
  const stderr = capture();
  process.exitCode = undefined;
  await runCli(["--store-root", storeRoot, ...args], {
    output: stdout.stream,
    errorOutput: stderr.stream,
  });
  return {
    stdout: stdout.read(),
    stderr: stderr.read(),
    exitCode: typeof process.exitCode === "number" ? process.exitCode : 0,
  };
}

function capture(): { stream: Writable; read(): string } {
  const chunks: string[] = [];
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    }),
    read() {
      return chunks.join("");
    },
  };
}

function fakeManifestReader(opts: {
  manifestId: string;
  manifestKey: string;
  manifestBody: unknown;
  platformRows: number;
  conversionRows: number;
}): QueryExecutor {
  return {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string) {
      if (/FROM app\.connector_import_manifests/.test(sql)) {
        return {
          rows: [
            {
              connector_import_manifest_id: opts.manifestId,
              manifest_key: opts.manifestKey,
              manifest_body: opts.manifestBody,
            } as unknown as T,
          ],
          rowCount: 1,
        };
      }
      if (/FROM app\.connector_quality_checks/.test(sql)) {
        return {
          rows: [
            {
              check_count: "7",
              failed_check_count: "0",
              warning_check_count: "0",
            } as unknown as T,
          ],
          rowCount: 1,
        };
      }
      if (/FROM warehouse\.raw_platform_reports/.test(sql)) {
        return { rows: [{ count: String(opts.platformRows) } as unknown as T], rowCount: 1 };
      }
      if (/FROM warehouse\.raw_conversion_events/.test(sql)) {
        return { rows: [{ count: String(opts.conversionRows) } as unknown as T], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}
