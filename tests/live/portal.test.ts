/**
 * The real built extension against the REAL AWS access portal.
 *
 * Usage:
 *   npm run test:live            # Chrome
 *   FIXTURE_BROWSERS=firefox npm run test:live
 *
 * Needs an AWS session, so this never runs in CI. A browser window opens; log in when prompted.
 * Requires `npm run test:integration:setup` to have been run once, for the SSO URL.
 *
 * This file deliberately contains almost no assertions of its own. It runs the *same* contract
 * specs as the fixture suite, which is how "does the simulation match reality?" gets answered:
 * the same assertion passing in both places. A divergence shows up here as a failure while the
 * simulated run stays green.
 *
 * @see docs/testing.md § "The layers"
 */

import type { Page } from "playwright";
import { afterAll, beforeAll, describe } from "vitest";
import { definePortalContract, type PortalContext } from "../shared/portal-contract";
import {
  type LaunchedExtension,
  launchWithExtension,
  type TargetBrowser,
} from "../support/launch-extension";
import { navigateToUrl } from "../support/test-browser";
import { loadConfig } from "../support/test-config";
import { loadCookies, saveCookies } from "../support/test-cookies";

const browser = (process.env.FIXTURE_BROWSERS ?? "chrome").split(",")[0] as TargetBrowser;

/**
 * Wait until the browser has landed back on the start page and stayed there.
 *
 * Mirrors scripts/capture-fixture.ts: the absence of a login form is not enough, because a SAML
 * redirect chain passes through pages that have none.
 */
async function waitForStartPage(page: Page, ssoUrl: string, timeoutMs = 600_000): Promise<void> {
  const target = new URL(ssoUrl);
  const targetPath = target.pathname.replace(/\/$/, "");
  const deadline = Date.now() + timeoutMs;
  let stable = 0;

  while (Date.now() < deadline) {
    let current: URL | null = null;
    try {
      current = new URL(page.url());
    } catch {
      current = null;
    }

    const onStartPage =
      !!current &&
      current.host === target.host &&
      current.pathname.replace(/\/$/, "").startsWith(targetPath);
    const authenticating = await page
      .$('input[type="password"]')
      .then((el) => !!el)
      .catch(() => false);

    if (onStartPage && !authenticating) {
      if (++stable >= 3) return;
    } else {
      stable = 0;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`Timed out waiting to land on ${ssoUrl}. Last URL: ${page.url()}`);
}

describe(`extension against the live AWS portal (${browser})`, () => {
  let launched: LaunchedExtension;
  let ctx: PortalContext;

  beforeAll(async () => {
    const config = loadConfig();
    if (!config?.ssoUrl) {
      throw new Error(
        "\n❌ No SSO URL configured.\n\nRun this first:\n  npm run test:integration:setup\n"
      );
    }

    // Headed: a login may be required, and nobody can type into a headless window.
    launched = await launchWithExtension(browser, { headless: false });
    await loadCookies(launched.context);

    const page = await launched.context.newPage();
    const extractionLogs: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (/extractAccountsProgressive|goToNextPage|getAccountRoles/.test(text)) {
        extractionLogs.push(text);
        console.log(`[live] ${text}`);
      }
    });

    console.log(`\n🌐 Navigating to ${config.ssoUrl}`);
    console.log("🔐 Log in in the browser window if prompted...\n");
    await navigateToUrl(page, config.ssoUrl);
    await waitForStartPage(page, config.ssoUrl);
    await saveCookies(launched.context);

    await page.waitForSelector("#aws-account-tree-table", { timeout: 60000 });
    ctx = { page, extractionLogs };
  }, 900000);

  afterAll(async () => {
    await launched?.close();
  });

  definePortalContract(() => ctx);
});
