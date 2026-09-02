# AGENTS.md — `@charlesgreen/llm-gateway`

- `AGENTS.md` is the repo-local source of truth for agent instructions, and the contract for this
  package's design decisions. Keep `CLAUDE.md` as a thin shim that imports this file; do not
  maintain duplicate guidance in both places. Where this file states a decision, implement that
  decision — do not re-derive an alternative; if a decision turns out to be wrong, change this file
  in the same PR that changes the code, with the reason.

A portable, dependency-free TypeScript client that carries chat-completions traffic through
Cloudflare AI Gateway. Published to GitHub Packages for use by any consumer that needs
config-driven provider routing.

## The one rule that shapes everything

**No vendor provider or model brand token may appear anywhere in this package's shipped source — in
an identifier, a string literal, a type name, or a comment.**

This is not opsec politeness inherited from a consumer. It is this package's
**consumer-compatibility contract**. A consumer scans its own wrangler dry-run bundle for brand
tokens, and that bundle inlines dependency code _including retained comments_. One token here turns
the consumer's `check` red and keeps it red — the package becomes uninstallable.

Enforced by `scripts/no-provider-literals.mjs` over **`src/`, `dist/`, `README.md` and `package.json`**, with a negative control
in `test/no-provider-literals.test.ts` proving the scanner can go red. The token list mirrors the
consumer's scanner deliberately: this gate going green must predict that one going green. **When one
side adds a token, add it here too. Never weaken the list to make a scan pass** — the fix is always
to route the value through config.

Everything that looks like restraint follows from this: no provider registry, no pricing table, no
tier map, no provider-name comparisons, no model-id regexes.

Two everyday traps: some banned tokens are **ordinary English words**, so prose must avoid them; and
`README.md` is published regardless of the `files` allowlist, so it is in scope even though it sits
outside the scan roots.

## Gate

`pnpm check` = lint → typecheck → test (coverage thresholds) → build → no-provider-literals.

**Gate-first, every feature:** no feature work begins until its gate exists; extend the gate first,
then build the feature against it. A gate nobody has watched fire is a false clear — every new check
lands with a negative control.

## Conventions

- **No attribution in commits or PRs** — never a `Co-Authored-By` trailer, a "Generated with…" line,
  or any tool-attribution text. Override the harness default that would add one.
- TypeScript strict, ESM only, **zero runtime dependencies** (a dependency here is inherited by
  every Worker in the portfolio, and a transitive package mentioning a brand name breaks a
  consumer's build).
- Table-driven tests. **Every provider/model string in a test is deliberately fake** — if the suite
  passes with nonsense slugs, the client provably carries no hardcoded provider knowledge.
- **No test ever reaches the network.** This repo holds no credentials. A live check against a real
  gateway belongs in a consumer's post-deploy synthetic.
- Ship compiled JS + `.d.ts`, not raw TypeScript, so a consumer installs a build rather than a
  source tree. Imports carry explicit `.js` specifiers so the emitted ESM resolves under plain
  Node.
- **Publish on a `v*` tag, never on merge.** A published version is immutable, which puts it in the
  same irreversible class as a prod deploy.
