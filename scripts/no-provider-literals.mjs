#!/usr/bin/env node
/**
 * NO-PROVIDER-LITERALS — this package's consumer-compatibility gate.
 *
 * Not a style rule. The primary consumer runs an opsec leak-scan over its WRANGLER
 * DRY-RUN BUNDLE, and that bundle inlines dependency code — identifiers, string
 * literals AND retained comments. So a single vendor brand token anywhere in this
 * package's shipped output turns the consumer's `check` red and keeps it red. Zero
 * literals is therefore a hard interface requirement, verified here over BOTH `src`
 * (what is authored) and `dist` (what is actually bundled).
 *
 * The token list MIRRORS the consumer's scanner deliberately: this gate going green
 * must be a reliable predictor of the consumer's gate going green. When one side
 * adds a token, the other adds it too. Never weaken the list to make a scan pass —
 * the fix is always to route the value through configuration instead.
 *
 * Two self-reference defences, both carried over from the consumer's scanner:
 *   1. tokens are ASSEMBLED AT RUNTIME from fragments, so this file holds no clean
 *      literal that a naive scan of it would flag;
 *   2. this file's own path is self-excluded regardless.
 * Without both, the gate flags itself the moment its scan roots widen.
 *
 * Usage: node scripts/no-provider-literals.mjs [root ...]   (defaults to src dist)
 * Exits 0 clean, 1 on a hit. `scanForLeaks` is imported by the vitest gate too.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import process from "node:process";

// Vendor brand tokens, assembled from fragments so this file holds no clean
// literal. Case-insensitive, word-ish boundaries. Keep additive.
const FRAGMENTS = [
  ["anthr", "opic"],
  ["cla", "ude"],
  ["op", "enai"],
  ["gem", "ini"],
  ["mist", "ral"],
  ["lla", "ma"],
  ["coh", "ere"],
  ["sonn", "et"],
  ["ha", "iku"],
  ["op", "us"],
  ["grok"],
  ["deep", "seek"],
  ["qw", "en"],
];

const TOKENS = FRAGMENTS.map((parts) => parts.join(""));

// A subset of model-family slugs are PREFIX-matched: the base slug must also catch
// its letter-suffixed / dotted point-version variants, not just the bare token. A
// whole-word `\b…\b` boundary misses the letter-suffixed form (there is no word
// boundary between a trailing digit and a following letter). These fragments carry
// their OWN trailing matcher and so are anchored only on the LEADING `\b`.
const PREFIX_FRAGMENTS = [
  ["gp", "t-4"],
  ["gp", "t-3"],
];
const PREFIX_TOKENS = PREFIX_FRAGMENTS.map((parts) => `${parts.join("")}[\\w.]*`);

// Whole-word tokens get a trailing `\b` so an innocent substring cannot match
// (e.g. "co-here-nce" must NOT trip the token above it). Prefix tokens supply their
// own greedy suffix instead. Both share the leading `\b`.
const PATTERN = new RegExp(`\\b(?:(?:${TOKENS.join("|")})\\b|(?:${PREFIX_TOKENS.join("|")}))`, "i");

// Sourcemaps embed `sourcesContent` we do not author, so scanning them would flag
// vendored code rather than ours. The emitted `.js` IS the shipped surface and is
// scanned; `.d.ts` is shipped too and is covered by the `.ts` extension.
const SCAN_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs", ".json"]);

// The scanner itself is the only exclusion. There is deliberately no allowance for
// docs, tests or fixtures inside the scan roots: `src` and `dist` contain nothing
// but shipped code, and an exemption is how a gate stops seeing real hits.
const EXCLUDE_PATH_FRAGMENTS = ["node_modules", "no-provider-literals"];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (EXCLUDE_PATH_FRAGMENTS.some((f) => full.includes(f))) continue;
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (SCAN_EXTENSIONS.has(extname(full))) yield full;
  }
}

/**
 * Every file the given roots resolve to.
 *
 * A missing root is a HARD ERROR, not a skip. `dist` only exists after `build`, so
 * a tolerant scanner would report "clean" having walked nothing at all — a gate
 * that passes vacuously is worse than no gate, because it is believed.
 */
export function scanFiles(roots) {
  const files = [];
  for (const root of roots) {
    if (!existsSync(root)) {
      throw new Error(
        `no-provider-literals: scan root does not exist: ${root} ` +
          `(build before scanning dist/ — a skipped root would pass vacuously)`,
      );
    }
    const stat = statSync(root);
    if (stat.isDirectory()) files.push(...walk(root));
    else if (!EXCLUDE_PATH_FRAGMENTS.some((f) => root.includes(f))) files.push(root);
  }
  return files;
}

/** Scan the given roots; return an array of { file, line, text } hits. */
export function scanForLeaks(roots) {
  const hits = [];
  for (const file of scanFiles(roots)) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (PATTERN.test(lines[i])) {
        hits.push({ file, line: i + 1, text: lines[i].trim().slice(0, 120) });
      }
    }
  }
  return hits;
}

// CLI entrypoint.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const roots = process.argv.slice(2);
  // README and package.json are roots because npm publishes both REGARDLESS of the
  // `files` allowlist, so they are shipped surface even though neither is code
  // (package.json's description and keywords are free text). Passed as explicit
  // file paths they bypass the extension filter.
  const targets = roots.length > 0 ? roots : ["src", "dist", "README.md", "package.json"];
  let hits;
  let scanned;
  try {
    scanned = scanFiles(targets).length;
    hits = scanForLeaks(targets);
  } catch (err) {
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  if (hits.length > 0) {
    console.error(`::error::no-provider-literals FAILED — ${hits.length} hit(s):`);
    for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.text}`);
    process.exit(1);
  }
  console.log(`no-provider-literals clean — ${scanned} file(s) across: ${targets.join(", ")}`);
}
