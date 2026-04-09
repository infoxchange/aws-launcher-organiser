import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for integration tests
 * Run with: vitest --config vitest.integration.config.ts --run tests/integration/
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 600000, // 10 minutes for integration tests
    hookTimeout: 300000, // 5 minutes for setup/teardown
  },
  define: {
    "process.env.VITEST": "true",
    "process.env.VITEST_INTEGRATION": "true",
  },
});
