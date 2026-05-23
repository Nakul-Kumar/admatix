import {
  AuditReport,
  BenchmarkRun,
  H0Packet,
  type AuditReport as AuditReportT,
  type BenchmarkRun as BenchmarkRunT,
  type H0Packet as H0PacketT,
} from "@admatix/schemas";
import { agencyDemoAudit, agencyDemoPackets, agencyDemoBenchmark } from "./fixtures-fallback.js";

const DEFAULT_BASE =
  typeof window !== "undefined" && window.location?.origin
    ? `${window.location.origin.replace(/\/$/, "")}`
    : "http://127.0.0.1:4001";

const BASE = (import.meta.env?.VITE_ADMATIX_API_BASE as string | undefined) ?? DEFAULT_BASE;

async function tryFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "content-type": "application/json" },
      ...init,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface AuditPayload {
  audit: AuditReportT;
  packets: H0PacketT[];
}

/**
 * The dashboard's primary load: run an audit (or fall back to the bundled
 * agency-demo fixture if the API is down). Either path returns
 * schema-validated payloads.
 */
export async function loadAgencyDemoAudit(): Promise<{ payload: AuditPayload; source: "api" | "fixture" }> {
  const data = await tryFetch<AuditPayload>("/api/v1/audit", {
    method: "POST",
    body: JSON.stringify({
      accountRef: "fixture:acc_demo",
      goal: "reduce_cac",
      tenantId: "tenant_demo",
      window: "2026-05-12..2026-05-21",
    }),
  });
  if (data) {
    return {
      payload: {
        audit: AuditReport.parse(data.audit),
        packets: data.packets.map((p) => H0Packet.parse(p)),
      },
      source: "api",
    };
  }
  return {
    payload: {
      audit: AuditReport.parse(agencyDemoAudit),
      packets: agencyDemoPackets.map((p) => H0Packet.parse(p)),
    },
    source: "fixture",
  };
}

export async function loadPackets(): Promise<{ packets: H0PacketT[]; source: "api" | "fixture" }> {
  const data = await tryFetch<{ packets: H0PacketT[] }>("/api/v1/packets");
  if (data && Array.isArray(data.packets)) {
    return { packets: data.packets.map((p) => H0Packet.parse(p)), source: "api" };
  }
  return { packets: agencyDemoPackets.map((p) => H0Packet.parse(p)), source: "fixture" };
}

export async function loadLatestBenchmark(): Promise<{ run: BenchmarkRunT | null; source: "api" | "fixture" }> {
  const data = await tryFetch<BenchmarkRunT>("/api/v1/benchmarks/latest?suite=safety-v1");
  if (data) return { run: BenchmarkRun.parse(data), source: "api" };
  return { run: BenchmarkRun.parse(agencyDemoBenchmark), source: "fixture" };
}

export async function approvePacket(packetId: string, decision: "approved" | "rejected", decidedBy: string): Promise<{ ok: boolean }> {
  const data = await tryFetch<{ packet: H0PacketT }>("/api/v1/approvals", {
    method: "POST",
    body: JSON.stringify({ packetId, decision, decidedBy }),
  });
  return { ok: data !== null };
}
