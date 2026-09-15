import {
  configuredOrUndefined,
  GatewayConfigError,
  GatewayResponseError,
  labelFor,
} from "./config.js";
import { redact } from "./redact.js";
import { resolveEndpoint } from "./routing.js";
import type {
  Endpoint,
  FetchLike,
  GatewayConfig,
  GenerateRequest,
  ModelClient,
  Usage,
} from "./types.js";

/** The chat-completions response body the unified and path-addressed shapes return. */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** The contents-envelope response body the project-located shape returns. */
interface ContentsResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

type GatewayResponse = ChatCompletionResponse & ContentsResponse;

/** Used only when a provider key is configured with no explicit `providerAuth`. */
const DEFAULT_PROVIDER_AUTH = { header: "authorization", scheme: "Bearer" };

/** How much of an upstream error body survives into the thrown message. */
const MAX_ERROR_BODY_CHARS = 400;

/**
 * The two credentials are INDEPENDENT and COMPOSE: one authorizes the gateway hop,
 * the other pays the provider. Both, either, or NEITHER are valid — a deployment
 * that stores its provider key inside the gateway sends no provider credential at
 * all, and throwing on "no credentials" would break exactly that configuration.
 *
 * Header names are normalized to lower case so the emitted set is deterministic
 * regardless of how a consumer spelled it.
 */
function buildHeaders(config: GatewayConfig): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };

  const gatewayToken = configuredOrUndefined(config.gatewayToken);
  if (gatewayToken) headers["cf-aig-authorization"] = `Bearer ${gatewayToken}`;

  const providerKey = configuredOrUndefined(config.providerKey);
  if (providerKey) {
    const auth = config.providerAuth ?? DEFAULT_PROVIDER_AUTH;
    const header = auth.header?.trim().toLowerCase();
    if (!header) {
      throw new GatewayConfigError(
        `${labelFor(config, "providerAuth")}.header is not set ` +
          `(the header name a provider key is sent in)`,
        "providerAuth",
      );
    }
    // No scheme means send the key BARE. That is the point of the field, not a
    // gap: a path-addressed provider commonly wants the raw key in its own header.
    const scheme = auth.scheme?.trim();
    headers[header] = scheme ? `${scheme} ${providerKey}` : providerKey;
  }

  return headers;
}

function isProjectLocated(config: GatewayConfig): boolean {
  return !!(configuredOrUndefined(config.projectId) || configuredOrUndefined(config.location));
}

function buildBody(config: GatewayConfig, endpoint: Endpoint, req: GenerateRequest): string {
  const cap = config.maxOutputTokens;
  const sendTemperature = config.supportsTemperature !== false && req.temperature !== undefined;

  if (isProjectLocated(config)) {
    const generationConfig: Record<string, unknown> = {
      ...(sendTemperature ? { temperature: req.temperature } : {}),
      ...(cap && cap > 0 ? { maxOutputTokens: cap } : {}),
    };
    return JSON.stringify({
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    });
  }

  const tokenParam =
    cap && cap > 0
      ? config.usesMaxCompletionTokens
        ? { max_completion_tokens: cap }
        : { max_tokens: cap }
      : {};

  return JSON.stringify({
    // Named in the body only on the unified endpoint — the path-addressed shape
    // already carries the resource and the model in its URL.
    ...(endpoint.qualifiedModel ? { model: endpoint.qualifiedModel } : {}),
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    ...(sendTemperature ? { temperature: req.temperature } : {}),
    ...tokenParam,
  });
}

function readText(data: GatewayResponse | undefined): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (parts) return parts.map((p) => p.text ?? "").join("");
  return data?.choices?.[0]?.message?.content ?? "";
}

function readUsage(data: GatewayResponse | undefined): Usage {
  if (data?.usageMetadata) {
    return {
      inputTokens: data.usageMetadata.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
    };
  }
  return {
    inputTokens: data?.usage?.prompt_tokens ?? 0,
    outputTokens: data?.usage?.completion_tokens ?? 0,
  };
}

/**
 * Build a client that carries model traffic through Cloudflare AI Gateway. Every
 * provider-shaped decision — the slug, the URL shape, the request envelope, the
 * auth headers, the output-cap parameter, whether temperature is accepted — is a
 * RUNTIME VALUE read from `config`. Nothing in this package compares against a
 * vendor name, which is what makes switching a config change rather than a
 * release.
 *
 * CONFIG IS RESOLVED LAZILY, on the first `generate()` call, NOT in this factory.
 * A caller that constructs the client eagerly — before opening a database pool,
 * say — must not have a bad variable throw out of its handler ahead of its own
 * setup and teardown. Resolved lazily, a misconfiguration surfaces as an ordinary
 * per-call model error that the existing retry path already knows how to report.
 */
export function createGatewayClient(config: GatewayConfig): ModelClient {
  // The platform `fetch` is a brand-checked host function: it MUST be called with
  // the global as its receiver. Stored unbound and called through a reference it
  // throws "Illegal invocation" on EVERY call — a failure that reads like a
  // network problem and is not one. Bind once, here.
  const doFetch: FetchLike = config.fetchImpl ?? (fetch.bind(globalThis) as FetchLike);
  let endpoint: Endpoint | undefined;

  return {
    async generate(req: GenerateRequest) {
      endpoint ??= resolveEndpoint(config);
      const headers = buildHeaders(config);

      const res = await doFetch(endpoint.url, {
        method: "POST",
        headers,
        body: buildBody(config, endpoint, req),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const safe = redact(body, [
          configuredOrUndefined(config.model),
          configuredOrUndefined(config.provider),
          configuredOrUndefined(config.resourceName),
          configuredOrUndefined(config.projectId),
          configuredOrUndefined(config.location),
          configuredOrUndefined(config.publisher),
          configuredOrUndefined(config.rpc),
        ]).slice(0, MAX_ERROR_BODY_CHARS);
        throw new GatewayResponseError(
          `model gateway call failed (HTTP ${res.status}): ${safe}`,
          res.status,
        );
      }

      const data = (await res.json()) as GatewayResponse | undefined;

      // A response with no choices / no candidates yields an empty string rather
      // than a throw: the caller owns parsing, and an empty payload is its parse
      // failure to report, not a transport error to retry.
      return { text: readText(data), usage: readUsage(data) };
    },
  };
}
