export interface HttpRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly query_name?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

export interface HttpTransport {
  request(request: HttpRequest): Promise<HttpResponse>;
}

const FORBIDDEN_URL =
  /mutate|create|update|delete|remove|pause|resume|enable|disable|campaignbudgets|adgroupads|adgroups/i;

export function assertReadOnlyHttpRequest(request: HttpRequest): void {
  const target = `${request.method} ${request.url} ${request.query_name ?? ""}`;
  if (FORBIDDEN_URL.test(target)) {
    throw new Error(`read-only connector blocked write-like API path: ${request.query_name ?? request.url}`);
  }
  if (request.method === "GET") return;
  if (request.method === "POST" && /googleAds:search(?:Stream)?$/i.test(request.url)) return;
  throw new Error(`read-only connector blocked HTTP ${request.method} request to ${request.url}`);
}

export function redactHttpRequest(request: HttpRequest): HttpRequest {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    headers[key] = /authorization|developer-token|api-key|cookie/i.test(key) ? "***" : value;
  }
  return { ...request, headers };
}

export function createFetchTransport(fetchImpl: typeof fetch = fetch): HttpTransport {
  return {
    async request(request) {
      assertReadOnlyHttpRequest(request);
      const res = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      });
      const body = (await res.json().catch(() => null)) as unknown;
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body,
      };
    },
  };
}
