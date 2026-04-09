/**
 * Integration tests for AWS account extraction
 * Tests the extension functionality loading on the actual AWS SSO page
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waitForAccountsToLoad } from "../../src/utils/test-browser";
import type { IntegrationTestContext } from "../integration.setup";
import { createTestContext } from "../integration.setup";

describe("AWS Launcher Organiser Extension - Integration Tests", () => {
  let ctx: IntegrationTestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    if (ctx) {
      await cleanupTestContext(ctx);
    }
    // Note: closeBrowser() is called from vitest test reporter
  });

  it("should load the SSO page with the extension", async () => {
    expect(ctx.page).toBeDefined();
    expect(ctx.ssoUrl).toMatch(/https?:\/\/.+/);
    expect(ctx.extensionId).toBeTruthy();
    expect(ctx.extensionId).toHaveLength(32); // Chrome extension IDs are 32 chars

    // Check page is loaded
    const pageUrl = ctx.page.url();
    expect(pageUrl.length).toBeGreaterThan(0);
    // Should be on AWS SSO or auth related page
    expect(pageUrl).toMatch(/aws|signin|login|account/i);
  });

  it("should inject the AccountTreeTable component", async () => {
    // The extension injects #aws-account-tree-table into [role="tabpanel"]
    const hasExtensionContainer = await ctx.page.evaluate(() => {
      return document.getElementById("aws-account-tree-table") !== null;
    });
    expect(hasExtensionContainer).toBe(true);

    // The PrimeReact Tree should have rendered account nodes (not "No accounts found")
    const hasTreeItems = await ctx.page.evaluate(() => {
      return document.querySelectorAll("#aws-account-tree-table .p-tree-container li").length > 0;
    });
    expect(hasTreeItems).toBe(true);
  });

  it("should display the correct number of accounts", async () => {
    const accountCount = await waitForAccountsToLoad(ctx.page, 60000);
    expect(accountCount).toBe(ctx.expectedAccountCount);
  });

  it("should extract account data correctly", async () => {
    // The extension hides the original AWS table and renders its own tree.
    // Read accounts from the extension's rendered output.
    const accounts = await ctx.page.evaluate(() => {
      const accounts: { id: string; name: string }[] = [];

      // Account nodes in the extension's PrimeReact tree have the account-node class
      const accountNodes = document.querySelectorAll("#aws-account-tree-table .account-node");

      accountNodes.forEach((node) => {
        const name = node.querySelector(".account-name")?.textContent?.trim();
        // account-id is rendered as "(123456789012)" - strip parentheses
        const idRaw = node.querySelector(".account-id")?.textContent?.trim();
        const id = idRaw?.replace(/[()]/g, "");
        if (name && id) {
          accounts.push({ name, id });
        }
      });

      return accounts;
    });

    // Validate we extracted the expected number of accounts
    expect(accounts.length).toBe(ctx.expectedAccountCount);

    // Validate account structure
    accounts.slice(0, 3).forEach((account) => {
      expect(account).toHaveProperty("id");
      expect(account).toHaveProperty("name");

      // AWS account IDs are 12 digits
      expect(account.id).toMatch(/^\d{12}$/);
      // Name should be non-empty string
      expect(account.name.length).toBeGreaterThan(0);
    });
  });

  it("should handle pagination correctly", async () => {
    // Make sure accounts are loaded first
    await waitForAccountsToLoad(ctx.page, 60000);

    // Check if pagination controls exist
    const hasPagination = await ctx.page.evaluate(() => {
      const nextButton = document.querySelector('button[aria-label="Next page"]');
      return !!nextButton;
    });

    expect(hasPagination).toBe(true);
  });

  it("should navigate through pages without errors", async () => {
    // Make sure accounts are loaded first
    const firstPageCount = await waitForAccountsToLoad(ctx.page, 60000);
    expect(firstPageCount).toBeGreaterThan(0);

    // Check if next button is available
    const hasNextPage = await ctx.page.evaluate(() => {
      const nextButton = document.querySelector('button[aria-label="Next page"]');
      return !!nextButton && !nextButton.hasAttribute("disabled");
    });

    if (hasNextPage) {
      // Click next page directly via JS — the extension overlay may obscure the button from Playwright's click action
      await ctx.page.evaluate(() => {
        (document.querySelector('button[aria-label="Next page"]') as HTMLButtonElement)?.click();
      });

      // Wait for page to update
      await ctx.page.waitForTimeout(1500);

      // Verify accounts are still shown in the extension tree
      // (the extension re-queries after pagination)
      const accountsVisible = await ctx.page.evaluate(
        () => document.querySelectorAll("#aws-account-tree-table .account-node").length
      );

      expect(accountsVisible).toBeGreaterThan(0);
    }
  });
});
