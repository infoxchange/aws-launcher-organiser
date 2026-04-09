import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Run unit tests in happy-dom
    setupFiles: [],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "happy-dom",
  },
  define: {
    "process.env.VITEST": "true",
  },
});

// NOTE: Integration tests with Playwright are separate
// Run them with: vitest --run tests/integration/
// Integration tests require user interaction for AWS SSO login on first run
