import { defineConfig } from "vitest/config";

/**
 * Tests against the real AWS portal. Needs a login, so these never run in CI — see
 * docs/testing.md § "The layers".
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/live/**/*.test.ts"],
    environment: "node",
    testTimeout: 600000,
    hookTimeout: 900000,
    fileParallelism: false,
  },
});
