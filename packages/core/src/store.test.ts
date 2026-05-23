import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "./store.js";

describe("Store — filesystem persistence (WP-B acceptance #4)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "admatix-core-store-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips put → get", async () => {
    const store = createStore(root);
    const value = { id: "h0_001", goal: "Reduce CAC", spend: 1234.5 };
    await store.put("h0_packets", "h0_001", value);
    const fetched = await store.get<typeof value>("h0_packets", "h0_001");
    expect(fetched).toEqual(value);
  });

  it("returns null for missing keys", async () => {
    const store = createStore(root);
    expect(await store.get("h0_packets", "missing")).toBeNull();
  });

  it("lists all docs in a collection", async () => {
    const store = createStore(root);
    await store.put("audit_reports", "r1", { id: "r1", account: "acc_a" });
    await store.put("audit_reports", "r2", { id: "r2", account: "acc_b" });
    const all = await store.list<{ id: string }>("audit_reports");
    expect(all.map((x) => x.id).sort()).toEqual(["r1", "r2"]);
  });

  it("list filters by shallow equality", async () => {
    const store = createStore(root);
    await store.put("audit_reports", "r1", { id: "r1", account: "acc_a" });
    await store.put("audit_reports", "r2", { id: "r2", account: "acc_b" });
    const filtered = await store.list<{ id: string; account: string }>(
      "audit_reports",
      { account: "acc_a" },
    );
    expect(filtered.map((x) => x.id)).toEqual(["r1"]);
  });

  it("list returns [] for a never-written collection", async () => {
    const store = createStore(root);
    expect(await store.list("does_not_exist")).toEqual([]);
  });

  it("append writes JSONL lines (one record per line)", async () => {
    const store = createStore(root);
    await store.append("wf_demo", { step: "PLAN", ok: true });
    await store.append("wf_demo", { step: "ACTIVATE", ok: true });
    const file = join(root, "events", "wf_demo.jsonl");
    const raw = await readFile(file, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!)).toEqual({ step: "PLAN", ok: true });
    expect(JSON.parse(lines[1]!)).toEqual({ step: "ACTIVATE", ok: true });
  });

  it("rejects names with path-traversal characters", async () => {
    const store = createStore(root);
    await expect(store.put("../etc", "id", {})).rejects.toThrow();
    await expect(store.get("h0_packets", "../../passwd")).rejects.toThrow();
    await expect(store.append("a/b", {})).rejects.toThrow();
  });
});
