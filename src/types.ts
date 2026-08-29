/**
 * The public type surface.
 *
 * Everything here is STRUCTURAL. Nothing forces a consumer into Workers types or
 * Node types, and the package typechecks and tests in a plain Node context.
 * (DESIGN.md §3.2)
 */

/** A single model invocation — prompt text only, provider-agnostic. */
export interface GenerateRequest {
  system: string;
  user: string;
  /**
   * Optional: not every caller has an opinion. A near-greedy value is what makes
   * a caller's golden snapshots deterministic, but that is the caller's concern,
   * not a required parameter of this abstraction.
   */
  temperature?: number;
}

/**
 * Token counters, as the response actually reports them.
 *
 * Neutral names on purpose: neither a runtime binding's vocabulary nor the wire
 * vocabulary leaks into the port. The wire names are mapped INSIDE the client,
 * which is the only place they belong.
 *
 * There is deliberately no cost field. A chat-completions response reports tokens,
 * not money, so a cost field could only ever be a hardcoded zero — and a
 * permanently-zero number that a ledger reads and believes is precisely how a
 * silent under-counting bug happens. Consumers attribute cost from these counts
 * against pricing they own. (DESIGN.md §1.3, §1.7)
 */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResult {
  /** The RAW text the model produced. The caller owns parsing it. */
  text: string;
  usage: Usage;
}

/**
 * THE PORT. The minimal, provider-agnostic seam that makes a consumer hermetically
 * testable: a caller depends on this and nothing else, so its tests inject a
 * cassette and no network call and no spend ever happen in CI.
 */
export interface ModelClient {
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

/** The minimal response surface the client reads (structural — no lib dependency). */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** The request `init` the client builds. Narrow by design — it is all that is sent. */
export interface FetchInitLike {
  method: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * The minimal `fetch` surface the client needs — THE TEST SEAM. A hermetic test
 * injects a fake and asserts the URL, headers and body the client built.
 */
export type FetchLike = (url: string, init: FetchInitLike) => Promise<FetchResponseLike>;

/**
 * How to send `providerKey`.
 *
 * Both parts are configuration rather than inference. The alternative — deciding
 * the header from the provider's name — would put a vendor name comparison, and
 * therefore a vendor name literal, into this package's source. It also happens to
 * be wrong the first time a provider changes its scheme.
 *
 * Omitting `scheme` sends the key BARE, with no prefix. That is not an oversight:
 * it is the case this field exists for, since a path-addressed provider commonly
 * wants the raw key in its own header rather than a bearer prefix.
 */
export interface ProviderAuth {
  header: string;
  scheme?: string;
}

/** A fully-resolved, validated configuration, handed to `resolveEndpoint`. */
export interface ResolvedConfig {
  /** The gateway root, with no trailing slash and no endpoint path. */
  baseUrl: string;
  provider: string;
  model: string;
  /** Present only when the path-addressed shape was selected. */
  resourceName?: string;
  apiVersion?: string;
}

/** Where to POST, and what (if anything) to name in the body. */
export interface Endpoint {
  url: string;
  /**
   * The qualified `{provider}/{model}` sent in the body on the unified endpoint.
   * UNDEFINED on the path-addressed shape, where the resource and the model are
   * already in the URL and also sending a model field is at best ignored and at
   * worst rejected.
   */
  qualifiedModel?: string;
}

export interface GatewayConfig {
  // --- gateway address ---
  /** Cloudflare account id — half of the gateway base URL. */
  accountId?: string;
  /** AI Gateway id — the other half. */
  gatewayId?: string;
  /**
   * Full base-URL override; WINS over `accountId` + `gatewayId`, which are then
   * not required. Accepts a URL pasted from the Cloudflare dashboard (which points
   * at the unified chat-completions path) and strips it back to the gateway root,
   * so a hand-copied value still works for the path-addressed shape, whose path
   * diverges earlier.
   */
  baseUrl?: string;

  // --- model selection ---
  /**
   * The gateway's provider slug. Required on BOTH shapes: the path-addressed URL
   * carries it as a path segment and the unified endpoint carries it in the model
   * string. A RUNTIME VALUE — never compared against a literal anywhere in this
   * package, which is what keeps switching providers a config change.
   */
  provider?: string;
  /** The model id, or the deployment name on a path-addressed provider. */
  model?: string;

  // --- URL shape (presence-driven) ---
  /**
   * ITS PRESENCE IS THE ROUTING SIGNAL. Set → the path-addressed shape (resource
   * and model in the path, no model field in the body). Unset → the unified
   * endpoint. There is no provider-name comparison anywhere in this package.
   */
  resourceName?: string;
  /** Required alongside `resourceName` — the api-version query parameter. */
  apiVersion?: string;

  // --- auth: two independent questions that COMPOSE ---
  /**
   * Authorizes the GATEWAY HOP (Authenticated Gateway) → `cf-aig-authorization`.
   * Answers "may this caller use the gateway at all?".
   */
  gatewayToken?: string;
  /**
   * The provider credential, sent from the caller. Answers "who pays the
   * provider?" — a DIFFERENT question from the one above, hence a separate field.
   *
   * Omit it entirely when the key is stored in the gateway's own provider-key
   * store, which is a fully supported production state, not an error. Both
   * credentials, either one, or NEITHER are all valid; zero credentials sends zero
   * auth headers and does not throw.
   */
  providerKey?: string;
  /** How to send `providerKey`. Defaults to a bearer `authorization` header. */
  providerAuth?: ProviderAuth;

  // --- model-family quirks, as EXPLICIT config ---
  /**
   * Some model families reject the plain output-cap parameter and require the
   * completion-scoped one instead — a 400 that reads like a generic bad request.
   *
   * An explicit boolean, never a pattern match on the model id: a regex over model
   * names is a guess about names that do not exist yet, and it is a list of model
   * literals. Only consulted when `maxOutputTokens` is set.
   */
  usesMaxCompletionTokens?: boolean;
  /**
   * Some model families accept only their default temperature and reject any
   * explicit value. Defaults to TRUE (send it).
   */
  supportsTemperature?: boolean;
  /**
   * Output-token cap. OMITTED from the request when unset — a cap guessed here
   * would truncate a structured response into a parse failure. Set it only to
   * bound spend deliberately.
   */
  maxOutputTokens?: number;

  // --- seams ---
  /** Injected fetch — the test seam. Defaults to the platform fetch, BOUND. */
  fetchImpl?: FetchLike;
  /**
   * The one extension point: override the resolved URL.
   *
   * For a future provider that needs a THIRD path layout — different segment
   * order, a header-carried version, a query parameter this package does not emit
   * — a consumer supplies a function and ships today rather than waiting on a
   * release. Runs AFTER validation, so it receives a fully-resolved config.
   *
   * Be honest about the limit: it overrides the URL ONLY. It cannot express a
   * different request body or a different response parser, so it helps only a
   * provider that already speaks chat-completions.
   */
  resolveEndpoint?: (cfg: ResolvedConfig) => Endpoint;
  /**
   * Error-message labels. Errors name the CONFIG FIELD by default (`model is not
   * set`); supply a map and they name the consumer's own variable instead
   * (`AI_MODEL is not set`), which is the difference between a one-line fix and a
   * day of misdirected debugging. Substitutes the label only — the parenthetical
   * explanation stays this package's. (DESIGN.md §1.5)
   */
  varNames?: Partial<Record<keyof GatewayConfig, string>>;
}
