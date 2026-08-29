/**
 * GATE — configuration errors name the value to fix, and cost nothing.
 *
 * Two properties per case: the message names the field (or the consumer's own
 * variable, given a label map), and ZERO requests were made — a bad config must
 * not cost a call.
 *
 * Plus the lazy-resolution contract, which is not a detail: a caller that builds
 * the client eagerly, before opening a database pool, must not have a bad variable
 * throw out of its handler ahead of its own setup and teardown.
 */
import { describe, it, expect } from "vitest";
import { createGatewayClient, GatewayConfigError, type GatewayConfig } from "../src/index.js";
import { fakeFetch } from "../src/testing/index.js";
import { BASE, REQ } from "./fixtures.js";

describe("config errors — every required value, named", () => {
  const cases: Array<[string, Partial<GatewayConfig>, RegExp]> = [
    ["a missing model", { model: undefined }, /^model is not set/],
    [
      "an unfilled model placeholder",
      { model: "<set-at-provision>" },
      /^model is still the unfilled placeholder/,
    ],
    ["a missing provider slug", { provider: undefined }, /^provider is not set/],
    [
      "an unfilled provider placeholder",
      { provider: "<set-at-provision>" },
      /^provider is still the unfilled/,
    ],
    ["a missing account id", { accountId: undefined }, /^accountId is not set/],
    ["a blank account id", { accountId: "   " }, /^accountId is not set/],
    ["a missing gateway id", { gatewayId: "" }, /^gatewayId is not set/],
    [
      "a path-routed provider with no api-version",
      { resourceName: "res-y", apiVersion: undefined },
      /^apiVersion is not set/,
    ],
    [
      "a path-routed provider with an unfilled api-version",
      { resourceName: "res-y", apiVersion: "<set-at-provision>" },
      /^apiVersion is still the unfilled/,
    ],
  ];

  for (const [name, overrides, expected] of cases) {
    it(`throws for ${name}, and makes no request`, async () => {
      const fake = fakeFetch();
      const client = createGatewayClient({ ...BASE, ...overrides, fetchImpl: fake.fetchImpl });

      await expect(client.generate(REQ)).rejects.toThrow(expected);
      await expect(client.generate(REQ)).rejects.toThrow(GatewayConfigError);
      expect(fake.requests).toHaveLength(0);
    });
  }

  it("exposes the offending field on the error, so a caller need not parse the message", async () => {
    const client = createGatewayClient({
      ...BASE,
      provider: undefined,
      fetchImpl: fakeFetch().fetchImpl,
    });
    const err = (await client.generate(REQ).catch((e: unknown) => e)) as GatewayConfigError;

    expect(err.name).toBe("GatewayConfigError");
    expect(err.field).toBe("provider");
  });
});

describe("config errors — the varNames label map", () => {
  it("names the consumer's own variable instead of the config field", async () => {
    const fake = fakeFetch();
    const client = createGatewayClient({
      ...BASE,
      model: "<set-at-provision>",
      fetchImpl: fake.fetchImpl,
      varNames: { model: "AI_MODEL", provider: "LLM_PROVIDER" },
    });

    await expect(client.generate(REQ)).rejects.toThrow(
      /^AI_MODEL is still the unfilled placeholder "<set-at-provision>"/,
    );
  });

  it("falls back to the field name for any label the map does not cover", async () => {
    const client = createGatewayClient({
      ...BASE,
      accountId: undefined,
      fetchImpl: fakeFetch().fetchImpl,
      varNames: { model: "AI_MODEL" },
    });

    await expect(client.generate(REQ)).rejects.toThrow(/^accountId is not set/);
  });
});

describe("config errors — resolution is LAZY", () => {
  it("does not throw at construction, even for a config that cannot possibly work", () => {
    // The regression this locks down: an eager throw escapes the handler before
    // the caller's own teardown runs, taking a database pool down with it.
    expect(() =>
      createGatewayClient({
        model: undefined,
        provider: undefined,
        fetchImpl: fakeFetch().fetchImpl,
      }),
    ).not.toThrow();
  });

  it("resolves the endpoint once and reuses it across calls", async () => {
    const fake = fakeFetch();
    let calls = 0;
    const client = createGatewayClient({
      ...BASE,
      fetchImpl: fake.fetchImpl,
      resolveEndpoint: () => {
        calls++;
        return { url: "https://third.example.test/x" };
      },
    });

    await client.generate(REQ);
    await client.generate(REQ);

    expect(calls).toBe(1);
    expect(fake.requests).toHaveLength(2);
  });
});
