/**
 * GATE — the auth headers.
 *
 * The two credentials answer DIFFERENT questions (may this caller use the gateway?
 * / who pays the provider?) and therefore compose. Treating them as alternatives
 * produces a 401 that looks nothing like a billing problem, and throwing when
 * neither is present would break a deployment that stores its provider key inside
 * the gateway — a fully supported production state.
 */
import { describe, it, expect } from "vitest";
import { createGatewayClient, GatewayConfigError } from "../src/index.js";
import { fakeFetch } from "../src/testing/index.js";
import { BASE, REQ } from "./fixtures.js";

/** The exact header key set, so an unexpected EXTRA header fails too. */
function headerKeys(headers: Record<string, string>): string[] {
  return Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort();
}

describe("auth — zero credentials is valid", () => {
  it("sends only content-type when neither credential is configured", async () => {
    const fake = fakeFetch();
    await createGatewayClient({ ...BASE, fetchImpl: fake.fetchImpl }).generate(REQ);

    expect(fake.headers()["content-type"]).toBe("application/json");
    expect(headerKeys(fake.headers())).toEqual(["content-type"]);
  });
});

describe("auth — the gateway-hop token", () => {
  it("sends cf-aig-authorization when a gateway token is configured", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      gatewayToken: "tok-1",
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.headers()["cf-aig-authorization"]).toBe("Bearer tok-1");
  });

  it("omits it for an unfilled <placeholder> token", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      gatewayToken: "<set-at-provision>",
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(headerKeys(fake.headers())).toEqual(["content-type"]);
  });
});

describe("auth — the provider key", () => {
  it("defaults to a bearer authorization header when no providerAuth is given", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      providerKey: "key-1",
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.headers()["authorization"]).toBe("Bearer key-1");
  });

  it("sends the key BARE when providerAuth names a header but no scheme", async () => {
    // The case the field exists for: a path-addressed provider commonly wants the
    // raw key in its own header, with no bearer prefix.
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      providerKey: "key-1",
      providerAuth: { header: "api-key" },
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.headers()["api-key"]).toBe("key-1");
    expect(headerKeys(fake.headers())).toEqual(["api-key", "content-type"]);
  });

  it("honours a custom header AND scheme, normalizing the header name to lower case", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      providerKey: "key-1",
      providerAuth: { header: "X-Provider-Token", scheme: "Token" },
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.headers()["x-provider-token"]).toBe("Token key-1");
  });

  it("omits it for an unfilled <placeholder> key", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      providerKey: "<set-at-provision>",
      providerAuth: { header: "api-key" },
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(headerKeys(fake.headers())).toEqual(["content-type"]);
  });

  it("throws naming providerAuth when a key is configured with a blank header name", async () => {
    const fake = fakeFetch();
    const client = createGatewayClient({
      ...BASE,
      providerKey: "key-1",
      providerAuth: { header: "  " },
      fetchImpl: fake.fetchImpl,
    });

    await expect(client.generate(REQ)).rejects.toThrow(GatewayConfigError);
    await expect(client.generate(REQ)).rejects.toThrow(/providerAuth\.header is not set/);
    expect(fake.requests).toHaveLength(0);
  });
});

describe("auth — the two credentials COMPOSE", () => {
  it("sends both when both are configured", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      gatewayToken: "tok-1",
      providerKey: "key-1",
      providerAuth: { header: "api-key" },
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.headers()["cf-aig-authorization"]).toBe("Bearer tok-1");
    expect(fake.headers()["api-key"]).toBe("key-1");
    expect(headerKeys(fake.headers())).toEqual(["api-key", "cf-aig-authorization", "content-type"]);
  });
});
