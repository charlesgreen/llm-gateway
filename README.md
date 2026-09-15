# @charlesgreen/llm-gateway

A small, dependency-free TypeScript client that carries model traffic through
Cloudflare AI Gateway.

It exists to make one guarantee: switching the underlying model provider is a config change in the
consuming app, never a code change. Nothing in this package compares against a provider name, so
when the provider changes there is nothing to edit, here or at the call site.

The rule that shapes the whole design, and the gate that enforces it, are in `AGENTS.md`.

## What it does

- Routes over three URL shapes, selected by config presence, never by comparing a provider name:
  a unified endpoint most providers reach; a path-addressed shape some require (`resourceName`);
  and a project-located rpc shape some require (`projectId` + `location`, with `publisher` and
  `rpc`). The project-located shape also switches the request envelope (contents / systemInstruction
  instead of messages) and the response parser.
- Composes two independent credentials, a gateway-hop token and an optional provider key. Both,
  either, or neither is valid. A deployment whose provider key is stored in the gateway sends no
  provider credential at all.
- Treats an unfilled `<placeholder>` as unset, and names the value to fix when a required one is
  missing.
- Redacts the configured model, provider, and resource strings out of upstream error bodies before
  throwing, because those messages get persisted and logged.
- Resolves config lazily, on the first call, so a bad variable never throws out of a handler ahead
  of its own setup and teardown.
- Ships a supported test kit on a subpath, so consumers do not hand-roll a drifting fake.

Deliberately absent: retries, caching, tiering, pricing, prompt templating, schema parsing,
streaming. Each is somebody else's job. This client stays a thin, provider-agnostic transport, and
adding any of them would bake in an opinion a consumer may not share.

## Install

The package is published to the public npm registry, so a plain install works with no token and no
account setup:

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
  // (and leave projectId unset) and it uses the unified endpoint.
  resourceName: env.AI_PROVIDER_RESOURCE,
  apiVersion: env.AI_PROVIDER_API_VERSION,

  // Set projectId AND location and the client uses the project-located rpc
  // shape instead. publisher and rpc are required alongside the pair.
  // projectId: env.AI_PROVIDER_PROJECT,
  // location: env.AI_PROVIDER_LOCATION,
  // publisher: env.AI_PROVIDER_PUBLISHER,
  // rpc: env.AI_PROVIDER_RPC,

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

`generate` returns raw text. Parsing it, with a schema or otherwise, is the caller's job, and that
boundary is what keeps the client provider-agnostic.

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

`pnpm check` is the gate: lint, typecheck, tests with coverage, build, and the no-provider-literals
scan.

That last step is not a style rule. Consumers bundle this package's compiled output into a build
that is itself scanned for vendor brand tokens in identifiers, string literals, and comments. A
single brand token here turns a consumer's build red and keeps it red, so zero literals is a hard
interface requirement. Never weaken the scanner to make it pass; route the value through config
instead.

Releases publish on a `v*` tag, not on merge. See `.github/workflows/publish.yml` for the flow.
