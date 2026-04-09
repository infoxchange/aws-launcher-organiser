/**
 * Integration tests for AWS account role loading
 * Tests that the extension can load and display roles for accounts
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IntegrationTestContext } from "../integration.setup";
import { cleanupTestContext, createTestContext } from "../integration.setup";

describe("AWS Launcher Organiser Extension - Role Loading Tests", () => {
  let ctx: IntegrationTestContext;

  beforeAll(async () => {
    ctx = await createTestContext({ expandGroups: false });
  });

  afterAll(async () => {
    if (ctx) {
      await cleanupTestContext(ctx);
    }
  });

  it("should create a group with a regex matcher and show exactly the matching account, with roles loading", async () => {
    // 1. Read the first account name from the underlying AWS SSO table (not the extension tree).
    // This avoids triggering role loading that would happen if we expanded the extension's "Other" group.
    const targetAccountName = await ctx.page.evaluate(() => {
      const nameEl = document.querySelector<HTMLElement>(
        'table[role="treegrid"] tr[data-selection-item="item"] th [data-testid="account-list-cell"]'
      );
      return nameEl?.textContent?.trim() ?? null;
    });
    expect(targetAccountName).not.toBeNull();
    console.log(`[roles test] target account: "${targetAccountName}"`);

    // 2. Enter edit mode
    await ctx.page.click("#aws-account-tree-table .edit-button");
    await ctx.page.waitForSelector("#aws-account-tree-table .add-root-group-button", {
      timeout: 5000,
    });

    // 3. Click "+ add group" (root level) — this creates a "New Group" node
    await ctx.page.click("#aws-account-tree-table .add-root-group-button");

    // 4. Wait for the new "New Group" node and click its pencil (edit) button to open the editor
    await ctx.page.waitForSelector("#aws-account-tree-table .group-edit-button", { timeout: 5000 });
    // Click the last group-edit-button (the newly added group is at the top, before "Other")
    const editButtons = ctx.page.locator("#aws-account-tree-table .group-edit-button");
    await editButtons.first().click();

    // 5. Wait for the group editor to appear
    await ctx.page.waitForSelector("#aws-account-tree-table .group-editor", { timeout: 5000 });

    // 5. Find the new group's editor and read the key from the matcher textarea id
    const groupKey = await ctx.page.evaluate(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '#aws-account-tree-table .group-editor textarea[id^="matcher-"]'
      );
      return textarea?.id.replace("matcher-", "") ?? null;
    });
    expect(groupKey).not.toBeNull();

    // 6. Set the matcher to an exact-match regex for this account
    const matcher = `^${targetAccountName}$`;
    await ctx.page.fill(`#aws-account-tree-table textarea[id="matcher-${groupKey}"]`, matcher);

    // 7. Save the group
    await ctx.page.click("#aws-account-tree-table .group-editor button:has(.pi-check)");

    // 8. Wait for the new group node to show "(1)" account count
    await ctx.page.waitForFunction(
      () => {
        const groups = document.querySelectorAll("#aws-account-tree-table .group-name");
        return Array.from(groups).some((g) => g.textContent?.includes("(1)"));
      },
      { timeout: 10000 }
    );

    // Find the li[role="treeitem"] for the new group (has "New Group" and "(1)")
    const newGroupNode = ctx.page
      .locator('#aws-account-tree-table [role="treeitem"]:not(.p-treenode-leaf)')
      .filter({ hasText: /New Group\s*\(1\)/ })
      .first();

    // 9. Expand the new group
    await newGroupNode.evaluate((el) => {
      el.querySelector<HTMLElement>(":scope > .p-treenode-content > .p-tree-toggler")?.click();
    });

    // 10. Wait for exactly one account node to be VISIBLE (not in a collapsed group)
    // PrimeReact hides collapsed children by setting aria-hidden on the parent ul.
    // Use offsetParent === null to detect hidden elements.
    const accountNodes = await ctx.page.evaluate(() => {
      return Array.from(document.querySelectorAll("#aws-account-tree-table .account-node")).filter(
        (el) => (el as HTMLElement).offsetParent !== null
      ).length;
    });
    console.log(`[roles test] visible account nodes after expanding new group: ${accountNodes}`);

    await ctx.page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("#aws-account-tree-table .account-node")).filter(
          (el) => (el as HTMLElement).offsetParent !== null
        ).length === 1,
      { timeout: 5000 }
    );

    // 11. Verify exactly one account visible and it matches the target name
    const visibleAccounts = await ctx.page.evaluate(() => {
      return Array.from(document.querySelectorAll("#aws-account-tree-table .account-node"))
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => el.querySelector(".account-name")?.textContent?.trim() ?? "");
    });
    expect(visibleAccounts).toHaveLength(1);
    expect(visibleAccounts[0]).toBe(targetAccountName);

    // 13. Wait for the role to load automatically (roles auto-load via IntersectionObserver when visible)
    await ctx.page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("#aws-account-tree-table .account-node"))
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .some((el) => el.querySelector(".account-role-link") !== null),
      { timeout: 30000 }
    );

    const roles = await ctx.page.evaluate(() =>
      Array.from(document.querySelectorAll("#aws-account-tree-table .account-node"))
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .flatMap((el) => Array.from(el.querySelectorAll(".account-role-link")))
        .map((a) => a.textContent?.trim() ?? "")
    );
    expect(roles.length).toBeGreaterThan(0);
    console.log(`[roles test] account "${targetAccountName}" has roles: ${roles.join(", ")}`);

    // 14. Verify each role link is a valid AWS console URL
    const roleHrefs = await ctx.page.evaluate(() =>
      Array.from(document.querySelectorAll("#aws-account-tree-table .account-node"))
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .flatMap((el) => Array.from(el.querySelectorAll<HTMLAnchorElement>(".account-role-link")))
        .map((a) => a.href)
    );
    for (const href of roleHrefs) {
      expect(href).toMatch(
        /^https:\/\/(.*\.amazonaws\.com|.*\.aws\.amazon\.com|signin\.aws\.amazon\.com|.*\.awsapps\.com)/
      );
    }
  });
});
