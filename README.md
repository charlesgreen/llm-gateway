# @charlesgreen/llm-gateway

A small, dependency-free TypeScript client that carries chat-completions traffic through
**Cloudflare AI Gateway**.

The one thing it is for: **switching the underlying model provider is a config change in the
consuming app, never a code change** — not here, and not at the call site. Nothing in this package
compares against a provider name, so there is nothing to edit when the provider changes.

The one rule that shapes the whole design, and the gate that enforces it, are in `AGENTS.md`.

## What it does

- Routes over **two URL shapes** — a unified endpoint most providers reach, and a path-addressed
  shape some require. Which one is used is decided by the **presence of `resourceName` in config**,
  not by any provider comparison.
- Composes **two independent credentials**: a gateway-hop token and an optional provider key. Both,
  either, or **neither** is valid — a deployment whose provider key is stored in the gateway sends
  no provider credential at all.
- Treats an unfilled `<placeholder>` as unset, and **names the value to fix** when a required one is
  missing.
- **Redacts** the configured model / provider / resource strings out of upstream error bodies before
  throwing, because those messages get persisted and logged.
- Resolves config **lazily**, on the first call, so a bad variable never throws out of a handler
  ahead of its own setup and teardown.
- Ships a supported **test kit** on a subpath, so consumers do not hand-roll a drifting fake.

Deliberately absent: retries, caching, tiering, pricing, prompt templating, schema parsing,
streaming. Each is somebody else's job: this client stays a thin, provider-agnostic transport, and
adding any of them would mean baking in an opinion a consumer may not share.

## Install

This package is published to **GitHub Packages**. The package itself is public — no collaborator
grant or invite is needed to install it — but GitHub's npm registry requires a token on every
install regardless of package visibility (there is no anonymous-pull path for npm packages there,
unlike GitHub's container registry). Any GitHub account can self-serve one; it does not need to be
the repo owner's.

Add to the consuming repo's `.npmrc`:

```
@charlesgreen:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Then supply `NODE_AUTH_TOKEN`:

- **Locally** — export a classic PAT with `read:packages` in your shell. Any GitHub account can
  generate one; keep the auth line in user-level npm config (`~/.npmrc`), never commit a token.
- **In CI** — every workflow that runs `pnpm install` needs `permissions: packages: read` and
  `NODE_AUTH_TOKEN` on its install step. `GITHUB_TOKEN` is not wired to `NODE_AUTH_TOKEN`
  automatically. Miss one workflow and it fails at 02:00 in a scheduled job, not in the PR.

```sh
pnpm add @charlesgreen/llm-gateway
```

## Usage

```ts
import { createGatewayClient } from "@charlesgreen/llm-gateway";

const client = createGatewayClient({
  accountId: env.AI_GATEWAY_ACCOUNT_ID,
  gatewayId: env.AI_GATEWAY_NAME,
  model: env.AI_MODEL,
  provider: env.LLM_PROVIDER,

  // Set this and the client uses the path-addressed URL shape. Leave it unset
  // and it uses the unified endpoint. That is the whole routing decision.
  resourceName: env.AI_PROVIDER_RESOURCE,
  apiVersion: env.AI_PROVIDER_API_VERSION,

  gatewayToken: env.AI_GATEWAY_TOKEN,

  // Model-family quirks are explicit config, never guessed from the model id.
  usesMaxCompletionTokens: env.AI_MODEL_USES_MAX_COMPLETION_TOKENS === "true",
  supportsTemperature: env.AI_MODEL_SUPPORTS_TEMPERATURE !== "false",
  maxOutputTokens: Number(env.AI_MAX_OUTPUT_TOKENS) || undefined,

  // Optional: make errors name YOUR variables instead of the config fields.
  varNames: { model: "AI_MODEL", provider: "LLM_PROVIDER" },
});

const { text, usage } = await client.generate({
  system: "You are a careful analyst.",
  user: documentText,
  temperature: 0.1,
});
// usage → { inputTokens, outputTokens }
```

`generate` returns **raw text**. Parsing it — with a schema or otherwise — is the caller's job, and
that boundary is what keeps the client provider-agnostic.

### Bring your own provider key

When the key is not stored in the gateway, send it yourself. The header name and scheme are config,
so no provider name is needed to decide them:

```ts
createGatewayClient({
  ...base,
  providerKey: env.PROVIDER_KEY,
  providerAuth: { header: "api-key" }, // no scheme → the key is sent bare
});
```

### Testing

```ts
import { fakeFetch, cassetteClient } from "@charlesgreen/llm-gateway/testing";

// Assert what the client would send, without a network call.
const fake = fakeFetch();
await createGatewayClient({ ...cfg, fetchImpl: fake.fetchImpl }).generate(req);
expect(fake.only().url).toBe(expectedUrl);

// Or replace the client entirely in your own golden tests.
const model = cassetteClient(recordedResponseText);
```

## Contributing

`pnpm check` is the gate: lint → typecheck → tests with coverage → build → **no-provider-literals**.

That last step is not a style rule. Consumers bundle this package's compiled output into a build
that is itself scanned for vendor brand tokens — identifiers, string literals **and comments** — so
a single brand token here turns a consumer's build red and keeps it red. Zero literals is a hard
interface requirement. Never weaken the scanner to make it pass; route the value through config
instead.

Releases publish on a `v*` tag, not on merge — see `.github/workflows/publish.yml` for the flow.
