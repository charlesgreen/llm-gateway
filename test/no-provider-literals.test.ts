/**
 * THE GATE, WATCHED FIRING (DESIGN.md §0.1, §6).
 *
 * Asserts the authored source carries no vendor brand token, and — the part that
 * matters — proves the scanner CAN go red. A scan nobody has seen fail is a false
 * clear, so every discriminating behaviour is exercised against a planted fixture:
 * a bare token, the prefix-matched slug family, and the vacuous-pass hole (a scan
 * root that does not exist).
 *
 * `dist` is deliberately NOT asserted here: it does not exist until `build`, which
 * runs AFTER the test step in `pnpm check`. The dist scan is the `check` chain's
 * own `no-provider-literals` step; what this file guarantees is that the step
 * cannot silently scan nothing.
 *
 * Every token in this file is assembled at runtime from fragments, so the file
 * holds no clean literal of its own.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
// @ts-expect-error — JS module, no types; the scanner exports scanForLeaks/scanFiles.
import { scanForLeaks, scanFiles } from "../scripts/no-provider-literals.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Write `content` into a throwaway dir and hand the dir to `fn`. */
function withPlantedFile(content: string, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "literals-"));
  try {
    writeFileSync(join(dir, "planted.ts"), content);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("no-provider-literals — the shipped source is clean", () => {
  it("finds no vendor brand token in src/", () => {
    const hits = scanForLeaks([join(repoRoot, "src")]);
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });

  it("actually walks a non-trivial number of files (the roots are not empty)", () => {
    // Guards the other direction: "clean" is only meaningful if something was read.
    expect(scanFiles([join(repoRoot, "src")]).length).toBeGreaterThan(3);
  });
});

describe("no-provider-literals — NEGATIVE CONTROL (the scanner can go red)", () => {
  it("flags a planted vendor brand token", () => {
    const planted = ["anthr", "opic"].join("");
    withPlantedFile(`export const model = "${planted}/some-model";\n`, (dir) => {
      expect(scanForLeaks([dir]).length).toBeGreaterThan(0);
    });
  });

  it("flags a planted token that appears only in a COMMENT", () => {
    // The consumer's bundle retains dependency JSDoc, so prose leaks as surely as
    // code does. This is the case `removeComments` is only a second line of
    // defence for.
    const planted = ["op", "enai"].join("");
    withPlantedFile(`// routed through ${planted} today\nexport const x = 1;\n`, (dir) => {
      expect(scanForLeaks([dir]).length).toBeGreaterThan(0);
    });
  });

  it.each([
    ["gp", "t-4o"],
    ["gp", "t-4.1"],
    ["gp", "t-3.5-turbo"],
  ])("flags the prefix-matched slug variant %s%s", (...parts) => {
    const planted = parts.join("");
    withPlantedFile(`export const model = "${planted}";\n`, (dir) => {
      expect(scanForLeaks([dir]).length, planted).toBeGreaterThan(0);
    });
  });

  it("does NOT flag an innocent substring (the boundary is word-ish, not naive)", () => {
    // An over-broad gate gets weakened by the first person it inconveniences.
    withPlantedFile(`export const note = "internal coherence and opusculum";\n`, (dir) => {
      expect(scanForLeaks([dir])).toEqual([]);
    });
  });

  it("HARD-FAILS on a scan root that does not exist, rather than passing vacuously", () => {
    // dist/ is absent before `build`. A tolerant scanner would report "clean"
    // having walked nothing — the failure mode this assertion exists to prevent.
    expect(() => scanForLeaks([join(repoRoot, "definitely-not-a-real-root")])).toThrow(
      /scan root does not exist/,
    );
  });
});
