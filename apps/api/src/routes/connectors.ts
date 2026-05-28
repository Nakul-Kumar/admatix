import type { FastifyInstance } from "fastify";
import {
  ConnectorPreviewInput,
  googleAdsReadOnlyCapabilities,
  previewConnector,
} from "@admatix/connectors";
import { z } from "@admatix/schemas";

const CapabilitiesQuery = z.object({
  platform: z.string().default("google_ads"),
}).strict();

export function registerConnectorRoutes(app: FastifyInstance): void {
  app.get("/api/v1/connectors/capabilities", async (req, reply) => {
    const query = CapabilitiesQuery.parse(req.query ?? {});
    if (query.platform !== "google_ads") {
      return {
        platform: query.platform,
        status: "planned",
        capabilities: null,
        claim_limits: [
          "This connector is roadmap-only until a cassette and read-only adapter are implemented.",
        ],
      };
    }
    return {
      platform: query.platform,
      status: "available",
      capabilities: googleAdsReadOnlyCapabilities,
      claim_limits: [
        "Capabilities describe allowed read paths only; they do not imply live credentials are connected.",
        "Google Ads uses a broad adwords OAuth scope, so AdMatix enforces read-only behavior in code.",
      ],
    };
  });

  app.post("/api/v1/connectors/preview", async (req, reply) => {
    const identity = req.identity;
    if (!identity) {
      reply.code(401);
      return { error: "unauthorized" };
    }
    const payload = ConnectorPreviewInput.parse({
      ...(req.body as Record<string, unknown>),
      tenant_id: identity.tenant_id,
      dry_run_only: true,
    });
    return previewConnector(payload);
  });
}
