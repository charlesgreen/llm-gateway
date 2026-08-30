/**
 * GATE — the URL the client builds, over an injected fake fetch.
 *
 * The routing decision is PRESENCE-DRIVEN: a resource name selects the
 * path-addressed shape, its absence selects the unified one. No vendor name is
 * compared anywhere, so these assertions are what prove the shape is reachable
 * from config alone.
 */
import { describe, it, expect } from "vitest";
import { createGatewayClient, type Endpoint, type ResolvedConfig } from "../src/index.js";
import { fakeFetch } from "../src/testing/index.js";
import { BASE, GATEWAY_ROOT, PATH_ADDRESSED, REQ } from "./fixtures.js";

describe("routing — the two URL shapes", () => {
  it("addresses a path-routed provider by resource and model in the URL, with no model in the body", async () => {
    const fake = fakeFetch();
    await createGatewayClient({ ...PATH_ADDRESSED, fetchImpl: fake.fetchImpl }).generate(REQ);

    expect(fake.only().url).toBe(
      `${GATEWAY_ROOT}/prov-x/res-y/deployment-z/chat/completions?api-version=2099-01-01`,
    );
    // The resource and the model are already in the path; sending a model field
    // too is at best ignored and at worst rejected.
    expect(fake.body().model).toBeUndefined();
  });

  it("falls back to the unified endpoint and qualifies the model in the body when no resource is configured", async () => {
    const fake = fakeFetch();
    await createGatewayClient({ ...BASE, fetchImpl: fake.fetchImpl }).generate(REQ);

    expect(fake.only().url).toBe(`${GATEWAY_ROOT}/compat/chat/completions`);
    expect(fake.body().model).toBe("prov-x/deployment-z");
  });

  it("routes a THIRD, distinct unified provider through the identical code path — no branch, no release", async () => {
    // Regression lock on the design's central claim: the router never compares
    // against a provider identity, so a provider this suite has never named
    // before is supported purely by config. If this ever required a code
    // change, the client would have started branching on provider identity.
    const fake = fakeFetch();
    await createGatewayClient({
      accountId: "acct-123",
      gatewayId: "gw-test",
      provider: "prov-q",
      model: "model-w",
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.only().url).toBe(`${GATEWAY_ROOT}/compat/chat/completions`);
    expect(fake.body().model).toBe("prov-q/model-w");
  });

  it("treats an unfilled <placeholder> resource as unset rather than routing to a bogus path", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      resourceName: "<set-at-provision>",
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.only().url).toBe(`${GATEWAY_ROOT}/compat/chat/completions`);
  });

  it("percent-encodes every path segment it interpolates", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...PATH_ADDRESSED,
      provider: "prov x",
      resourceName: "res/y",
      model: "deployment z",
      apiVersion: "2099 01 01",
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.only().url).toBe(
      `${GATEWAY_ROOT}/prov%20x/res%2Fy/deployment%20z/chat/completions?api-version=2099%2001%2001`,
    );
  });
});

describe("routing — baseUrl override", () => {
  it("wins over the account and gateway ids, which are then not required at all", async () => {
    const fake = fakeFetch();
    // Neither id is supplied. A client that still demanded them would make the
    // override useless for the case it exists to serve.
    await createGatewayClient({
      model: "deployment-z",
      provider: "prov-x",
      baseUrl: "https://gw.example.test/v1/acct/gw",
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.only().url).toBe("https://gw.example.test/v1/acct/gw/compat/chat/completions");
  });

  it("strips a dashboard-pasted chat-completions URL back to the gateway root", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...PATH_ADDRESSED,
      // What the dashboard hands out. Left intact it would bury the unified
      // segments in the middle of the path-addressed URL.
      baseUrl: "https://gw.example.test/v1/acct/gw/compat/chat/completions",
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.only().url).toBe(
      "https://gw.example.test/v1/acct/gw" +
        "/prov-x/res-y/deployment-z/chat/completions?api-version=2099-01-01",
    );
  });

  it("tolerates a trailing slash", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      baseUrl: "https://gw.example.test/v1/acct/gw/",
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.only().url).toBe("https://gw.example.test/v1/acct/gw/compat/chat/completions");
  });

  it("ignores an unfilled <placeholder> baseUrl and composes from the ids instead", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      baseUrl: "<set-at-provision>",
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.only().url).toBe(`${GATEWAY_ROOT}/compat/chat/completions`);
  });
});

describe("routing — the resolveEndpoint escape hatch", () => {
  it("receives a fully RESOLVED config and its URL wins", async () => {
    const fake = fakeFetch();
    const seen: ResolvedConfig[] = [];
    const resolveEndpoint = (cfg: ResolvedConfig): Endpoint => {
      seen.push(cfg);
      return { url: "https://third.example.test/some/other/layout" };
    };

    await createGatewayClient({
      ...PATH_ADDRESSED,
      resolveEndpoint,
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.only().url).toBe("https://third.example.test/some/other/layout");
    expect(seen).toEqual([
      {
        baseUrl: GATEWAY_ROOT,
        provider: "prov-x",
        model: "deployment-z",
        resourceName: "res-y",
        apiVersion: "2099-01-01",
      },
    ]);
  });

  it("does not demand an api-version — the override owns the whole URL", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      resourceName: "res-y",
      apiVersion: undefined,
      resolveEndpoint: () => ({ url: "https://third.example.test/no-version" }),
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.only().url).toBe("https://third.example.test/no-version");
  });

  it("can still name the model in the body when the third layout wants it there", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...PATH_ADDRESSED,
      resolveEndpoint: (cfg) => ({
        url: "https://third.example.test/x",
        qualifiedModel: `${cfg.provider}::${cfg.model}`,
      }),
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.body().model).toBe("prov-x::deployment-z");
  });

  it("still redacts an upstream error body — the override changes the URL, not the safety", async () => {
    const fake = fakeFetch({
      ok: false,
      status: 400,
      text: 'deployment "deployment-z" on res-y for PROV-X was rejected',
    });
    const client = createGatewayClient({
      ...PATH_ADDRESSED,
      resolveEndpoint: () => ({ url: "https://third.example.test/x" }),
      fetchImpl: fake.fetchImpl,
    });

    const message = await client.generate(REQ).catch((err: Error) => err.message);
    expect(message).not.toContain("deployment-z");
    expect(message).not.toContain("res-y");
    expect(message).not.toContain("PROV-X");
  });
});
