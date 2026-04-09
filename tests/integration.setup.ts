/**
 * Integration test setup and fixtures
 * Provides browser context and utilities for Playwright integration tests
 *
 * IMPORTANT: Run `npm run test:integration:setup` before running tests for the first time
 */

import path from "node:path";
import { type Browser, type BrowserContext, chromium, type Page, type Worker } from "playwright";
import {
  isLoginPage,
  navigateToUrl,
  showBrowserForLogin,
  waitForLoginCompletion,
} from "../src/utils/test-browser";
import { loadConfig } from "../src/utils/test-config";
import { loadCookies, saveCookies } from "../src/utils/test-cookies";

/**
 * Global test context that persists across tests in a file
 */
export interface IntegrationTestContext {
  browser: Browser | null;
  context: BrowserContext;
  page: Page;
  ssoUrl: string;
  requiresLogin: boolean;
  expectedAccountCount: number;
  extensionId: string;
}

let contextGlobal: BrowserContext | null = null;

/**
 * Get path to the built extension
 */
function getExtensionPath(): string {
  return path.join(process.cwd(), ".output", "chrome-mv3");
}

/**
 * Get extension ID from service worker
 */
async function getExtensionId(context: BrowserContext): Promise<string> {
  let serviceWorker: Worker | undefined;

  // Get service worker or wait for it
  const workers = context.serviceWorkers();
  if (workers.length > 0) {
    serviceWorker = workers[0];
  } else {
    serviceWorker = await context.waitForEvent("serviceworker");
  }

  // Extract extension ID from service worker URL
  // URL format: chrome-extension://[EXTENSION_ID]/[path]
  const extensionUrl = serviceWorker.url();
  const match = extensionUrl.match(/chrome-extension:\/\/([^/]+)\//);

  if (!match || !match[1]) {
    throw new Error(`Could not extract extension ID from service worker URL: ${extensionUrl}`);
  }

  return match[1];
}

/**
 * Setup browser context for integration tests with loaded extension
 * Returns a reusable context that persists across tests
 *
 * NOTE: Requires `npm run test:integration:setup` to be run first
 */
export async function createTestContext(options?: {
  expandGroups?: boolean;
}): Promise<IntegrationTestContext> {
  const expandGroups = options?.expandGroups ?? true;
  try {
    // Load configuration (must exist from setup script)
    const config = loadConfig();
    if (!config?.ssoUrl || !config?.expectedAccountCount) {
      throw new Error(
        "\n❌ Integration test configuration not found!\n\n" +
          "Please run the setup script first:\n" +
          "  npm run test:integration:setup\n\n" +
          "This will prompt you for your SSO URL and expected account count.\n"
      );
    }

    const ssoUrl = config.ssoUrl;
    const expectedAccountCount = config.expectedAccountCount;

    console.log("\n📝 Using cached configuration:");
    console.log(`  SSO URL: ${ssoUrl}`);
    console.log(`  Expected accounts: ${expectedAccountCount}\n`);

    // Create persistent browser context with extension loaded
    if (!contextGlobal) {
      const extensionPath = getExtensionPath();

      console.log("🔧 Launching browser with extension...");
      console.log(`   Extension path: ${extensionPath}`);

      try {
        // Use launchPersistentContext to load the extension
        contextGlobal = await chromium.launchPersistentContext("", {
          headless: false,
          slowMo: 100,
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
          ],
        });
        console.log("✓ Browser launched with extension");
      } catch (error) {
        console.error("✗ Failed to launch browser with extension:", error);
        throw error;
      }
    }

    const context = contextGlobal;

    // Get extension ID from service worker
    console.log("🔍 Getting extension ID...");
    let extensionId: string;
    try {
      extensionId = await getExtensionId(context);
      console.log(`✓ Extension ID: ${extensionId}`);
    } catch (error) {
      console.error("✗ Failed to get extension ID:", error);
      throw error;
    }

    // Create a new page for the test
    const page = await context.newPage();
    console.log("✓ Page created");

    // Forward all browser console messages to the test runner output
    page.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("[DEBUG") ||
        text.includes("[extractAccounts") ||
        text.includes("[AccountTreeTable") ||
        text.includes("[getAccountRoles")
      ) {
        console.log(`[BROWSER ${msg.type().toUpperCase()}] ${text}`);
      }
    });

    // Try to load cached cookies
    console.log("🍪 Checking for cached authentication...");
    const loadedCookies = await loadCookies(context);
    if (loadedCookies) {
      console.log("✓ Loaded cached authentication");
    } else {
      console.log("ℹ No cached authentication found");
    }

    // Navigate to SSO page
    console.log(`🌐 Navigating to ${ssoUrl}...`);
    try {
      await navigateToUrl(page, ssoUrl);
      console.log("✓ Page loaded");
    } catch (error) {
      console.error("✗ Failed to navigate:", error);
      throw error;
    }

    // Give page a moment to fully load and execute scripts
    await page.waitForTimeout(2000);

    // Check if login is required (might be needed even with cached cookies)
    console.log("🔍 Checking if login is required...");
    let needsLogin = await isLoginPage(page);

    // If login is detected, wait a bit longer and check again
    // Sometimes the page needs more time to process cached cookies
    if (needsLogin) {
      console.log("⏳ Waiting for page to process cached authentication...");
      await page.waitForTimeout(3000);
      needsLogin = await isLoginPage(page);
    }

    if (needsLogin) {
      console.log("🔐 Login page detected - waiting for user to authenticate...");

      // Show message for user
      await showBrowserForLogin();

      // Wait for user to complete login
      console.log("⏳ Waiting for login completion (5 minute timeout)...");
      try {
        await waitForLoginCompletion(page);
        console.log("✓ Login completed");
      } catch (error) {
        console.error(
          "⚠ Login timeout (continuing anyway):",
          error instanceof Error ? error.message : error
        );
      }
    } else {
      console.log("✓ Already authenticated");
    }

    // Always save cookies after page loads, whether we logged in or were already authenticated
    await saveCookies(context);
    console.log("✓ Saved authentication state");

    // Wait for the extension to inject and render accounts
    console.log("⏳ Waiting for extension to initialize and render accounts...");
    try {
      // Wait for the extension container to be present
      await page.waitForSelector("#aws-account-tree-table", { timeout: 15000 });
      // Wait for PrimeReact tree to render at least one node
      await page.waitForSelector("#aws-account-tree-table .p-tree-container li", {
        timeout: 30000,
      });
      // Expand all collapsed groups (accounts default to a collapsed "Other" group).
      // aria-expanded is on the [role="treeitem"] element; click .p-tree-toggler inside it.
      if (expandGroups) {
        for (let pass = 0; pass < 5; pass++) {
          // Collapsed groups have no aria-expanded attribute; expanded groups have aria-expanded="true".
          // Leaf nodes have .p-treenode-leaf class, so :not is used to exclude them.
          const collapsedTogglers = await page.$$(
            '#aws-account-tree-table [role="treeitem"]:not(.p-treenode-leaf):not([aria-expanded]) .p-tree-toggler'
          );
          if (collapsedTogglers.length === 0) break;
          for (const toggler of collapsedTogglers) {
            await toggler.click().catch(() => {});
          }
          await page.waitForTimeout(500);
        }
      }
      console.log("✓ Extension initialized and accounts are rendered\n");
    } catch (error) {
      console.warn(
        "⚠ Extension did not render accounts within timeout:",
        error instanceof Error ? error.message : error
      );
    }

    return {
      browser: null, // Browser is managed by persistent context
      context,
      page,
      ssoUrl,
      requiresLogin: needsLogin,
      expectedAccountCount,
      extensionId,
    };
  } catch (error) {
    console.error("\n💥 Error in createTestContext:", error);
    throw error;
  }
}

/**
 * Clean up test context (close the page, but keep context open for other pages)
 */
export async function cleanupTestContext(ctx: IntegrationTestContext): Promise<void> {
  try {
    await ctx.page.close();
  } catch (error) {
    console.warn("Error cleaning up test context:", error);
  }
}

/**
 * Close persistent browser context (called once after all tests)
 */
export async function closeBrowser(): Promise<void> {
  if (contextGlobal) {
    try {
      await contextGlobal.close();
      contextGlobal = null;
    } catch (error) {
      console.warn("Error closing browser:", error);
    }
  }
}
