/**
 * tests/e2e/phase3-gate.test.ts — Phase 3 gate contribution for WP-S.
 *
 * Closes the Phase 3 gate by running the full loop end-to-end with the
 * real verifier service over HTTP:
 *
 *   1. Boot services/verifier via scripts/start-verifier.sh; assert /healthz.
 *   2. Materialise a clean_ab world via POST /simulate
 *      (n_users=2000, true_lift=0.04, seed=17, noise_sd=0.0).
 *   3. Run runWorkflow(intent, { store, verifierClient, postPeriodDataUriFor }).
 *   4. Assert:
 *      - At least one H0 packet was produced.
 *      - EvidenceLedger and PolicyGuard both ran (event-stream order:
 *        evidence.ok → policy.allow → diff.built → measurement.verified).
 *      - Every ExecutionDiff is dry_run: true.
 *      - Exactly one OutcomeMeasurement row was persisted whose
 *        estimate / ci_low / ci_high / method / verdict round-trip the
 *        verifier's response unchanged.
 *      - The Store's event stream gained a `measurement.verified` event
 *        whose `payload_hash` matches the canonicalised verifier payload.
 *      - The recorded measurement has verdict == "lift_detected" and
 *        ci_low ≤ 0.04 ≤ ci_high.
 *
 * The test boots and stops the verifier itself. If the verifier's venv
 * is not present locally (services/verifier/.venv), the test is skipped
 * with a clear message so a developer's first run does not red-bar.
 */
import {
  execFile as execFileCb,
  spawn,
  type ChildProcess,
  spawnSync,
} from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStore, sha256 } from "@admatix/core";
import {
  createVerifierClient,
  runWorkflow,
  type VerifierClient,
  type VerifyResponsePayload,
} from "@admatix/agents";
import { makeTestEvidenceDeps } from "../../packages/agents/src/test-fixtures.js";

const execFile = promisify(execFileCb);

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const VERIFIER_VENV = join(REPO_ROOT, "services", "verifier", ".venv");
const VERIFIER_PORT = 18_088; // distinct from the default so it doesn't collide with a runbook session
const VERIFIER_BASE_URL = `http://127.0.0.1:${VERIFIER_PORT}`;
const VERIFIER_PID_FILE = `/tmp/admatix-verifier-phase3-${process.pid}.pid`;

const skipReason = (() => {
  if (!existsSync(VERIFIER_VENV)) {
    return `services/verifier/.venv not found — create it with:
  cd services/verifier && python3.12 -m venv .venv && . .venv/bin/activate && pip install -r requirements.lock`;
  }
  return null;
})();

let storeRoot: string | null = null;
let verifierClient: VerifierClient | null = null;
let verifierProcess: ChildProcess | null = null;

beforeAll(async () => {
  if (skipReason !== null) return;
  const env = {
    ...process.env,
    ADMATIX_VERIFIER_PORT: String(VERIFIER_PORT),
    ADMATIX_VERIFIER_HOST: "127.0.0.1",
    ADMATIX_VERIFIER_PID_FILE: VERIFIER_PID_FILE,
    ADMATIX_VERIFIER_LOG: `/tmp/admatix-verifier-phase3-${process.pid}.log`,
  };
  await startVerifier(env);
  verifierClient = createVerifierClient({
    baseUrl: VERIFIER_BASE_URL,
    timeoutMs: 60_000,
  });
  storeRoot = mkdtempSync(join(tmpdir(), "admatix-phase3-"));
}, 120_000);

afterAll(() => {
  if (skipReason !== null) return;
  if (verifierProcess) {
    verifierProcess.kill();
    verifierProcess = null;
  } else {
    spawnSync("bash", [bashPath(join(REPO_ROOT, "scripts", "stop-verifier.sh"))], {
      env: {
        ...process.env,
        ADMATIX_VERIFIER_PID_FILE: VERIFIER_PID_FILE,
      },
    });
  }
  if (storeRoot !== null) {
    rmSync(storeRoot, { recursive: true, force: true });
  }
});

describe.skipIf(skipReason !== null)(
  "Phase 3 gate — simulated agent → AdMatix gates → logs → verifier grades",
  () => {
    it(
      "AT8: end-to-end loop round-trips a clean_ab verdict into the ledger",
      async () => {
        // ---- /healthz -----------------------------------------------------
        const health = await verifierClient!.healthz();
        expect(health.status).toBe("ok");

        // ---- /simulate a clean_ab world -----------------------------------
        const sim = await postJson(`${VERIFIER_BASE_URL}/simulate`, {
          world_type: "clean_ab",
          params: { n_users: 2000, true_lift: 0.04, noise_sd: 0 },
          seed: 17,
        });
        expect(sim.data_uri).toMatch(/^file:\/\//);
        const groundTruthAte = (sim.ground_truth as { ate: number }).ate;
        expect(typeof groundTruthAte).toBe("number");

        // ---- Run the workflow with the real verifier ----------------------
        // Only one packet should be verified — the spec asserts "exactly
        // one OutcomeMeasurement row". `postPeriodDataUriFor` returns the
        // data URI for the first verifier-eligible packet and `null` for
        // every subsequent packet so the test stays deterministic.
        const store = createStore(storeRoot!);
        let verifiedPackets = 0;
        const result = await runWorkflow(
          {
            accountRef: "fixture:acc_demo",
            goal: "reduce_cac",
            tenantId: "tenant_demo",
          },
          {
            store,
            evidence: makeTestEvidenceDeps(),
            verifierClient: verifierClient!,
            postPeriodDataUriFor: () => {
              if (verifiedPackets >= 1) return null;
              verifiedPackets += 1;
              return {
                data_uri: sim.data_uri as string,
                metadata_uri: sim.metadata_uri as string,
                hint: { design: "clean_ab" },
              };
            },
          },
        );

        // ---- At least one packet, all diffs are dry-run -------------------
        expect(result.packets.length).toBeGreaterThanOrEqual(1);
        expect(result.diffs.length).toBeGreaterThanOrEqual(1);
        for (const d of result.diffs) {
          expect(d.dry_run).toBe(true);
        }

        // ---- Read the event stream ----------------------------------------
        const events = readJsonl<{ type: string; payload_hash: string }>(
          join(storeRoot!, "events", `${result.workflow_id}.jsonl`),
        );
        const types = events.map((e) => e.type);
        // Find the verified packet's lifecycle by anchoring on the first
        // `measurement.verified` event and walking backwards. The four
        // expected types must appear in the documented order
        //   evidence.ok → policy.allow|needs_approval → diff.built → measurement.verified
        // for *some* successful packet — other packets in the same run
        // may have policy.block before/after and interleave with this
        // chain, so we anchor on measurement.verified and look back.
        const verifiedIdx = types.indexOf("measurement.verified");
        expect(verifiedIdx).toBeGreaterThanOrEqual(0);
        const diffIdx = types.lastIndexOf("diff.built", verifiedIdx);
        expect(diffIdx).toBeGreaterThanOrEqual(0);
        const policyAllowIdx = Math.max(
          types.lastIndexOf("policy.allow", diffIdx),
          types.lastIndexOf("policy.needs_approval", diffIdx),
        );
        expect(policyAllowIdx).toBeGreaterThanOrEqual(0);
        const evidenceIdx = types.lastIndexOf("evidence.ok", policyAllowIdx);
        expect(evidenceIdx).toBeGreaterThanOrEqual(0);
        expect(diffIdx).toBeGreaterThan(policyAllowIdx);
        expect(policyAllowIdx).toBeGreaterThan(evidenceIdx);
        expect(verifiedIdx).toBeGreaterThan(diffIdx);

        // ---- Exactly one OutcomeMeasurement persisted ---------------------
        const measurements = await store.list<{
          observed_value: number;
          confidence_interval?: [number, number];
          notes: string[];
          passed: boolean;
          evidence: { source: string; ref: string; hash?: string }[];
        }>("outcome_measurements");
        expect(measurements.length).toBe(1);
        const m = measurements[0]!;

        // ---- Round-trip the five fields the spec calls out ----------------
        const noteMap = new Map<string, string>();
        const confounders: string[] = [];
        for (const n of m.notes) {
          const colon = n.indexOf(":");
          if (colon < 0) continue;
          const key = n.slice(0, colon);
          const value = n.slice(colon + 1);
          if (key === "confounder") {
            confounders.push(value);
          } else {
            noteMap.set(key, value);
          }
        }
        const recoveredVerdict = noteMap.get("verdict");
        const recoveredMethod = noteMap.get("method");
        expect(recoveredVerdict).toBeDefined();
        expect(recoveredMethod).toBeDefined();
        expect(recoveredVerdict).toBe("lift_detected");

        // ci_low ≤ 0.04 ≤ ci_high on the recorded measurement.
        expect(m.confidence_interval).toBeDefined();
        const [ciLow, ciHigh] = m.confidence_interval!;
        expect(ciLow).toBeLessThanOrEqual(0.04);
        expect(ciHigh).toBeGreaterThanOrEqual(0.04);
        // observed_value is the verifier's `estimate` — finite number.
        expect(Number.isFinite(m.observed_value)).toBe(true);
        // passed mirrors verdict==lift_detected.
        expect(m.passed).toBe(true);

        // ---- Event payload_hash matches the canonical verifier payload ----
        const verifiedEvent = events.find(
          (e) => e.type === "measurement.verified",
        );
        expect(verifiedEvent).toBeDefined();
        // Reconstruct the expected hash from the persisted measurement's
        // notes + observed_value + ci pair. This proves the ledger row
        // and the OutcomeMeasurement row carry the same canonicalised
        // verifier payload — the "round-trip the verifier's response
        // unchanged" assertion from § Acceptance 8.
        const recovered = recoverVerifierPayload(
          m,
          noteMap,
          confounders,
          result.packets[0]!.packet_id,
        );
        expect(verifiedEvent!.payload_hash).toBe(sha256(recovered));
        // The evidence ref's hash field carries the same sha256.
        expect(m.evidence[0]?.hash).toBe(sha256(recovered));
      },
      180_000,
    );
  },
);

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${url} returned ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

async function startVerifier(env: NodeJS.ProcessEnv): Promise<void> {
  if (process.platform !== "win32") {
    await execFile("bash", [bashPath(join(REPO_ROOT, "scripts", "start-verifier.sh"))], {
      cwd: REPO_ROOT,
      env,
      timeout: 90_000,
    });
    return;
  }

  const python = join(VERIFIER_VENV, "Scripts", "python.exe");
  const verifierDir = join(REPO_ROOT, "services", "verifier");
  const pythonPath = [
    join(REPO_ROOT, "services", "verifier", "src"),
    join(REPO_ROOT, "services", "simulator", "src"),
    env.PYTHONPATH,
  ].filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(delimiter);
  let stderr = "";
  verifierProcess = spawn(
    python,
    [
      "-m",
      "uvicorn",
      "admatix_verifier.app:app",
      "--host",
      env.ADMATIX_VERIFIER_HOST ?? "127.0.0.1",
      "--port",
      env.ADMATIX_VERIFIER_PORT ?? "8088",
    ],
    {
      cwd: verifierDir,
      env: { ...env, PYTHONPATH: pythonPath },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  verifierProcess.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const started = Date.now();
  while (Date.now() - started < 90_000) {
    if (verifierProcess.exitCode !== null) {
      throw new Error(`verifier exited early with ${verifierProcess.exitCode}: ${stderr}`);
    }
    try {
      const health = await fetch(`${VERIFIER_BASE_URL}/healthz`);
      if (health.ok) return;
    } catch {
      // Keep polling until boot timeout.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  verifierProcess.kill();
  verifierProcess = null;
  throw new Error(`verifier failed to answer /healthz within 90s: ${stderr}`);
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

function bashPath(path: string): string {
  if (process.platform !== "win32") return path;
  const slash = path.replace(/\\/g, "/");
  const drive = /^([A-Za-z]):\/(.*)$/.exec(slash);
  if (!drive) return slash;
  const letter = drive[1]!.toLowerCase();
  const rest = drive[2]!;
  const candidates = [`/mnt/${letter}/${rest}`, `/${letter}/${rest}`, slash];
  for (const candidate of candidates) {
    const exists = spawnSync("bash", ["-lc", `test -e ${shellQuote(candidate)}`]);
    if (exists.status === 0) return candidate;
  }
  return candidates[0]!;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Recover the canonical verifier payload from a persisted OutcomeMeasurement.
 * Matches the shape produced by `canonicalVerifierPayload` in the
 * orchestrator: sorted keys, exact field set. Used here to confirm that
 * the measurement row, the event payload_hash, and the evidence-ref hash
 * all point at the same verifier response.
 */
function recoverVerifierPayload(
  m: {
    observed_value: number;
    confidence_interval?: [number, number];
  },
  notes: Map<string, string>,
  confounders: string[],
  packetId: string,
): Record<string, unknown> {
  const ci = m.confidence_interval;
  return {
    causal_status: notes.get("causal_status")!,
    ci_high: ci ? ci[1] : null,
    ci_level: Number(notes.get("ci_level") ?? "0.95"),
    ci_low: ci ? ci[0] : null,
    confounders,
    estimate: m.observed_value,
    method: notes.get("method")!,
    packet_id: packetId,
    tx_id: notes.get("tx_id")!,
    verdict: notes.get("verdict")!,
  };
}
