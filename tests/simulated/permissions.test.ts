/**
 * Permission behaviour of the real extension, in both browsers.
 *
 * These exist because the permission plumbing is where Chrome and Firefox diverge most, and
 * where a silent manifest mistake already shipped: `optional_host_permissions` is MV3-only, so
 * WXT dropped it from the Firefox MV2 build and the auto-update fetch only worked against
 * servers that happened to send permissive CORS headers.
 *
 * Neither browser lets automation click its permission prompt (Chrome cannot at all — Playwright
 * #32755 — and it hangs forever if asked), so the granted path is exercised with a test-only
 * manifest variant that declares the host permission as required. The denied path is covered by
 * unit tests over the message plumbing instead. See docs/permissions.md § "Testing permissions".
 */

import http from "node:http";
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type LaunchedExtension,
  launchWithExtension,
  type TargetBrowser,
} from "../support/launch-extension";
import { FIXTURE_URL, serveFixture } from "../support/serve-fixture";

const browsers = (process.env.FIXTURE_BROWSERS ?? "chrome,firefox").split(",") as TargetBrowser[];

const REMOTE_CONFIG = JSON.stringify({
  version: 1,
  groups: [{ key: "prod", name: "Production", matcher: ".*-prod$" }],
});

/**
 * A config server that deliberately sends NO CORS headers.
 *
 * This is the crux: a background fetch with a granted host permission bypasses CORS, while one
 * without it does not. A permissive server would let both cases pass and the test would prove
 * nothing.
 */
function startConfigServer(): Promise<{ url: string; close: () => Promise<void>; hits: number[] }> {
  const hits: number[] = [];
  const server = http.createServer((_req, res) => {
    hits.push(Date.now());
    res.writeHead(200, { "content-type": "application/json" });
    res.end(REMOTE_CONFIG);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}/config.json`,
        hits,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/** Drive the settings dialog to the point of running a connection test. */
async function runConnectionTest(page: Page, configUrl: string): Promise<string> {
  await page.click("#aws-account-tree-table .settings-button");
  await page.waitForSelector(".settings-dialog", { timeout: 15000 });

  // The URL field only renders once auto-update is switched on.
  const toggle = await page.$(
    ".auto-update-toggle-row .p-inputswitch, .auto-update-toggle-row input, .auto-update-toggle-row .p-toggleswitch"
  );
  await toggle?.click().catch(() => {});
  await page.waitForSelector(".settings-dialog .url-input", { timeout: 10000 });

  await page.fill(".settings-dialog .url-input", configUrl);
  await page.click(".settings-dialog .url-input-row button");

  // Wait for a settled (non-spinner) result message.
  await page.waitForFunction(
    () => {
      const el = document.querySelector(".test-result-message");
      const text = el?.textContent?.trim() ?? "";
      return text.length > 0;
    },
    undefined,
    { timeout: 30000 }
  );

  return page.evaluate(
    () => document.querySelector(".test-result-message")?.textContent?.trim() ?? ""
  );
}

describe.each(browsers)("permissions (%s)", (browser) => {
  /** @see docs/permissions.md § "Why this failed silently" - a granted host permission is
   *  what makes the fetch work against an arbitrary endpoint */
  describe("with the host permission granted", () => {
    let launched: LaunchedExtension;
    let server: Awaited<ReturnType<typeof startConfigServer>>;
    let page: Page;

    beforeAll(async () => {
      server = await startConfigServer();
      launched = await launchWithExtension(browser, { grantHostPermissions: true });
      await serveFixture(launched.context);
      page = await launched.context.newPage();
      await page.goto(FIXTURE_URL);
      await page.waitForSelector("#aws-account-tree-table", { timeout: 30000 });
    }, 120000);

    afterAll(async () => {
      await launched?.close();
      await server?.close();
    });

    it("fetches a remote config from a server that sends no CORS headers", async () => {
      const message = await runConnectionTest(page, server.url);
      expect(message).toContain("Config updated");
      expect(server.hits.length).toBeGreaterThan(0);
    }, 90000);
  });

  /** @see docs/permissions.md § "Why this failed silently" */
  describe("without the host permission", () => {
    let launched: LaunchedExtension;
    let server: Awaited<ReturnType<typeof startConfigServer>>;
    let page: Page;

    beforeAll(async () => {
      server = await startConfigServer();
      launched = await launchWithExtension(browser, { grantHostPermissions: false });
      await serveFixture(launched.context);
      page = await launched.context.newPage();
      await page.goto(FIXTURE_URL);
      await page.waitForSelector("#aws-account-tree-table", { timeout: 30000 });
    }, 120000);

    afterAll(async () => {
      await launched?.close();
      await server?.close();
    });

    // Chrome opens a permission prompt that automation cannot answer, so the call never
    // settles and there is nothing to assert. Firefox denies a background-initiated request
    // outright, which is observable.
    const maybeIt = browser === "firefox" ? it : it.skip;

    maybeIt(
      "surfaces a clear failure rather than silently appearing to work",
      async () => {
        const message = await runConnectionTest(page, server.url);
        expect(message).toMatch(/error/i);
      },
      90000
    );
  });
});
