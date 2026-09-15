import {
  configuredOrUndefined,
  GatewayConfigError,
  labelFor,
  requireConfigured,
} from "./config.js";
import type { Endpoint, GatewayConfig, ResolvedConfig } from "./types.js";

/** The default gateway host. Only used when no `baseUrl` override is supplied. */
const GATEWAY_ORIGIN = "https://gateway.ai.cloudflare.com/v1";

/**
 * Reduce a supplied base URL to the gateway ROOT.
 *
 * The dashboard hands out a URL that already points at the unified
 * chat-completions path. Pasting that into config and then selecting the
 * path-addressed shape — whose path diverges earlier — would build a URL with the
 * unified segments buried in the middle of it. Cheap to strip; a real foot-gun
 * otherwise.
 */
export function stripToGatewayRoot(value: string): string {
  let out = value.trim().replace(/\/+$/, "");
  out = out.replace(/\/chat\/completions$/i, "");
  out = out.replace(/\/compat$/i, "");
  return out.replace(/\/+$/, "");
}

/**
 * The gateway root shared by both URL shapes.
 *
 * `baseUrl` WINS: when it is supplied the account and gateway ids are not required
 * at all, because they exist only to compose the very string it already carries.
 */
export function resolveGatewayBase(config: GatewayConfig): string {
  const explicit = configuredOrUndefined(config.baseUrl);
  if (explicit) return stripToGatewayRoot(explicit);

  const accountId = requireConfigured(
    config,
    "accountId",
    "the Cloudflare account id — half of the gateway base URL; supply baseUrl instead to give the URL directly",
  );
  const gatewayId = requireConfigured(
    config,
    "gatewayId",
    "the AI Gateway id — the other half of the gateway base URL",
  );
  return `${GATEWAY_ORIGIN}/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}`;
}

/**
 * Validate the config and reduce it to the values the URL is built from.
 *
 * Runs BEFORE any endpoint override, so `resolveEndpoint` always receives a
 * resolved, validated config rather than raw input it would have to re-check.
 * Note what is NOT validated here: the api-version, which is a requirement of the
 * DEFAULT path-addressed layout only — a consumer overriding the URL may have no
 * use for it.
 */
export function resolveConfig(config: GatewayConfig): ResolvedConfig {
  const model = requireConfigured(config, "model", "the model id");
  const provider = requireConfigured(
    config,
    "provider",
    "the gateway provider slug — required for every URL shape",
  );
  const resourceName = configuredOrUndefined(config.resourceName);
  const projectId = configuredOrUndefined(config.projectId);
  const location = configuredOrUndefined(config.location);
  if (resourceName && (projectId || location)) {
    throw new GatewayConfigError(
      `${labelFor(config, "projectId")} cannot be set together with ${labelFor(config, "resourceName")} ` +
        `(two URL shapes were asked for)`,
      "projectId",
    );
  }
  return {
    baseUrl: resolveGatewayBase(config),
    provider,
    model,
    resourceName,
    apiVersion: configuredOrUndefined(config.apiVersion),
    projectId,
    location,
    publisher: configuredOrUndefined(config.publisher),
    rpc: configuredOrUndefined(config.rpc),
  };
}

/**
 * The URL shapes, selected by the PRESENCE of config fields — never by comparing
 * a provider name.
 *
 * - no resource, no project → unified chat-completions
 * - a resource name → path-addressed chat-completions
 * - a project id and a location → project-located rpc (a different request
 *   envelope; see `buildBody` in the client)
 *
 * That last shape is how a provider whose native API is not chat-completions
 * still gets the right URL AND the right body, without a vendor-name branch.
 */
export function defaultEndpoint(config: GatewayConfig, resolved: ResolvedConfig): Endpoint {
  const { baseUrl, provider, model, resourceName, projectId, location } = resolved;

  if (projectId || location) {
    const pid = requireConfigured(
      config,
      "projectId",
      "the project-located URL shape requires a project id",
    );
    const loc = requireConfigured(
      config,
      "location",
      "the project-located URL shape requires a location",
    );
    const publisher = requireConfigured(
      config,
      "publisher",
      "the project-located URL shape requires a publisher path segment",
    );
    const rpc = requireConfigured(
      config,
      "rpc",
      "the project-located URL shape requires an rpc method",
    );
    return {
      url:
        `${baseUrl}/${encodeURIComponent(provider)}/v1/projects/${encodeURIComponent(pid)}` +
        `/locations/${encodeURIComponent(loc)}/publishers/${encodeURIComponent(publisher)}` +
        `/models/${encodeURIComponent(model)}:${encodeURIComponent(rpc)}`,
    };
  }

  if (!resourceName) {
    return {
      url: `${baseUrl}/compat/chat/completions`,
      qualifiedModel: `${provider}/${model}`,
    };
  }

  // Fail HERE, naming the field. Without the api-version the request is rejected
  // upstream with a message that says nothing about which local value is missing.
  const apiVersion = requireConfigured(
    config,
    "apiVersion",
    "the path-addressed URL shape requires an api-version query parameter",
  );

  return {
    url:
      `${baseUrl}/${encodeURIComponent(provider)}/${encodeURIComponent(resourceName)}` +
      `/${encodeURIComponent(model)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
  };
}

/** Resolve the endpoint, giving the consumer's override the final word on the URL. */
export function resolveEndpoint(config: GatewayConfig): Endpoint {
  const resolved = resolveConfig(config);
  return config.resolveEndpoint
    ? config.resolveEndpoint(resolved)
    : defaultEndpoint(config, resolved);
}
