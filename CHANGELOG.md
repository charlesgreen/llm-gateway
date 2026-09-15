# Changelog

All notable changes to this package are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Versions follow semver, with an
honest `0.x` while there is only one consumer.

A breaking change ships with a `### Migration` block giving the old call, the new call, and any
config change. Consumers link that block from their bump PR.

## [Unreleased]

## [0.1.3] - 2026-09-15

### Added

- A third, presence-driven URL shape: when `projectId` and `location` are both set, the client
  addresses `{provider}/v1/projects/{projectId}/locations/{location}/publishers/{publisher}/models/{model}:{rpc}`,
  sends a contents / systemInstruction envelope, and reads candidate text parts plus
  `usageMetadata` token counts. `publisher` and `rpc` are required alongside the pair.
  Setting `projectId` together with `resourceName` is a named config error (two shapes at once).
  The unified and path-addressed chat-completions shapes are unchanged.

## [0.1.2] - 2026-09-13

### Changed

- README, `AGENTS.md`, and this changelog rewritten in plainer prose. No code or public API
  change.
- Dev-only: vitest 4.1.8 → 4.1.11.

## [0.1.1] - 2026-09-02

### Changed

- Publishing now uses npm's OIDC trusted publishing instead of a stored account token. No
  functional change for consumers, no public API change.

## [0.1.0] - 2026-09-02

### Added

- Initial implementation.
  - `createGatewayClient(config)`: chat-completions traffic over Cloudflare AI Gateway, with the
    URL shape selected by the presence of `resourceName` and no provider-name comparison
    anywhere.
  - Composable dual credentials: a gateway-hop token and an optional provider key whose header name
    and scheme are configuration. Zero credentials is a valid, supported state.
  - `<placeholder>` detection, errors that name the value to fix, an optional `varNames` label map,
    and redaction of the configured model / provider / resource out of upstream error bodies.
  - Lazy config resolution, and the platform `fetch` bound once at construction.
  - `resolveEndpoint`: the single extension point; it overrides the URL only.
  - `./testing` subpath: `fakeFetch()` and `cassetteClient()`.
- `scripts/no-provider-literals.mjs`: the consumer-compatibility gate, run over `src/`, `dist/`,
  `README.md` and `package.json`, with a negative control proving it goes red on a planted token.

### Fixed

- `main`/`types`/`typesVersions` added for legacy `"moduleResolution": "node"` consumers, which the
  `exports` map alone does not satisfy.
