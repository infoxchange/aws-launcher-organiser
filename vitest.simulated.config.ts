import { defineConfig } from "vitest/config";

/**
 * Browser tests against the captured AWS fixtures. No login and no network, so these are safe
 * to run in CI — unlike the live suite.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/simulated/**/*.test.ts"],
    environment: "node",
    testTimeout: 300000,
    hookTimeout: 180000,
    // Each file launches its own browser; running them in parallel fights over the profile dir.
    fileParallelism: false,
  },
});
