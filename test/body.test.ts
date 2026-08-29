/**
 * GATE — the request body.
 *
 * The model-family quirks are EXPLICIT booleans. A regex over model names would be
 * a guess about names that do not exist yet, would fail as an upstream 400 that
 * reads like a generic bad request, and would be a list of model literals.
 */
import { describe, it, expect } from "vitest";
import { createGatewayClient } from "../src/index.js";
import { fakeFetch } from "../src/testing/index.js";
import { BASE, REQ } from "./fixtures.js";

describe("body — messages", () => {
  it("sends the system and user turns in order", async () => {
    const fake = fakeFetch();
    await createGatewayClient({ ...BASE, fetchImpl: fake.fetchImpl }).generate(REQ);

    expect(fake.body().messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
    expect(fake.only().init.method).toBe("POST");
  });
});

describe("body — the output-token cap", () => {
  it("omits any cap unless one is configured", async () => {
    // A cap guessed here would truncate a structured response into a parse failure.
    const fake = fakeFetch();
    await createGatewayClient({ ...BASE, fetchImpl: fake.fetchImpl }).generate(REQ);

    expect(fake.body().max_tokens).toBeUndefined();
    expect(fake.body().max_completion_tokens).toBeUndefined();
  });

  it("sends the plain parameter by default", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      maxOutputTokens: 4096,
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.body().max_tokens).toBe(4096);
    expect(fake.body().max_completion_tokens).toBeUndefined();
  });

  it("sends the completion-scoped parameter when the model family requires it", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      maxOutputTokens: 4096,
      usesMaxCompletionTokens: true,
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.body().max_completion_tokens).toBe(4096);
    expect(fake.body().max_tokens).toBeUndefined();
  });

  it("treats a zero cap as no cap rather than as a cap of zero", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      maxOutputTokens: 0,
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.body().max_tokens).toBeUndefined();
    expect(fake.body().max_completion_tokens).toBeUndefined();
  });
});

describe("body — temperature", () => {
  it("sends it by default", async () => {
    const fake = fakeFetch();
    await createGatewayClient({ ...BASE, fetchImpl: fake.fetchImpl }).generate(REQ);
    expect(fake.body().temperature).toBe(0.1);
  });

  it("omits it when the model family rejects an explicit value", async () => {
    const fake = fakeFetch();
    await createGatewayClient({
      ...BASE,
      supportsTemperature: false,
      fetchImpl: fake.fetchImpl,
    }).generate(REQ);

    expect(fake.body().temperature).toBeUndefined();
  });

  it("omits it when the caller has no opinion", async () => {
    const fake = fakeFetch();
    await createGatewayClient({ ...BASE, fetchImpl: fake.fetchImpl }).generate({
      system: "sys",
      user: "usr",
    });

    expect(fake.body().temperature).toBeUndefined();
  });

  it("sends an explicit zero rather than dropping it as falsy", async () => {
    const fake = fakeFetch();
    await createGatewayClient({ ...BASE, fetchImpl: fake.fetchImpl }).generate({
      system: "sys",
      user: "usr",
      temperature: 0,
    });

    expect(fake.body().temperature).toBe(0);
  });
});
