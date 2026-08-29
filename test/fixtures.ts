import type { GatewayConfig, GenerateRequest } from "../src/index.js";

/**
 * EVERY slug in this suite is deliberately NONSENSE — "prov-x", "res-y",
 * "deployment-z". That is not decoration: if the whole suite passes against
 * meaningless slugs, the client provably carries no hardcoded vendor knowledge,
 * which is the actual requirement rather than a stylistic one. It also keeps the
 * suite compatible with the no-provider-literals gate by construction.
 */
export const BASE: GatewayConfig = {
  accountId: "acct-123",
  gatewayId: "gw-test",
  model: "deployment-z",
  provider: "prov-x",
};

/** The path-addressed shape: a resource name is what selects it. */
export const PATH_ADDRESSED: GatewayConfig = {
  ...BASE,
  resourceName: "res-y",
  apiVersion: "2099-01-01",
};

export const REQ: GenerateRequest = { system: "sys", user: "usr", temperature: 0.1 };

export const GATEWAY_ROOT = "https://gateway.ai.cloudflare.com/v1/acct-123/gw-test";
