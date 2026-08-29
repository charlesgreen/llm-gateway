# DESIGN — `@charlesgreen/llm-gateway`

A portable TypeScript client that routes LLM calls through **Cloudflare AI Gateway**, published
privately to GitHub Packages and consumed by every Cloudflare Worker / Pages Functions project in
the portfolio (`vendorwatch` first, then `emailwatch`, `simplycubed/agents`, and whatever follows).

**The one requirement everything else serves:** switching the underlying provider — Azure OpenAI
today, Anthropic / OpenAI / Workers AI later — is a **config change in the consuming app**, never a
code change in this package or in the consumer.

Status: design only. No implementation, no `package.json`, no workflows exist yet — this document is
the contract the follow-up implementation task builds against.

---

## 0. Where this comes from

Three inputs, all read in full before writing this:

| Source | What it contributes |
| --- | --- |
| `charlesgreen/vendorwatch` `packages/agents/src/model.ts` + `model.test.ts` (commit `614b368`, PR #109) | The reference implementation. Config-driven routing, two URL shapes, placeholder detection, error redaction, lazy resolution, `fetch.bind(globalThis)`, the injected-fetch test seam. |
| `charlesgreen/vendorwatch` `apps/jobs/src/index.ts` → `modelClientFor(env)` | How a consumer maps Worker vars onto the client — the shape the package's config object has to accept. |
| `simplycubed/agents` `packages/llm/src/{gateway,models}.ts` | The second, independently-built angle: dual auth modes (BYOK header **and** gateway-stored key), and a tiered `cheap`/`quality` routing layer with a pricing table. |

The two implementations agree on the mechanism and disagree on scope. This design takes
vendorwatch's mechanism wholesale, takes simplycubed's **composable dual-auth** insight, and rejects
simplycubed's pricing table and agent-tier map (§1.7).

### 0.1 The finding that shapes the whole design

vendorwatch runs an opsec **leak-scan** CI gate (`scripts/leak-scan.mjs`) that fails the build if a
provider or model brand token appears in scanned source. On the surface that is a vendorwatch-specific
policy that need not travel with a general-purpose package. It travels anyway, and here is the
verified mechanism:

- The root `leak-scan` script scans `apps/jobs/dist` and `apps/discovery/dist` — the
  `wrangler deploy --dry-run --outdir dist` bundles.
- Those bundles **inline dependency code**, not just workspace code. Verified against the current
  `apps/jobs/dist/index.js` (30,312 lines): 198 hits for drizzle identifiers, 53 for
  dependency string literals, 7 for internal dependency identifiers — all from `node_modules`.
- The bundle also **retains JSDoc comments** (190 hits). So dependency *prose* lands in the scanned
  artifact too.
- `node_modules` is in the scanner's exclude list, so the dependency's own source tree is never
  walked — but the **bundle it was compiled into is not `node_modules`**, and that is what gets
  scanned.

**Therefore:** if `@charlesgreen/llm-gateway` contains the string `anthropic`, `claude`, `openai`,
`gemini`, `mistral`, `llama`, `cohere`, `sonnet`, `haiku`, `opus`, `grok`, `deepseek`, `qwen`, or a
`gpt-3*`/`gpt-4*` prefix anywhere in its shipped source — in an identifier, a string literal, a type
name, or a comment — **vendorwatch's `pnpm check` goes red and stays red.**

This inverts the framing. Zero provider literals is not an opsec rule this package inherits out of
politeness. It is this package's **consumer-compatibility contract**: a hard interface requirement,
enforced by its own CI, without which its primary consumer cannot install it. It also happens to be
the same property that makes provider switching a config change, which is why the good-engineering
argument and the compatibility argument point the same way.

Everything in §1 that looks like restraint — no provider registry, no pricing table, no provider-name
comparisons, no tier enum with model defaults — is this constraint doing its job.

> Shipping `src/` inside the published tarball is **not** a risk here, and it is worth stating so the
> next reader doesn't re-derive it: only the `exports`-resolved compiled JS is ever bundled by
> wrangler, and the scanner excludes `node_modules` outright, so the shipped `.ts` sources are never
> reachable by either path. The invariant is about what ends up in the compiled output.

---

## 1. Package API surface

### 1.1 Scope, stated crisply

**This package carries OpenAI-chat-completions-shaped traffic through Cloudflare AI Gateway, over two
URL shapes.** That is the whole scope.

```
unified          {base}/compat/chat/completions          body carries { model: "{provider}/{model}" }
path-addressed   {base}/{provider}/{resource}/{model}/chat/completions?api-version=…
                                                         body carries NO model field
```

where `{base}` = `https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}`.

**Out of scope, deliberately: provider-native passthrough.** AI Gateway also exposes each provider's
own API shape under a `{base}/{provider}/…` prefix — Anthropic's Messages API, for instance, with its
own request body and its own response envelope. Supporting that would mean a per-provider request
builder and a per-provider response parser, which is precisely the per-provider code the `/compat`
endpoint exists to eliminate. The unified endpoint is *why* provider choice is a config change; a
native shape reintroduces the thing the package is for. If a future provider is only reachable
natively, that is a **v2 concern requiring a request/response seam**, not a URL tweak — and it should
be designed then, against a real requirement, rather than guessed at now.

Note that the path-addressed shape above is *not* "the Azure shape". It is AI Gateway's generic
provider-prefix form; the Azure-flavoured variant simply also needs a resource segment and an
`api-version` query parameter. Nothing in the code knows which provider it is talking to.

### 1.2 The routing decision: config presence, not provider identity — and why not a registry

The task asks whether URL-shape logic should become a pluggable registry of "how to address provider
X", given Anthropic is coming and others may follow. **No — and the reason is that the problem isn't
shaped like a registry.**

Per Cloudflare's provider list, the `/compat` endpoint covers Anthropic, OpenAI, Groq, Mistral,
Cohere, Perplexity, Workers AI, Google AI Studio, Vertex, xAI, DeepSeek, Cerebras and more. Azure
OpenAI is the one that is absent from it and must be path-addressed. So the distribution is not
"N providers, N addressing schemes" — it is "**almost everything is unified; a small set need a path**".
A registry keyed by provider name would be (a) a table of provider-name literals, which §0.1 forbids
outright, and (b) an abstraction whose N is currently 2 and whose growth is not expected.

The design keeps vendorwatch's answer, which is better than a registry on both counts:

> **The presence of `resourceName` in config selects the path-addressed shape.** Absent → unified.
> There is no provider-name comparison anywhere in the package.

This is genuinely provider-count-agnostic in the direction that matters: a *new* provider needing the
path shape is supported on day one with no release, because the consumer just sets the resource var.
And it satisfies §0.1 by construction — a comparison against a provider name would require the name
to be in the source.

**One caveat on that claim, because it is the sentence someone will act on in six months.** The path
shape covers a new provider only when that provider's native API is **itself chat-completions-shaped**,
as the currently path-addressed one happens to be. That coincidence is what lets a single body builder
and a single response parser serve both URLs. Point `resourceName` at a provider with a native request
envelope and you get the right URL with the wrong body. A native envelope is the §1.1 v2 seam, not a
config change.

**The one escape hatch:** an optional `resolveEndpoint?: (cfg: ResolvedConfig) => Endpoint` override.
If some future provider needs a *third path layout* — different segment order, a header-carried
version, a query parameter we don't emit — a consumer supplies a function and ships today rather than
waiting on a package release. It is one optional field, costs nothing when unused, and adds no
registry, no plugin loader, no lifecycle. Be honest about its limit: **it overrides the URL only.** It
cannot express a different body shape or a different response parser — so it, too, only helps a
provider that already speaks chat-completions. That is exactly why §1.1 puts provider-native
passthrough behind a v2 seam rather than pretending this hatch generalizes to it.

### 1.3 The port (unchanged in spirit, generalized in detail)

The minimal, provider-agnostic seam that makes consumers hermetically testable. vendorwatch's
analyzer depends on this and nothing else; that property is the whole reason its golden tests run with
zero network and zero spend, and it is preserved exactly.

```ts
export interface GenerateRequest {
  system: string;
  user: string;
  temperature?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResult {
  text: string;
  usage: Usage;
}

export interface ModelClient {
  generate(req: GenerateRequest): Promise<GenerateResult>;
}
```

Three deliberate changes from vendorwatch's version:

1. **`costCents` is gone.** A chat-completions response reports tokens, not money. vendorwatch's field
   is permanently `0` — a value its cost ledger reads and believes. A shared package must not ship a
   field it can never populate; that is how the original silent-zeros bug happened (usage was mapped
   from Workers-AI-binding field names that a chat-completions body never carries, so the ledger saw
   zeros and the cap never fired). Cost attribution belongs to the consumer (§1.7).
2. **`inputTokens`/`outputTokens`, not `tokensIn`/`tokensOut` and not `prompt_tokens`.** Neutral
   names: neither the Workers-AI binding's vocabulary nor the OpenAI wire vocabulary leaks into the
   port. The wire names are mapped *inside* the client, which is the only place they belong.
3. **`temperature` is optional.** Not every caller has an opinion; the analyzer's near-greedy value is
   a caller concern, not a required parameter of the abstraction.

### 1.4 Configuration

```ts
export interface GatewayConfig {
  // --- gateway address ---
  accountId?: string;              // Cloudflare account id
  gatewayId?: string;              // AI Gateway id
  baseUrl?: string;                // full override; wins over accountId+gatewayId

  // --- model selection ---
  provider?: string;               // gateway provider slug — a runtime value, never compared
  model?: string;                  // model id, or the deployment name on a path-addressed provider

  // --- URL shape (presence-driven) ---
  resourceName?: string;           // SET => path-addressed shape. This is the routing signal.
  apiVersion?: string;             // required alongside resourceName

  // --- auth (both optional, composable, neither required) ---
  gatewayToken?: string;           // => cf-aig-authorization: Bearer <token>
  providerKey?: string;            // BYOK from env; omitted entirely when the key lives in the gateway
  providerAuth?: { header: string; scheme?: string };  // how to send providerKey

  // --- model-family quirks, as explicit config ---
  usesMaxCompletionTokens?: boolean;  // max_completion_tokens instead of max_tokens
  supportsTemperature?: boolean;      // default true
  maxOutputTokens?: number;           // omitted from the request when unset

  // --- seams ---
  fetchImpl?: FetchLike;                                  // the test seam
  resolveEndpoint?: (cfg: ResolvedConfig) => Endpoint;    // the third-shape hatch (§1.2)
  varNames?: Partial<Record<keyof GatewayConfig, string>>; // error-message labels (§1.5)
}

export function createGatewayClient(config: GatewayConfig): ModelClient;
```

`baseUrl` is new, lifted from simplycubed's `resolveGatewayBase`: it accepts a URL pasted from the
Cloudflare dashboard (which points at `/compat/chat/completions`) and strips it back to the root, so a
value copied by hand still works for the path-addressed shape whose path diverges earlier. Cheap,
and it removes a real foot-gun.

**Auth is two independent questions that compose.** simplycubed got this right and it is worth
restating, because treating them as alternatives produces a gateway 401 that looks nothing like a
billing problem:

| Credential | Answers | Sent when |
| --- | --- | --- |
| `cf-aig-authorization: Bearer …` | May this caller use the gateway at all? (Authenticated Gateway) | `gatewayToken` configured |
| the provider key header | Who pays the provider? | `providerKey` configured |

Both, either, or **neither** — and *neither is a fully supported production state*, not an error.
vendorwatch's real configuration stores the provider key inside the gateway's own Provider Keys / BYOK
store, so it sends no provider credential at all. simplycubed's `authHeaders()` throws when neither
credential is present; lifting that check into the shared package would break vendorwatch's live
config on the first call. **Zero credentials → zero auth headers, no error.**

The provider-key **header name and scheme are config**, not inferred. simplycubed hardcodes
`provider === 'azure-openai' ? 'api-key' : 'authorization: Bearer'` — a correct observation (the
path-addressed provider genuinely does not use `Authorization: Bearer`) expressed as the one thing
that must not travel: a provider-name comparison, and a provider-name literal. `providerAuth:
{ header, scheme }` carries the same information as configuration. Default when `providerKey` is set
without `providerAuth`: `{ header: "authorization", scheme: "Bearer" }`.

**Model-family quirks stay explicit booleans**, never regex-matched from the model id. simplycubed
demonstrates the failure mode in its own comments: its `USES_MAX_COMPLETION_TOKENS` pattern had to be
widened once already because a real deployment name carried a minor version the original regex didn't
anticipate. A regex over model names is a guess about names that don't exist yet, it fails as an
upstream 400 that reads like a generic bad request, and — decisively — it is a list of model-name
literals. Config instead.

### 1.5 Errors: name the fix, without borrowing the consumer's vocabulary

vendorwatch's errors are excellent (`AI_MODEL is still the unfilled placeholder "<set-at-provision>"`)
and must not regress — naming the variable to fix is the difference between a one-line change and a
day of misdirected debugging. But `AI_MODEL` and `LLM_PROVIDER` are *vendorwatch's* var names; they
mean nothing in emailwatch or `simplycubed/agents`, where the same value is called `MODEL_QUALITY` or
something else again.

Resolution: **errors name the config field by default, and the consumer may supply a label map.**

```ts
createGatewayClient({
  model: env.AI_MODEL,
  provider: env.LLM_PROVIDER,
  varNames: { model: "AI_MODEL", provider: "LLM_PROVIDER", apiVersion: "AI_PROVIDER_API_VERSION" },
});
```

With the map, vendorwatch's messages stay byte-identical to today's. Without it, a consumer gets
`model is not set` — still actionable, just less specific. One extra line at one call site buys back
the full quality of the original errors for every consumer that wants it.

Two behaviours ported verbatim because both were paid for in real debugging time:

- **Placeholder detection.** A `<…>`-wrapped value is treated as unset, never as a literal. Committed
  scaffold configs carry `<set-at-provision>`; forwarding one to the gateway produces an
  input-rejection that reads like a broken call and is actually an unfilled variable. For a *required*
  field that is a named hard error; for an *optional* field it is indistinguishable from absent, and
  is treated as absent. This matters most for `resourceName`, where a placeholder would otherwise
  select the wrong URL shape.
- **Error-body redaction.** The configured `model`, `provider` and `resourceName` strings are stripped
  out of any upstream 4xx/5xx body before it is thrown. Not cosmetic: a thrown error here is routinely
  caught, stringified onto a record, persisted to a database and logged, and provider error bodies
  habitually echo the deployment name back. Redaction is the only control that covers that path — a
  source-only scan cannot see runtime strings. The HTTP status is left untouched: it is the useful
  diagnostic and it carries nothing.

### 1.6 Two behaviours that look like trivia and are not

- **Lazy config resolution.** Config is resolved on the **first `generate()` call**, not in the
  factory. A consumer that constructs the client eagerly — vendorwatch builds one per queue batch,
  before opening its DB pool — must not have a bad env var throw out of the handler before its own
  setup and teardown run. Resolved lazily, a misconfiguration surfaces as a normal per-message model
  error that the existing retry/DLQ path already knows how to report. This is a real bug that was
  fixed in vendorwatch (#107, the pool closed before its queries ran) and the shape must not regress.
- **`fetch.bind(globalThis)`.** Workers' native `fetch` is a WebIDL brand-checked host function. Store
  it unbound and call it through a reference, and every call throws `Illegal invocation: function
  called with incorrect 'this' reference`. This is not theoretical: it took down DNS resolution across
  vendorwatch's entire discovery pipeline for a full day (#100–#102) and produced a chain of
  plausible-but-wrong diagnoses before anyone tailed the Worker. Bind once, at construction. Test for
  it (§6).

### 1.7 What is deliberately NOT in this package

**Tiered routing (`cheap` / `quality`) — out of scope for v1, and probably permanently.**

simplycubed's tier layer is good code that is not portable. Its two moving parts are:

- `AGENT_TIER` — a map of agent names (`sourcing`, `qualifier`, `outbound-copywriter`, `editor`, …)
  to tiers. That roster is that repo's SOP, not a general concept. vendorwatch's agents are
  `analyzer`, `change-summarizer`, `alert-classifier` — zero overlap.
- `DEFAULT_ROUTING` — default `ModelConfig`s naming actual providers and models. **This alone is
  disqualifying**: it is a block of provider and model literals, which under §0.1 would fail
  vendorwatch's build.

What *is* portable is trivially small: "pick one of several named configs and build a client from it"
is a `Record<string, GatewayConfig>` and a lookup, which a consumer writes in four lines on top of
`createGatewayClient`. Wrapping four lines in a package boundary buys nothing and costs a versioned
API. If two consumers independently write the same tiering and it turns out to be identical, extract
it then, into a `./profiles` subpath, with configs supplied entirely by the consumer and **no default
model table**. Not before.

**Pricing / cost attribution — out of scope, permanently.**

simplycubed ships `PRICING_CENTS_PER_MTOK`, and vendorwatch deliberately declined to port it. Both
were right for their own contexts and the package should carry neither, for three reasons:

1. Prices are per-account and per-contract (sponsorship credits, negotiated rates, regional pricing)
   and change without notice. A table baked into a shared library is wrong for someone the day it
   ships and silently wrong for everyone eventually.
2. A pricing table is a list of model-name keys — provider/model literals, §0.1, fails the consumer's
   build.
3. The failure mode is bad. simplycubed already had to add a guard because an unrecognised model
   priced at 0 would *silently disable* a budget hard-stop — a cost control that is wrong in the
   direction of unlimited spend.

The package reports `inputTokens` / `outputTokens` honestly and stops there. Consumers attribute cost
from those counts against pricing they own. vendorwatch's cost cap consequently remains **token-blind**
until it wires a pricing source; that is vendorwatch's tracked gap (recorded in its `AGENTS.md`), not
this package's, and it must not be papered over here with a guessed price.

**Also out:** retries and backoff (AI Gateway does this, configured in the gateway — a second retry
layer in the client multiplies spend on exactly the failures you least want multiplied); caching
(same, and it is the gateway's headline feature); prompt templating; Zod / structured-output parsing
(the port returns raw text and the consumer owns its schema — that boundary is what makes it
provider-agnostic); streaming (no current consumer needs it; add it against a real requirement, as a
separate `generateStream` method, not by reshaping `generate`).

### 1.8 The assumption this design rests on

**Anthropic is reachable via `/compat` and Azure OpenAI is the sole path-addressed exception.** This
comes from the task brief and from `simplycubed/agents`' `[V] verified against Cloudflare docs
2026-07-26` annotation. It has **not been independently re-verified here** and is recorded as an
assumption rather than a fact.

It is a cheap assumption to hold because the design survives being wrong: routing is presence-driven
config, so if the first Anthropic call to `/compat` returns a 4xx, the fix is to set `resourceName`
and `apiVersion` in the consumer's vars. **No code change, no package release** — which is the
property the whole design exists to provide, tested against the first case where it matters.

Verification step, to run on the first Anthropic call: confirm the request goes to
`{base}/compat/chat/completions` with `{provider}/{model}` in the body, and that it succeeds.

---

## 2. Package structure: one package, subpath exports

**Decision: a single package with subpath exports.** Confirmed, not merely inherited.

The pattern matches `@vw/shared` (12 subpaths) and `@ew/shared` (17), so it is already the house
idiom, but the substantive reasons are:

- This is **one cohesive concern**. There is no version skew to manage between "the client" and "the
  types" — they change together, always. Multiple packages would mean a workspace, a release
  orchestration story, and cross-package version constraints, all in service of a boundary that
  doesn't exist.
- Consumers are Cloudflare Workers, where **bundle size is a real constraint** (1 MB compressed on the
  free tier). Subpath exports keep test helpers out of the production graph: importing
  `@charlesgreen/llm-gateway` must never pull in the cassette/fake-fetch harness.

Entry points:

| Subpath | Contents |
| --- | --- |
| `.` | `createGatewayClient`, `ModelClient`, `GatewayConfig`, `GenerateRequest`, `GenerateResult`, `Usage`, `FetchLike`, error types |
| `./testing` | `fakeFetch()` request-capturing harness, `cassetteClient()` (a `ModelClient` replaying canned responses), assertion helpers |

`./testing` is not padding. Every consumer needs a `ModelClient` test double — vendorwatch's analyzer
golden tests already inject one — and shipping it means each repo doesn't hand-roll a slightly
different fake that drifts from the real client's behaviour. It is the difference between a port and a
port with a supported test kit.

---

## 3. Repo layout, build, and toolchain

```
llm-gateway/
├── DESIGN.md
├── README.md
├── CHANGELOG.md
├── AGENTS.md                  # + CLAUDE.md shim, matching house convention
├── package.json
├── tsconfig.json              # editor / typecheck (noEmit)
├── tsconfig.build.json        # emit config: declaration, sourceMap, removeComments
├── vitest.config.ts
├── eslint.config.js
├── .npmrc                     # publish-side registry mapping
├── .nvmrc                     # Node 24
├── .github/workflows/
│   ├── ci.yml                 # the `check` gate — required branch-protection check
│   └── publish.yml            # tag-triggered publish
├── scripts/
│   └── no-provider-literals.mjs   # the §0.1 consumer-compatibility gate
│                                  # (fragment-assembled token list + self-excluded
│                                  #  path, mirroring vendorwatch's scanner — a
│                                  #  literal list would flag this file itself)
├── src/
│   ├── index.ts               # public surface (barrel)
│   ├── client.ts              # createGatewayClient
│   ├── config.ts              # placeholder detection, required/optional resolution, varNames
│   ├── routing.ts             # endpoint selection (the two shapes + the override hatch)
│   ├── redact.ts
│   ├── types.ts
│   └── testing/
│       └── index.ts
└── test/
    ├── routing.test.ts
    ├── auth.test.ts
    ├── body.test.ts
    ├── response.test.ts
    ├── config-errors.test.ts
    └── no-provider-literals.test.ts
```

### 3.1 Build step: yes — ship compiled JS + `.d.ts`

This deserves a decision rather than a default, because the local packages this is extracted from do
the opposite.

**What the consumers do today.** `@vw/shared`, `@vw/agents`, `@vw/db`, `@ew/shared` all ship **raw
TypeScript**: `"exports": { ".": "./src/index.ts" }`, `"private": true`, no `build` script. That works
because they are `workspace:*` links inside a pnpm workspace, so wrangler's esbuild and vitest's
transform pick up `.ts` as first-class input, and the root `tsconfig.base.json` maps `@vw/*` →
`packages/*/src` via `paths`.

**Why a published package should not copy that.** Three reasons, in order of how likely each is to
bite:

1. **`paths` mapping doesn't exist for a real dependency.** The workspace packages typecheck because
   the root tsconfig points at their source. A `node_modules` dependency resolves through its
   `exports` map — pointing that at `.ts` means every consumer's `tsc` and every consumer's bundler
   must be independently configured to accept TS from `node_modules`.
2. **Tooling outside the wrangler/esbuild path chokes.** Vitest needs `server.deps.inline`; Astro's
   `astro check` (which `@vw/web` and `@vw/admin` run) is stricter; and any plain Node script — the
   smoke scripts in `scripts/*.mjs` are exactly this — cannot import raw TS at all. Every consumer
   would pay this configuration tax separately, and would pay it again on every toolchain upgrade.
3. **Nothing typechecks the package for its consumers.** With `skipLibCheck: true` (set in
   `tsconfig.base.json`), a consumer's `tsc --noEmit` skips `.d.ts` in `node_modules` — which is the
   *desired* behaviour, and only coherent if the package ships `.d.ts` it has already verified itself.
   Shipping source invites every consumer to re-typecheck the dependency, slowly and inconsistently.

Emit configuration:

- ESM only (`"type": "module"`), `target: ES2023`, `module: ESNext`, matching
  `tsconfig.base.json` so nothing is downlevelled for a runtime that doesn't need it.
- `declaration: true`, `declarationMap: true`, `sourceMap: true`, and **`src/` included in the
  tarball** so a consumer stepping through a bug lands on readable TypeScript. (Per §0.1 this is safe:
  only the `exports`-resolved JS is ever bundled.)
- **`removeComments: true`** in `tsconfig.build.json`. `tsc` defaults this to `false`, so JSDoc would
  otherwise flow source → published `.js` → consumer bundle → leak-scan. This is belt-and-braces
  only — **the design invariant is that no provider/model brand token appears in identifiers, string
  literals, or types in the first place**, enforced by `scripts/no-provider-literals.mjs`. Do not let
  a future maintainer read `removeComments` as the protection and relax the invariant.
- `exports` map with `types` **first** in each condition (order is significant to TypeScript's
  resolver), and `"files": ["dist", "src"]`.

```jsonc
{
  "name": "@charlesgreen/llm-gateway",
  "version": "0.1.0",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".":         { "types": "./dist/index.d.ts",         "default": "./dist/index.js" },
    "./testing": { "types": "./dist/testing/index.d.ts", "default": "./dist/testing/index.js" }
  },
  "files": ["dist", "src"],
  "engines": { "node": ">=24" },
  "packageManager": "pnpm@11.5.2",
  "publishConfig": { "registry": "https://npm.pkg.github.com", "access": "restricted" },
  "repository": { "type": "git", "url": "git+https://github.com/charlesgreen/llm-gateway.git" }
}
```

### 3.2 Zero runtime dependencies — a hard rule

`"dependencies": {}`. The client needs `fetch` and nothing else. No zod (the port returns raw text by
design), no SDK, no polyfill.

This is worth stating as a rule rather than an accident. A dependency in this package is inherited by
every Worker in the portfolio, counts against every bundle budget, and — per §0.1 — lands inside every
consumer's leak-scanned build output, where a transitive package that happens to mention a provider
name in a comment would break a consumer's build for reasons no one would find quickly.

`@cloudflare/workers-types` is a **devDependency only**. The public surface uses structural types
(`FetchLike`, `FetchResponseLike` — vendorwatch already does this) so nothing forces a consumer into
Workers types, and the package typechecks and tests in a plain Node context.

---

## 4. Publishing

### 4.1 Publish-side wiring

Committed `.npmrc`:

```
@charlesgreen:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

plus `publishConfig` in `package.json` (§3.1) so a stray `pnpm publish` cannot reach public npm.

### 4.2 Trigger: on a `v*` tag, not on merge to main

**Recommendation: tag-triggered.** Justification, in the house's own terms:

- **A publish is irreversible.** A published version is immutable; unpublishing is disruptive at best
  and blocked at worst. That puts it in the same class as a prod deploy, and the standing rule for
  that class is a deliberate, human-gated trigger — `main` is dev, a `v*` tag is a release. Publishing
  on merge would make every merged PR an irreversible external side effect.
- **Merge-triggered publishing forces a version decision into every PR.** Either every PR bumps the
  version (churn, conflicts) or a tool auto-versions from commit messages (a whole apparatus for one
  package with three consumers).
- **Each release has a downstream cost.** vendorwatch runs a package cool-down policy (§5.3) whose
  exclude list must be edited per release, in *each* consumer. Releases should be few and deliberate;
  the trigger should make that the path of least resistance.

`publish.yml`, on `push: tags: ['v*']`:

1. Checkout, pnpm, Node 24.
2. `pnpm install --frozen-lockfile`.
3. **Run the full `check` gate** — never publish an artifact CI hasn't verified.
4. **Assert `package.json` version === the tag** (strip the leading `v`); fail loudly on mismatch.
   Guards against the tag that lies, which is otherwise discovered by a consumer.
5. `pnpm publish --no-git-checks`.

`permissions: { contents: read, packages: write }`, `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`
(same-repo write is what `GITHUB_TOKEN` is unambiguously good for), and the job bound to a
**`publish` GitHub Environment with a required reviewer** — mirroring the `prod` Environment control,
for the same reason: the irreversible step gets a human.

### 4.3 Consumer-side install auth

**Sequencing constraint, stated up front:** consumer install auth cannot be wired until **after the
first publish** — per-package Actions access cannot be granted for a package that does not exist yet.
This is the same ordering caveat as `wrangler secret put` needing the Worker deployed first, already
documented in `scripts/setup-cloudflare.sh`. Plan for two passes: publish `0.1.0`, then wire
vendorwatch.

vendorwatch's `.npmrc` is **already half-wired** and its committed comment documents the intended
shape precisely:

```
@charlesgreen:registry=https://npm.pkg.github.com
```

with a note that no auth line is present *yet*, deliberately, because pnpm warns on every command when
`NODE_AUTH_TOKEN` is unset and nothing currently resolves to GitHub Packages. That comment is correct
and its stated trigger — "when the first `@charlesgreen/*` dep IS added" — is exactly this work.

Two paths for CI auth. **Verify the first; default to the second.**

| | Path | Notes |
| --- | --- | --- |
| Verify first | Grant each consumer repo read access on the package ("Manage Actions access"), then `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` + `permissions: packages: read` | No stored secret, no rotation. Cleanest if it works. |
| Default | A `PACKAGES_READ_TOKEN` repo secret (classic PAT, `read:packages`) exported as `NODE_AUTH_TOKEN` | Always works. Needs rotation; owner-issued credential material, so it is a manual follow-up by definition. |

The discriminating question is **whether a user-owned (not org-owned) npm package on GitHub Packages
reliably supports cross-repo Actions access** — that is settled in the package settings UI after the
first publish, not from here. It is an open question (§8), not a blocker: the PAT path always works, so
the repoint can proceed either way.

For **local** installs, auth goes in user-level npm config (`~/.npmrc`), never in the repo:
`//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` with the token exported from the shell. A
**classic** PAT with `read:packages` is the reliable local credential; fine-grained PAT coverage for
Packages read is narrower and should be confirmed before being depended on.

### 4.4 The `check` gate, and building it first

House rule, from `AGENTS.md`: *no feature work begins until its gate exists; extend the gate first,
then build the feature against it.* So for the follow-up implementation task:

**Artifact #1 is `.github/workflows/ci.yml` and the `check` script — created before any client code.**

```
pnpm check = lint (eslint + prettier --check)
           → typecheck (tsc --noEmit)
           → test (vitest, coverage thresholds)
           → build (tsc -p tsconfig.build.json)
           → no-provider-literals (scripts/no-provider-literals.mjs over src/ AND dist/)
```

The `check` job is the **required branch-protection check** on `main`, matching vendorwatch's shape.
Note the scan runs over `dist/` as well as `src/` — that is the artifact consumers actually bundle, and
running it there is what makes §0.1 an enforced contract rather than an intention.

---

## 5. Versioning

### 5.1 Semver, with an honest 0.x

- **`0.x` while vendorwatch is the only consumer.** Breaking changes are cheap when there is one
  caller and it is in the same hands; pretending otherwise produces version inflation that
  communicates nothing.
- **`1.0.0` when the second consumer lands** (emailwatch or `simplycubed/agents`). At that point the
  API is genuinely load-bearing across repos and the major-version contract starts meaning something.
- After 1.0: MAJOR for a config field removed/renamed or a routing behaviour change; MINOR for new
  optional config or a new export; PATCH for fixes that preserve request and response shape.

### 5.2 Changelog and breaking-change communication

`CHANGELOG.md`, Keep-a-Changelog format, hand-written. **No changesets** — that tooling exists to
coordinate many packages in one repo; here it is a dependency and a workflow to maintain for a single
package.

A breaking change ships with a `### Migration` block in its entry: the old call, the new call, and the
config-var change if any. Consumers link that block from their bump PR.

**What actually stops a silent break is not the changelog — it is the consumer's own gate.** Bumping
`@charlesgreen/llm-gateway` in vendorwatch is a PR against `pnpm check`, which typechecks the call
site, runs the hermetic tests, builds every Worker, and runs the leak-scan. A signature change fails at
typecheck; a routing change fails the tests that assert the built URL; a provider literal fails the
scan. So:

- Consumers depend on `^` within 1.x, and on an **exact version** during 0.x.
- **Never Dependabot-auto-merge this package.** The bump must run the consumer's full gate and be
  looked at. This is worth an explicit ignore/no-auto-merge rule in each consumer.

### 5.3 The cool-down interaction (a real, non-obvious operational cost)

vendorwatch has a **package cool-down policy in force**. There is no explicit `minimumReleaseAge` line
in `.npmrc` or `pnpm-workspace.yaml`, but a `minimumReleaseAgeExclude` list is actively maintained
there with a hard-fail rationale in its comments — a fresh-cut version is blocked by the cool-down
window until it is excluded.

**Consequence:** a newly published `@charlesgreen/llm-gateway@x.y.z` will not install in vendorwatch
until either the window elapses or the exact version is added to `minimumReleaseAgeExclude`. Each
release therefore costs one exclude-list edit in **each** consumer — which is annoying, and is also a
second, independent argument for tag-triggered publishing (§4.2): few deliberate releases, not one per
merge.

Confirm the actual window before the repoint PR so the vendorwatch change lands with the right
exclude entry rather than discovering it as a red CI run.

---

## 6. Test strategy

**Primary gate: hermetic, fetch-injected unit tests. No network call, no provider key, no spend —
ever, in this repo's CI.** vendorwatch's `model.test.ts` (17 cases over an injected fake fetch) is the
model; port its structure wholesale.

The core technique, worth naming because it carries the design: **every provider and model string in
the tests is deliberately fake** (`prov-x`, `res-y`, `deployment-z`). If the suite passes with nonsense
slugs, the client provably carries no hardcoded provider knowledge — which is the actual requirement,
not a stylistic one. It also keeps the test suite compatible with §0.1 by construction.

Coverage, by area:

| Area | Cases |
| --- | --- |
| Routing | path-addressed URL exactly right (segments, encoding, `api-version`) and **no `model` in the body**; unified URL with `{provider}/{model}` in the body; `<placeholder>` resource → unified, not a bogus path; `baseUrl` override, including a dashboard-style URL stripped back to root; `resolveEndpoint` override wins |
| Auth | no credentials → **only `content-type`** (assert the exact header key set, not just absence); `gatewayToken` → `cf-aig-authorization`; `providerKey` with a custom `providerAuth.header`/`scheme`; **both together compose** (the simplycubed either/or bug); placeholder token → header omitted |
| Body | `max_tokens` vs `max_completion_tokens` per config; **neither present when `maxOutputTokens` is unset**; temperature sent by default, omitted when `supportsTemperature: false` |
| Response | `prompt_tokens`/`completion_tokens` → `inputTokens`/`outputTokens` (the silent-zeros regression); usage absent → zeros, never `NaN`; missing `choices` → empty string, not a throw |
| Errors | table-driven over every required field: throws naming the field, **and zero requests were made** (no spend on a bad config); `varNames` map produces the consumer's label; redaction removes model/provider/resource from an upstream body while preserving the status |
| Binding | `fetch` is bound: construct with no `fetchImpl` in a context where a bare `fetch` reference would throw `Illegal invocation`, and assert it does not |
| Compat | `no-provider-literals` run as a **vitest case with a negative control** — a fixture containing a known token must make the scanner go red. vendorwatch does exactly this for its leak-scan, and it is the difference between a gate and a gate nobody has seen fire. |

Table-driven throughout (house convention). Coverage thresholds enforced in `vitest.config.ts` — this
package is small enough that a high floor is achievable and meaningful.

**Explicitly not in CI:** any test that reaches `gateway.ai.cloudflare.com`. A live check against a
real gateway is a consumer's post-deploy synthetic (vendorwatch's `smoke-*`), where real credentials
and a real environment already exist. This package's CI holds no credentials, so there is nothing to
leak and no spend to run up.

---

## 7. Repoint plan — `charlesgreen/vendorwatch`

Ordered, one PR unless noted. (emailwatch and `simplycubed/agents` follow later and are out of scope
here. One finding worth recording for whoever picks up emailwatch, since it was checked in passing:
**emailwatch has no `.npmrc` at all** — vendorwatch's is half-wired and needs amending, emailwatch's
needs creating from scratch.)

**Step 0 — publish `0.1.0` first.** Per §4.3, consumer auth cannot be granted before the package
exists.

**Step 1 — dependency placement.** Add to **`packages/agents/package.json`**, not `apps/jobs`:

```jsonc
"dependencies": {
  "@charlesgreen/llm-gateway": "0.1.0",   // exact during 0.x
  "@vw/shared": "workspace:*",
  ...
}
```

`@vw/agents` stays the seam. `apps/jobs` continues to import from `@vw/agents`, so the analyzer, the
change-summarizer and `apps/jobs/src/index.ts` see no import churn in this PR.

**Step 2 — `packages/agents/src/model.ts` becomes a thin adapter, not a bare re-export.**

Delete the implementation. Keep the file, ~20 lines, doing exactly two things:

1. Re-export the port types so existing imports resolve unchanged.
2. **Adapt the usage shape.** The package returns `{ inputTokens, outputTokens }` (§1.3); vendorwatch's
   analyzer and cost ledger consume `{ tokensIn, tokensOut, costCents }`. The adapter maps the two
   token fields and supplies `costCents: 0`.

That `costCents: 0` is a vendorwatch fact — its cap is token-blind, tracked in its `AGENTS.md` — and
this is the right place for it: an anti-corruption layer that keeps a lie the package shouldn't tell
inside the repo whose ledger tells it. `resolveModelId` either moves into the package's config layer
or is dropped; either way `createGatewayModelClient` keeps its exported name here so
`packages/agents/src/index.ts` and `modelClientFor()` are untouched.

**Why an adapter rather than deleting the file and importing directly in `modelClientFor()`:** the
repoint PR then changes one file's contents and zero call sites. It is reviewable, and revertable by
reverting one file. Collapsing the shim later, if it earns it, is a separate and trivial change; doing
both at once conflates a dependency swap with a call-site refactor and makes a bisect harder.

**Step 3 — `modelClientFor()` gains the `varNames` map.** Add the §1.5 label map so error messages stay
byte-identical to today's (`AI_MODEL is still the unfilled placeholder …`). Everything else about that
function — reading `env.AI_GATEWAY_ACCOUNT_ID`, `env.LLM_PROVIDER`, `env.AI_PROVIDER_RESOURCE`, the
`=== "true"` / `!== "false"` coercions — is unchanged. **No Worker var is renamed, no
`wrangler.jsonc` var block changes, no provisioning change.** The repoint is invisible to the deployed
configuration, which is the point.

**Step 4 — tests.** `packages/agents/src/model.test.ts` moves to the package (it *is* the package's
test suite). What stays in vendorwatch is a small test over the adapter's usage mapping. Watch the
coverage thresholds in `packages/agents/vitest.config.ts` — removing a well-covered file changes the
denominator and can trip a floor that was fine a moment earlier.

**Step 5 — workspace and registry plumbing.**

- `.npmrc`: add `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}`. Its existing comment explicitly
  defers this until the first `@charlesgreen/*` dep is added — that is now, and it should land in the
  same PR so the deferral and its resolution are never out of sync. **Also correct the stale line
  naming `charlesgreen/shared` as the publishing repo:** `gh repo view charlesgreen/shared` currently
  resolves to `charlesgreen/llm-gateway`, i.e. that repo was renamed and GitHub is redirecting. The
  comment should name `charlesgreen/llm-gateway`.
- `pnpm-workspace.yaml`: add `"@charlesgreen/llm-gateway@0.1.0"` to `minimumReleaseAgeExclude` (§5.3).
- **All nine workflows run `pnpm install`** — `ci.yml`, `deploy.yml`, `schema-drift.yml`,
  `smoke-dev.yml`, `smoke-prod.yml`, `maintenance.yml`, `provision-dev.yml`,
  `routine-growth-operator.yml`, `routine-product-improvement.yml`. **Every one** needs
  `permissions: packages: read` and `NODE_AUTH_TOKEN` on its install step. Missing one produces a
  failure in a workflow nobody was thinking about — a scheduled routine that only breaks at 02:00, not
  the PR that made the change.

**Step 6 — the leak-scan. Verified: no change needed, and no loosening is permitted.**

The question was whether vendorwatch's `scripts/leak-scan.mjs` would ever scan a dependency's source
that legitimately contains provider names. Answer, checked directly against the script and the built
artifacts:

- The scanner's `EXCLUDE_PATH_FRAGMENTS` includes `node_modules`, and its scan roots are explicit
  source directories. **It never walks the dependency's own tree.** Correct as-is.
- **But `dist` is scanned, and dependency code is inlined into it.** The `pnpm leak-scan` script passes
  `apps/jobs/dist apps/discovery/dist`, and those bundles contain dependency identifiers, dependency
  string literals, **and dependency JSDoc comments** (§0.1, with counts).

So the leak-scan needs **no modification** — and must not be given a `dist` exemption or an
`@charlesgreen` allowance, which would blind the gate to real leaks from vendorwatch's own bundled
code. The obligation sits entirely on the package: §0.1's zero-literal invariant, enforced by
`scripts/no-provider-literals.mjs` in llm-gateway's own `check`, running over `src/` **and** `dist/`.

Concretely, the package's source may not contain, in any identifier, string literal, type name, or
comment: `anthropic`, `claude`, `openai`, `gemini`, `mistral`, `llama`, `cohere`, `sonnet`, `haiku`,
`opus`, `grok`, `deepseek`, `qwen`, or a `gpt-3*` / `gpt-4*` prefix. Mirror vendorwatch's exact token
list in the package's scanner so the two gates cannot drift — llm-gateway's CI going green must be a
reliable predictor of vendorwatch's CI going green. When vendorwatch adds a token, llm-gateway adds it
too.

Copy vendorwatch's two self-reference defences along with the list: the tokens are **assembled at
runtime from fragments** so the scanner file holds no clean literal, and the scanner's own path is
**self-excluded**. Without both, the gate flags itself the moment its scan roots widen.

(This DESIGN.md is safe on all three counts and needs no exemption: it is excluded from the published
tarball by `files`, it is not under the scan roots, and `.md` is not a scanned extension in either
scanner.)

Note the everyday trap: `opus` and `haiku` are ordinary English words. Prose in this package must
avoid them.

**Step 7 — verify.** `pnpm check` green in vendorwatch, then merge to `main` (auto-deploys dev), then
the dev post-deploy synthetic. A live analysis run through the real gateway is the actual proof the
repoint preserved behaviour; the hermetic suite proves the request shape, not the round trip.

---

## 8. Open questions for the owner

1. **Cross-repo GitHub Packages read auth (§4.3).** Does a **user-owned** (not org-owned) npm package
   on GitHub Packages reliably support granting another repo's `GITHUB_TOKEN` read access via "Manage
   Actions access"? Settled in the package settings UI after the first publish. *Not a blocker* — the
   `PACKAGES_READ_TOKEN` classic-PAT fallback always works; this only decides whether a stored secret
   is needed in each consumer.
2. **The cool-down window (§5.3).** vendorwatch has a package cool-down policy in force (evidenced by
   its maintained `minimumReleaseAgeExclude`) but no explicit `minimumReleaseAge` setting was found.
   Confirm the actual window so the repoint PR carries the right exclude entry instead of discovering
   it as a red CI run.
3. **A `publish` GitHub Environment with a required reviewer (§4.2)?** Recommended, on the grounds that
   an immutable published version is irreversible and the house rule gates irreversible things with a
   human. Confirm — it is the difference between tagging and shipping in one motion versus two.
4. **The `/compat` assumption (§1.8).** Recorded as an assumption, not verified here: Anthropic reaches
   the unified endpoint and Azure OpenAI is the sole path-addressed exception. The design survives it
   being wrong (config change, no release), but confirm on the first Anthropic call.
5. **`0.x` or straight to `1.0.0` (§5.1)?** Recommending `0.x` until a second consumer lands, so the
   inevitable early API adjustments don't burn major versions.
6. **Where do the *other* shared-library extractions go now?** Doc drift, found while checking the
   registry wiring. `gh repo view charlesgreen/shared` resolves to `charlesgreen/llm-gateway` — the
   repo was renamed. But the global engineering standard still reads *"Stable libs extract to
   `@charlesgreen/*` on GitHub Packages (`charlesgreen/shared`)"*, and vendorwatch's `AGENTS.md`
   repeats it. That named home is now this single-purpose package, so the remaining planned
   extractions — the genuine `@vw/shared` / `@ew/shared` overlap: icons, i18n, auth, csrf, doh, email,
   errors, analytics — have no repo named for them. Not a question about *this* package's naming
   (settled), but the standard and vendorwatch's `AGENTS.md` should be corrected before another agent
   acts on the stale pointer.

---

## 9. Summary of decisions

| # | Decision | Core reason |
| --- | --- | --- |
| 1 | Zero provider/model literals — an enforced **consumer-compatibility contract**, not just opsec | Dependency identifiers, literals *and* comments are inlined into vendorwatch's leak-scanned `dist` bundle (verified). A literal here breaks the consumer's build. |
| 2 | Two URL shapes, selected by `resourceName` **presence**; no provider registry | Most providers are unified; path-addressed is the exception. A registry would be a table of provider-name literals — forbidden by #1 — and presence-driven config supports a *new* path-addressed provider with no release. |
| 3 | Provider-native passthrough is **out of scope**, named | It needs per-provider bodies and parsers, i.e. exactly the per-provider code `/compat` exists to remove. v2 concern, with a real seam. |
| 4 | `resolveEndpoint?` as the only extension point | Covers a third *path* layout at zero cost; honestly cannot cover a different body shape (hence #3). |
| 5 | Auth: gateway token and provider key are **independent and composable**; **zero credentials is valid** | They answer different questions. vendorwatch's live config sends neither, so simplycubed's throw-when-empty would break production. |
| 6 | Provider-key header **name and scheme are config** | Replaces the one provider-name comparison in simplycubed's code with configuration. |
| 7 | Family quirks (`max_tokens` vs `max_completion_tokens`, temperature) stay explicit booleans | A model-name regex is a guess about names that don't exist yet — simplycubed already had to widen its once — and is a list of model literals. |
| 8 | Port drops `costCents`, renames to `inputTokens`/`outputTokens` | The response reports tokens, not money. A permanently-zero field is how the original silent-zeros ledger bug happened. |
| 9 | No tiering, no pricing table, no retries/caching/streaming | Tier maps and price tables are consumer-specific, go stale, and are piles of provider/model literals (#1). Retries and caching are the gateway's job; doubling them multiplies spend. |
| 10 | Errors name the **config field**, with an optional `varNames` label map | Preserves vendorwatch's excellent "name the var to fix" errors without hardcoding `AI_MODEL` into a package emailwatch also uses. |
| 11 | Single package, subpath exports `.` and `./testing` | One cohesive concern, no version skew; subpaths keep the test kit out of the Worker bundle. |
| 12 | **Build step: ship compiled JS + `.d.ts`** (unlike the raw-TS local `@vw/*` packages) | Those work only via workspace `paths` mapping. A real dependency resolves through `exports`; raw TS taxes every consumer's tsc, vitest, `astro check`, and plain-Node scripts. |
| 13 | Zero runtime dependencies | Inherited by every Worker in the portfolio; also, a transitive package mentioning a provider name would break a consumer's build (#1). |
| 14 | **Publish on a `v*` tag**, gated by a `publish` Environment, version asserted against the tag | A published version is immutable, so it belongs in the same irreversible class as a prod deploy. Also, each release costs a cool-down exclude edit in every consumer. |
| 15 | `0.x` now, `1.0.0` at the second consumer; hand-written changelog, no changesets | Version numbers should mean something; changesets solve a multi-package problem that doesn't exist here. |
| 16 | Hermetic fetch-injected tests with **deliberately fake provider slugs**; a negative control on the literal scan | Passing with nonsense slugs *proves* no hardcoded provider knowledge. A gate never seen fire is a false clear. |
| 17 | vendorwatch's `model.ts` becomes a **thin adapter**, not a deletion | One-file, revertable PR; and the adapter is the right home for the `costCents: 0` fiction the package must not ship. |
| 18 | The leak-scan is **unchanged** — no `dist` exemption, no `@charlesgreen` allowance | Loosening it would blind the gate to real leaks from vendorwatch's own code. The obligation belongs on the package. |
| 19 | The CI `check` gate is **artifact #1** of the implementation task, before any client code | House rule: extend the gate first, then build the feature against it. |
