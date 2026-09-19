/**
 * GATE — gateway passthrough headers.
 *
 * Consumers use Cloudflare AI Gateway features like metadata logging and cache
 * controls (e.g. `cf-aig-metadata`, `cf-aig-cache-ttl`, `cf-aig-skip-cache`).
 * These headers pass through directly to the gateway hop, both at client level
 * and per-request.
 */
import { describe, it, expect } from "vitest";
import { createGatewayClient } from "../src/index.js";
import { fakeFetch } from "../src/testing/index.js";
import { BASE, REQ } from "./fixtures.js";

function headerKeys(headers: Record<string, string>): string[] {
  return Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort();
}

describe("headers — client-level passthrough", () => {
  it("passes configured headers through to the request", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      headers: {
        "cf-aig-metadata": '{"env":"test"}',
        "cf-aig-cache-ttl": "300",
      },
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.headers()["cf-aig-metadata"]).toBe('{"env":"test"}');
    expect(fake.headers()["cf-aig-cache-ttl"]).toBe("300");
    expect(fake.headers()["content-type"]).toBe("application/json");
  });

  it("normalizes header names to lower case and trims keys", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      headers: {
        "  X-Custom-Trace-ID  ": "tr-123",
      },
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.headers()["x-custom-trace-id"]).toBe("tr-123");
    expect(headerKeys(fake.headers())).toEqual(["content-type", "x-custom-trace-id"]);
  });

  it("omits headers with blank or whitespace-only keys", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      headers: {
        "   ": "ignored",
      },
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(headerKeys(fake.headers())).toEqual(["content-type"]);
  });

  it("omits headers with unfilled <placeholder> values", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      headers: {
        "cf-aig-metadata": "<set-at-runtime>",
        "x-valid-header": "val-1",
      },
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.headers()["cf-aig-metadata"]).toBeUndefined();
    expect(fake.headers()["x-valid-header"]).toBe("val-1");
  });
});

describe("headers — request-level passthrough and overrides", () => {
  it("sends per-request headers when no client headers are set", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      fetchImpl: fake.fetchImpl,
    }).generate({
      ...REQ,
      headers: { "cf-aig-cache-ttl": "60" },
    });

    expect(fake.headers()["cf-aig-cache-ttl"]).toBe("60");
    expect(fake.headers()["content-type"]).toBe("application/json");
  });

  it("merges per-request headers over client headers, overriding matching keys", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      headers: {
        "cf-aig-cache-ttl": "300",
        "x-client-tag": "client-val",
      },
      fetchImpl: fake.fetchImpl,
    }).generate({
      ...REQ,
      headers: {
        "CF-AIG-CACHE-TTL": "60",
        "x-request-tag": "req-val",
      },
    });

    expect(fake.headers()["cf-aig-cache-ttl"]).toBe("60");
    expect(fake.headers()["x-client-tag"]).toBe("client-val");
    expect(fake.headers()["x-request-tag"]).toBe("req-val");
  });

  it("omits per-request headers with blank keys or placeholder values", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      fetchImpl: fake.fetchImpl,
    }).generate({
      ...REQ,
      headers: {
        "  ": "bad",
        "cf-aig-metadata": "<unset>",
      },
    });

    expect(headerKeys(fake.headers())).toEqual(["content-type"]);
  });
});

describe("headers — composition with gateway token and provider auth", () => {
  it("preserves custom headers alongside gatewayToken and providerKey", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      gatewayToken: "gw-tok",
      providerKey: "prov-key",
      providerAuth: { header: "api-key" },
      headers: {
        "cf-aig-metadata": '{"app":"gateway-test"}',
      },
      fetchImpl: fake.fetchImpl,
    }).generate({
      ...REQ,
      headers: {
        "x-trace-id": "trace-456",
      },
    });

    expect(fake.headers()["cf-aig-authorization"]).toBe("Bearer gw-tok");
    expect(fake.headers()["api-key"]).toBe("prov-key");
    expect(fake.headers()["cf-aig-metadata"]).toBe('{"app":"gateway-test"}');
    expect(fake.headers()["x-trace-id"]).toBe("trace-456");
    expect(fake.headers()["content-type"]).toBe("application/json");
    expect(headerKeys(fake.headers())).toEqual([
      "api-key",
      "cf-aig-authorization",
      "cf-aig-metadata",
      "content-type",
      "x-trace-id",
    ]);
  });
});
