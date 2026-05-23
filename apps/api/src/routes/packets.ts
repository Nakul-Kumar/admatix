import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  H0Packet,
  type H0Packet as H0PacketT,
} from "@admatix/schemas";
import type { Store } from "@admatix/core";
import { verifyEvidence } from "@admatix/policy";

const PacketsListResponse = z.object({
  packets: z.array(H0Packet),
});

const PacketWithValidity = z.object({
  packet: H0Packet,
  validity: z.object({
    ok: z.boolean(),
    missing: z.array(z.string()),
  }),
});

export interface PacketsDeps {
  store: Store;
}

/** Read-side routes for H0 packets. */
export function registerPacketsRoutes(app: FastifyInstance, deps: PacketsDeps): void {
  app.get("/api/v1/packets", async (req, reply) => {
    const identity = req.identity;
    if (!identity) {
      reply.code(401);
      return { error: "unauthorized" };
    }
    const packets = await deps.store.list<H0PacketT>("h0_packets");
    const parsed = packets
      .map((p) => H0Packet.parse(p))
      .filter((p) => p.tenant_id === identity.tenant_id);
    return PacketsListResponse.parse({ packets: parsed });
  });

  app.get("/api/v1/packets/:packetId", async (req, reply) => {
    const identity = req.identity;
    if (!identity) {
      reply.code(401);
      return { error: "unauthorized" };
    }
    const params = z.object({ packetId: z.string() }).safeParse(req.params);
    if (!params.success) {
      reply.code(400);
      return { error: "invalid_request" };
    }
    const stored = await deps.store.get<H0PacketT>("h0_packets", params.data.packetId);
    if (!stored) {
      reply.code(404);
      return { error: "not_found" };
    }
    const packet = H0Packet.parse(stored);
    if (packet.tenant_id !== identity.tenant_id) {
      reply.code(404);
      return { error: "not_found" };
    }
    const validity = verifyEvidence(packet);
    return PacketWithValidity.parse({ packet, validity });
  });
}
