import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
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
