import { defineConfig } from "vitest/config";

// Hermetic unit suite. NOTHING here reaches the network: every case drives the
// client through an injected fake fetch, and the package holds no credentials.
// A live check against a real gateway belongs in a consumer's post-deploy
// synthetic, where real credentials and a real environment already exist.
export default defineConfig({
  test: {
    environment: "node",
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: process.env.CI ? { junit: "./test-results/junit.xml" } : undefined,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary", "json"],
      include: ["src/**/*.ts"],
      // Barrels and pure type declarations carry no logic and would only drag
      // the denominator (same exclusions as the house shared config).
      exclude: ["test/**", "**/index.ts", "**/types.ts", "**/*.d.ts"],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
