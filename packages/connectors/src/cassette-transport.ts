import { readFile } from "node:fs/promises";
import { z } from "@admatix/schemas";
import { assertReadOnlyHttpRequest, type HttpRequest, type HttpResponse, type HttpTransport } from "./http-transport.js";

export const ConnectorCassette = z.object({
  schema_version: z.literal("connector-cassette/v1"),
  platform: z.string(),
  api_version: z.string(),
  query_name: z.string(),
  captured_at: z.string(),
  request: z.object({
    method: z.enum(["GET", "POST"]),
    url: z.string(),
  }),
  response: z.object({
    status: z.number().int(),
    rows: z.array(z.record(z.unknown())),
  }),
  metadata: z.record(z.unknown()).default({}),
});
export type ConnectorCassette = z.infer<typeof ConnectorCassette>;

export async function loadConnectorCassette(path: string): Promise<ConnectorCassette> {
  const raw = await readFile(path, "utf8");
  const cassette = ConnectorCassette.parse(JSON.parse(raw));
  assertNoSecretStrings(cassette);
  return cassette;
}

export function createCassetteTransport(cassette: ConnectorCassette): HttpTransport {
  return {
    async request(request: HttpRequest): Promise<HttpResponse> {
      assertReadOnlyHttpRequest(request);
      if (request.method !== cassette.request.method || request.url !== cassette.request.url) {
        throw new Error(`cassette request mismatch for ${cassette.query_name}`);
      }
      return {
        status: cassette.response.status,
        headers: {},
        body: { results: cassette.response.rows },
      };
    },
  };
}

function assertNoSecretStrings(value: unknown): void {
  const text = JSON.stringify(value);
  if (/Bearer\s+|access_token|refresh_token|client_secret|api[_-]?key|authorization|cookie/i.test(text)) {
    throw new Error("connector cassette contains secret-like material");
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) {
    throw new Error("connector cassette contains email-like material");
  }
}
