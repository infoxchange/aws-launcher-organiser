/**
 * Role loading across pages, under the concurrency that exposed it on the live portal.
 *
 * Extraction is covered by extraction.test.ts. This file covers what happens *after*: the
 * extension lazily loads each visible account's roles, and an account on page 3 requires
 * navigating back to page 3 first. With many accounts visible, those navigations interleave and
 * the portal spends its time flicking between pages.
 *
 * Two real bugs lived in that window, both reported by a user and neither catchable by the
 * fixture suite as it stood:
 *
 *   1. "Account row not found for id: …" — the pagination controls vanish while the portal
 *      re-renders, `getCurrentPageNumber()` defaulted to 1, so code on page 4 tried to move
 *      forward to reach page 3, hit the disabled Next button and gave up on the wrong page.
 *   2. "the expanded row never rendered" — the role row was awaited via a held element
 *      reference, which a re-render detaches.
 *
 * @see docs/aws-page-integration.md § "The pagination controls vanish on every page change, not just at load"
 * @see docs/aws-page-integration.md § "Roles load asynchronously, and must be scoped to their own row"
 */

import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  expandAllGroups,
  type PortalContext,
  waitForExtractionComplete,
} from "../shared/portal-contract";
import {
  type LaunchedExtension,
  launchWithExtension,
  type TargetBrowser,
} from "../support/launch-extension";
import { FIXTURE_URL, loadFixtureMeta, serveFixture } from "../support/serve-fixture";

const meta = loadFixtureMeta();
const browsers = (process.env.FIXTURE_BROWSERS ?? "chrome,firefox").split(",") as TargetBrowser[];

/** Scroll the whole list so accounts from every page become visible and start loading roles. */
async function sweepList(page: Page, passes = 2): Promise<void> {
  for (let pass = 0; pass < passes; pass++) {
    for (let step = 0; step < 25; step++) {
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(200);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
  }
}

async function roleStats(page: Page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("#aws-account-tree-table .account-node"));
    const roleCounts = nodes
      .map((n) => n.querySelectorAll(".account-role-link").length)
      .filter((c) => c > 0);
    return {
      accountsWithRoles: roleCounts.length,
      maxRolesOnOneAccount: roleCounts.length ? Math.max(...roleCounts) : 0,
      errors: Array.from(document.querySelectorAll("#aws-account-tree-table .role-load-error")).map(
        (e) => e.textContent?.trim() ?? ""
      ),
    };
  });
}

describe.each(browsers)("role loading across pages (%s)", (browser) => {
  let launched: LaunchedExtension;
  let ctx: PortalContext;
  let navigationLines: string[];

  beforeAll(async () => {
    launched = await launchWithExtension(browser);
    await serveFixture(launched.context);

    const page = await launched.context.newPage();
    await page.setViewportSize({ width: 1280, height: 1200 });

    const extractionLogs: string[] = [];
    navigationLines = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (/extractAccountsProgressive|goToNextPage|getAccountRoles/.test(text)) {
        extractionLogs.push(text);
      }
      if (/\[navigateToPage\]/.test(text)) navigationLines.push(text);
    });

    await page.goto(FIXTURE_URL);
    await page.waitForSelector("#aws-account-tree-table", { timeout: 30000 });
    ctx = { page, extractionLogs };

    await waitForExtractionComplete(ctx);
    await expandAllGroups(page);
    await sweepList(page);

    // Give the lazily-triggered role loads time to drain.
    await page.waitForTimeout(20000);
  }, 300000);

  afterAll(async () => {
    await launched?.close();
  });

  // Without cross-page navigation this file would pass vacuously, so assert it happened.
  it("exercises navigation between pages while loading roles", () => {
    expect(navigationLines.length).toBeGreaterThan(0);
  });

  it("loads roles for a meaningful number of accounts", async () => {
    const stats = await roleStats(ctx.page);
    expect(stats.accountsWithRoles).toBeGreaterThan(10);
  });

  it("reports no role-loading errors", async () => {
    const stats = await roleStats(ctx.page);
    // Names the failures rather than just a count, so a regression is diagnosable from CI output.
    expect(stats.errors.slice(0, 5)).toEqual([]);
  });

  it("never attributes another account's roles to an account", async () => {
    // The fixture's role row carries exactly one role, so anything above one means roles from
    // elsewhere in the document leaked into this account.
    const stats = await roleStats(ctx.page);
    expect(stats.maxRolesOnOneAccount).toBeLessThanOrEqual(1);
  });

  it("still shows every account exactly once afterwards", async () => {
    const ids = await ctx.page.evaluate(() =>
      Array.from(document.querySelectorAll("#aws-account-tree-table .account-node")).map(
        (n) => n.querySelector(".account-id")?.textContent?.replace(/[()]/g, "").trim() ?? ""
      )
    );
    expect(ids).toHaveLength(meta.expectedAccountTotal);
    expect(new Set(ids).size).toBe(meta.expectedAccountTotal);
  });
});
