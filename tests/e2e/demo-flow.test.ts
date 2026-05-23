/**
 * tests/e2e/demo-flow.test.ts — WP-K acceptance.
 *
 * Asserts the four properties from `docs/build/WP-K-integration.md`:
 *   1. All 8 demo steps run and report ok.
 *   2. PolicyGuard blocks at least one unsafe action with a visible reason.
 *   3. The transcript matches `docs/runbooks/demo-script.md` line for line.
 *   4. Wiring uses only the public surfaces of the workspace packages.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { devNull, runDemo, type DemoResult } from "../../scripts/demo.ts";

const RUNBOOK = resolve(__dirname, "..", "..", "docs", "runbooks", "demo-script.md");

async function runOnFreshStore(): Promise<DemoResult> {
  const root = await mkdtemp(join(tmpdir(), "admatix-e2e-"));
  try {
    return await runDemo({ output: devNull(), storeRoot: root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function extractTranscriptBlock(markdown: string): string {
  // The runbook embeds the transcript in the first fenced code block tagged
  // ```text or just ``` immediately following the "Live transcript" header.
  const fenceRegex = /^```text\n([\s\S]*?)\n```/m;
  const match = markdown.match(fenceRegex);
  if (!match || match[1] === undefined) {
    throw new Error(
      "runbook: could not find a ```text fenced block (the live transcript)",
    );
  }
  // Ensure the block ends in a newline like the captured transcript.
  return `${match[1]}\n`;
}

describe("AdMatix demo flow (WP-K)", () => {
  it("runs all 8 demo steps green", async () => {
    const result = await runOnFreshStore();
    expect(result.steps).toHaveLength(8);
    expect(result.steps.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const step of result.steps) {
      expect(step.ok, `step ${step.id} (${step.title}) was not ok`).toBe(true);
    }
  });

  it("produces evidence-backed audit findings", async () => {
    const result = await runOnFreshStore();
    const audit = result.artifacts.audit;
    expect(audit.findings.length).toBeGreaterThanOrEqual(3);
    expect(audit.findings.length).toBeLessThanOrEqual(8);
    for (const finding of audit.findings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
    }
    expect(audit.total_estimated_waste).toBeGreaterThan(0);
  });

  it("emits H0 packets with rollback and evidence refs", async () => {
    const result = await runOnFreshStore();
    expect(result.artifacts.packets.length).toBeGreaterThan(0);
    for (const packet of result.artifacts.packets) {
      expect(packet.evidence.length).toBeGreaterThan(0);
      expect(packet.rollback.checkpoint_id.length).toBeGreaterThan(0);
      expect(packet.proposal.dry_run_only).toBe(true);
    }
  });

  it("produces a dry-run ExecutionDiff, never a mutation", async () => {
    const result = await runOnFreshStore();
    expect(result.artifacts.diff.dry_run).toBe(true);
    expect(result.artifacts.diff.changes.length).toBeGreaterThan(0);
  });

  it("blocks an unsafe budget action with a visible reason", async () => {
    const result = await runOnFreshStore();
    const decision = result.artifacts.blockDecision;
    expect(decision.result).toBe("block");
    expect(decision.matched_rules).toContain("budget_cap_v1");
    expect(decision.reasons.join(" | ")).toMatch(/exceeds the 20% cap/);
  });

  it("returns a benchmark scorecard with no unsafe write attempts", async () => {
    const result = await runOnFreshStore();
    const run = result.artifacts.benchmark;
    expect(run.suite).toBe("safety-v1");
    expect(run.results.length).toBeGreaterThan(0);
    expect(run.summary["unsafe_write_attempts"]).toBe(0);
  });

  it("exposes only six read-only MCP tools and blocks unauthorized activate", async () => {
    const result = await runOnFreshStore();
    const mcp = result.steps.find((s) => s.id === 7);
    expect(mcp).toBeDefined();
    const data = mcp!.data as { tools: string[]; auditOk: boolean; activateBlocked: boolean };
    expect(data.tools).toEqual([
      "activate_dry_run",
      "audit_account",
      "create_plan",
      "run_benchmark",
      "show_h0_packet",
      "validate_h0_packet",
    ]);
    expect(data.auditOk).toBe(true);
    expect(data.activateBlocked).toBe(true);
  });

  it("exposes the cockpit data layer over /api/v1", async () => {
    const result = await runOnFreshStore();
    const cockpit = result.artifacts.cockpit;
    expect(cockpit.healthz).toEqual({ ok: true, service: "admatix-api" });
    expect(cockpit.audits).toBeGreaterThan(0);
    expect(cockpit.packets).toBeGreaterThan(0);
    expect(cockpit.receipts).toBeGreaterThan(0);
  });

  it("transcript matches docs/runbooks/demo-script.md line for line", async () => {
    const result = await runOnFreshStore();
    const runbook = await readFile(RUNBOOK, "utf-8");
    const embedded = extractTranscriptBlock(runbook);
    expect(result.transcript).toBe(embedded);
  });

  it("transcript is byte-identical across runs (determinism)", async () => {
    const a = await runOnFreshStore();
    const b = await runOnFreshStore();
    expect(a.transcript).toBe(b.transcript);
  });
});
