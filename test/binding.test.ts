/**
 * GATE — the default fetch is BOUND to the global.
 *
 * The platform `fetch` on a Workers-class runtime is a brand-checked host
 * function: it must be called with the global as its receiver. Stored unbound and
 * called through a reference it throws "Illegal invocation" on EVERY call — a
 * failure that reads like a network problem, resists diagnosis, and has cost a
 * full day of misdirected debugging before.
 *
 * The honest version of this test needs care. Node's own `fetch` does NOT brand
 * check, so a naive "construct with no fetchImpl and assert it works" passes
 * whether or not the client binds, and proves nothing. So this file installs a
 * stub that DOES brand check — and then proves the stub can actually fire, which
 * is the difference between a test and a brand-check simulator nobody has watched
 * go red.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createGatewayClient } from "../src/index.js";
import { BASE, REQ } from "./fixtures.js";

const ILLEGAL = "Illegal invocation: function called with incorrect `this` reference";

const realFetch = globalThis.fetch;

/** A stand-in for the platform's brand-checked host `fetch`. */
function installBrandCheckedFetch(): void {
  const stub = function (this: unknown) {
    if (this !== globalThis) throw new TypeError(ILLEGAL);
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async () => "{}",
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      }),
    });
  };
  (globalThis as any).fetch = stub;
}

afterEach(() => {
  (globalThis as any).fetch = realFetch;
});

describe("the default fetch is bound to the global", () => {
  it("CONTROL: the stub really does reject an unbound call (otherwise this suite proves nothing)", () => {
    installBrandCheckedFetch();
    const unbound = globalThis.fetch;

    // Called through a bare reference, so `this` is undefined under ESM strict
    // mode. If this does NOT throw, the stub is not discriminating and the
    // assertion below is worthless.
    expect(() => (unbound as any)("https://example.test", {})).toThrow(/Illegal invocation/);
  });

  it("calls the platform fetch successfully with no fetchImpl injected", async () => {
    installBrandCheckedFetch();

    // No fetchImpl: the client must have captured `fetch.bind(globalThis)`.
    const out = await createGatewayClient({ ...BASE }).generate(REQ);

    expect(out.text).toBe("ok");
    expect(out.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
  });
});
