/**
 * Browser and page utilities for integration tests
 */

import type { Page } from "playwright";

/**
 * Selectors that commonly indicate a login page
 */
const LOGIN_PAGE_INDICATORS = [
  'input[type="password"]',
  'button[type="submit"]',
  '[class*="login"]',
  '[class*="sign-in"]',
  '[class*="auth"]',
  'form[action*="login"]',
  'form[action*="signin"]',
];

/**
 * Detect if the current page is a login page
 */
export async function isLoginPage(page: Page): Promise<boolean> {
  try {
    // First check the URL - Microsoft login and AWS SSO login URLs are easy to detect
    const currentUrl = page.url();
    if (
      currentUrl.includes("login.microsoftonline.com") ||
      currentUrl.includes("login.aws.amazon.com") ||
      currentUrl.includes("signin.aws") ||
      currentUrl.includes("/login?") ||
      currentUrl.includes("/signin?")
    ) {
      return true;
    }

    // Then check if any login indicators are present in the DOM
    for (const selector of LOGIN_PAGE_INDICATORS) {
      try {
        const element = await page.$(selector);
        if (element) {
          return true;
        }
      } catch {
        // Selector not found, continue checking
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Wait for user to complete login
 * Waits for evidence of successful login (page navigation or specific element)
 */
export async function waitForLoginCompletion(page: Page, timeout = 300000): Promise<void> {
  let loginElementsGone = false;

  // Set up a listener for navigation events
  const navigationHandler = () => {
    // Navigation detected
  };

  page.on("framenavigated", navigationHandler);

  try {
    // Check periodically if login indicators are gone
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      // Check if login indicators are still present
      const hasLoginIndicators = await page.evaluate(() => {
        const indicators = [
          'input[type="password"]',
          '[class*="login"]',
          '[class*="sign-in"]',
          'form[action*="login"]',
          'form[action*="signin"]',
        ];
        return indicators.some((sel) => {
          try {
            return !!document.querySelector(sel);
          } catch {
            return false;
          }
        });
      });

      if (!hasLoginIndicators) {
        loginElementsGone = true;
        console.log("✓ Login indicators no longer present - login likely complete");
        break;
      }

      // Wait a bit before checking again
      await page.waitForTimeout(2000);
    }

    // If login elements are gone OR navigation occurred, consider login complete
    if (!loginElementsGone) {
      // Last check: give user 10 more seconds to see if anything changes
      console.log("⏳ Performing final login check...");
      await page.waitForTimeout(10000);

      const stillHasLogin = await page.evaluate(() => {
        return !!document.querySelector('input[type="password"]');
      });

      if (stillHasLogin) {
        throw new Error("Login page still visible after timeout");
      }
    }
  } catch (error) {
    // If we hit a timeout error, that's expected - user is still logging in
    if (error instanceof Error && error.message.includes("Timeout")) {
      console.log("⏳ Login timeout reached, but continuing...");
    } else {
      throw error;
    }
  } finally {
    page.off("framenavigated", navigationHandler);
  }
}

/**
 * Ensure browser is visible for user interaction
 */
export async function showBrowserForLogin(): Promise<void> {
  // Playwright doesn't directly control window visibility, but we can ensure visual feedback
  console.log("\n🔐 Login Required");
  console.log("Browser window should be visible. Please log in to continue.");
  console.log("Tests will resume automatically once login is complete.\n");
}

/**
 * Wait for the extension to finish extracting accounts without expanding any groups.
 * Use this when you need accounts to be loaded but don't want groups auto-expanded.
 */
export async function waitForExtensionReady(page: Page, timeout = 30000): Promise<void> {
  // Wait for the extension container to be injected
  await page.waitForSelector("#aws-account-tree-table", { timeout });

  // Wait for PrimeReact tree to render at least one node (could be a group)
  await page.waitForSelector("#aws-account-tree-table .p-tree-container li", { timeout });
  console.log("✓ Extension initialized and accounts are rendered");
}

/**
 * Wait for the extension to render accounts in its PrimeReact Tree
 * Returns the number of account nodes shown by the extension
 */
export async function waitForAccountsToLoad(page: Page, timeout = 30000): Promise<number> {
  try {
    // Wait for the extension container to be injected
    await page.waitForSelector("#aws-account-tree-table", { timeout });

    // Wait for PrimeReact tree to render at least one node (could be a group)
    await page.waitForSelector("#aws-account-tree-table .p-tree-container li", { timeout });

    // Expand all collapsed group nodes so their account children become visible.
    // With no config, all accounts are placed in a collapsed "Other" group by default.
    // Collapsed groups have no aria-expanded attribute; expanded groups have aria-expanded="true".
    // Leaf nodes have .p-treenode-leaf; we use :not(.p-treenode-leaf) to skip them.
    for (let pass = 0; pass < 5; pass++) {
      const accountNodes = await page.evaluate(
        () => document.querySelectorAll("#aws-account-tree-table .account-node").length
      );
      if (accountNodes > 0) break;
      // Collapsed groups have no aria-expanded attribute; expanded groups have aria-expanded="true".
      const collapsedTogglers = await page.$$(
        '#aws-account-tree-table [role="treeitem"]:not(.p-treenode-leaf):not([aria-expanded]) .p-tree-toggler'
      );
      if (collapsedTogglers.length === 0) break;
      for (const toggler of collapsedTogglers) {
        await toggler.click().catch(() => {}); // ignore stale element errors
      }
      await page.waitForTimeout(500);
    }

    // Wait for account nodes to appear after expanding groups
    await page.waitForSelector("#aws-account-tree-table .account-node", { timeout: 10000 });

    // Count all visible account nodes in the extension's tree
    return await page.evaluate(
      () => document.querySelectorAll("#aws-account-tree-table .account-node").length
    );
  } catch (error) {
    throw new Error(`Timeout waiting for extension to render accounts: ${error}`);
  }
}

/**
 * Navigate to a URL with proper error handling
 */
export async function navigateToUrl(page: Page, url: string, timeout = 30000): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  } catch (error) {
    // Network errors during navigation are sometimes expected
    console.warn(`Navigation warning: ${error}`);
  }
}
