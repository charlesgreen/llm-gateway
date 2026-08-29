/**
 * GATE — reading the response, and failing safely.
 *
 * The usage mapping is the regression that matters: an earlier client read field
 * names a chat-completions body never carries, so a cost ledger downstream saw
 * zeros on every call and its spend cap never fired.
 */
import { describe, it, expect } from "vitest";
import { createGatewayClient, GatewayResponseError } from "../src/index.js";
import { fakeFetch } from "../src/testing/index.js";
import { BASE, PATH_ADDRESSED, REQ } from "./fixtures.js";

describe("response — text and usage", () => {
  it("maps the wire token counters onto the port's neutral names", async () => {
    const fake = fakeFetch();
    const out = await createGatewayClient({ ...BASE, fetchImpl: fake.fetchImpl }).generate(REQ);

    expect(out.text).toBe('{"ok":true}');
    expect(out.usage).toEqual({ inputTokens: 1200, outputTokens: 300 });
  });

  it("defaults usage to zeros, never NaN, when the response omits the usage block", async () => {
    const fake = fakeFetch({ body: { choices: [{ message: { content: "{}" } }] } });
    const out = await createGatewayClient({ ...BASE, fetchImpl: fake.fetchImpl }).generate(REQ);

    expect(out.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("yields an empty string rather than throwing when the response carries no choices", async () => {
    // The caller owns parsing; an empty payload is its parse failure to report,
    // not a transport error to retry.
    const fake = fakeFetch({ body: { usage: { prompt_tokens: 5, completion_tokens: 0 } } });
    const out = await createGatewayClient({ ...BASE, fetchImpl: fake.fetchImpl }).generate(REQ);

    expect(out.text).toBe("");
    expect(out.usage.inputTokens).toBe(5);
  });
});

describe("response — upstream failures are redacted", () => {
  it("strips the configured model, provider and resource out of the error body", async () => {
    // The thrown message is routinely stringified onto a record, PERSISTED and
    // logged. A 4xx body that echoes the deployment name back would put the model
    // id in the database and the logs, where a source-only scan cannot see it.
    const fake = fakeFetch({
      ok: false,
      status: 400,
      text: 'The deployment "deployment-z" on resource res-y for PROV-X was rejected',
    });
    const client = createGatewayClient({ ...PATH_ADDRESSED, fetchImpl: fake.fetchImpl });

    const err = (await client.generate(REQ).catch((e: unknown) => e)) as GatewayResponseError;

    expect(err).toBeInstanceOf(GatewayResponseError);
    expect(err.message).not.toContain("deployment-z");
    expect(err.message).not.toContain("res-y");
    // Redaction is case-insensitive — the body shouted the provider slug back.
    expect(err.message).not.toContain("PROV-X");
    expect(err.message).toContain("<redacted>");
  });

  it("preserves the HTTP status, which is the useful diagnostic and carries nothing", async () => {
    const fake = fakeFetch({ ok: false, status: 429, text: "slow down" });
    const client = createGatewayClient({ ...BASE, fetchImpl: fake.fetchImpl });

    const err = (await client.generate(REQ).catch((e: unknown) => e)) as GatewayResponseError;

    expect(err.status).toBe(429);
    expect(err.message).toMatch(/HTTP 429/);
    expect(err.message).toContain("slow down");
  });

  it("still throws with the status when the error body itself cannot be read", async () => {
    const failingBody = {
      fetchImpl: async () => ({
        ok: false,
        status: 502,
        text: () => Promise.reject(new Error("stream closed")),
        json: async () => ({}),
      }),
    };
    const client = createGatewayClient({ ...BASE, ...failingBody });

    await expect(client.generate(REQ)).rejects.toThrow(/HTTP 502/);
  });

  it("truncates a very long error body rather than propagating it whole", async () => {
    const fake = fakeFetch({ ok: false, status: 500, text: "x".repeat(5000) });
    const client = createGatewayClient({ ...BASE, fetchImpl: fake.fetchImpl });

    const err = (await client.generate(REQ).catch((e: unknown) => e)) as Error;
    expect(err.message.length).toBeLessThan(500);
  });
});
