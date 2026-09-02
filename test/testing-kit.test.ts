/**
 * GATE — the `./testing` kit itself.
 *
 * It is shipped, so it is tested. A test double that drifts from the real client's
 * behaviour is worse than no double: every consumer that trusts it inherits the
 * drift, and it fails in the one place nobody looks.
 */
import { describe, it, expect } from "vitest";
import { cassetteClient, fakeFetch } from "../src/testing/index.js";
import { createGatewayClient } from "../src/index.js";
import { BASE, REQ } from "./fixtures.js";

describe("fakeFetch", () => {
  it("records nothing until the client calls it", () => {
    expect(fakeFetch().requests).toEqual([]);
  });

  it("refuses to answer `only()` when there was not exactly one request", async () => {
    const fake = fakeFetch();
    expect(() => fake.only()).toThrow(/expected exactly one request, captured 0/);

    const client = createGatewayClient({ ...BASE, fetchImpl: fake.fetchImpl });
    await client.generate(REQ);
    await client.generate(REQ);
    expect(() => fake.only()).toThrow(/captured 2/);
  });

  it("replays a canned error response, body text and all", async () => {
    const fake = fakeFetch({ ok: false, status: 418, text: "nope" });
    const res = await fake.fetchImpl("https://example.test", {
      method: "POST",
      headers: {},
      body: "{}",
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(418);
    expect(await res.text()).toBe("nope");
  });

  it("stringifies a custom body for text() when no explicit text is given", async () => {
    const fake = fakeFetch({ body: { hello: "world" } });
    const res = await fake.fetchImpl("https://example.test", {
      method: "POST",
      headers: {},
      body: "{}",
    });

    expect(await res.text()).toBe('{"hello":"world"}');
    expect(await res.json()).toEqual({ hello: "world" });
  });
});

describe("cassetteClient", () => {
  it("replays a single scripted response on every call and records the requests", async () => {
    const cassette = cassetteClient("recorded text");

    expect(await cassette.generate(REQ)).toEqual({
      text: "recorded text",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    await cassette.generate({ system: "s2", user: "u2" });

    expect(cassette.calls).toHaveLength(2);
    expect(cassette.calls[1]).toEqual({ system: "s2", user: "u2" });
  });

  it("carries scripted usage through, defaulting the half that was omitted", async () => {
    const cassette = cassetteClient({ text: "t", usage: { inputTokens: 42 } });
    expect((await cassette.generate(REQ)).usage).toEqual({ inputTokens: 42, outputTokens: 0 });
  });

  it("consumes an array in order", async () => {
    const cassette = cassetteClient(["first", { text: "second" }]);

    expect((await cassette.generate(REQ)).text).toBe("first");
    expect((await cassette.generate(REQ)).text).toBe("second");
  });

  it("throws once a scripted sequence is exhausted rather than quietly repeating", async () => {
    // A test making more calls than it scripted has changed behaviour. Serving the
    // last response again would hide precisely that.
    const cassette = cassetteClient(["only one"]);
    await cassette.generate(REQ);

    await expect(cassette.generate(REQ)).rejects.toThrow(/no response scripted for call 2/);
  });
});
