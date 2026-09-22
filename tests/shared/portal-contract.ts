/**
 * The behavioural contract the extension expects of the AWS access portal.
 *
 * These specs are run twice: against the captured fixtures (`tests/simulated/`) and against the
 * real portal (`tests/live/`). That is what makes the simulation trustworthy — if `simulator.js`
 * drifts from how AWS actually behaves, the live run fails on the same assertion that the
 * simulated run passes.
 *
 * Everything here is therefore phrased so it holds without knowing the org's account count in
 * advance: self-consistency and shape, not magic numbers. Exact counts are asserted separately by
 * the simulated suite, which does know them from `meta.json`.
 *
 * @see docs/testing.md § "The layers"
 */

import type { Page } from "playwright";
import { expect, it } from "vitest";

export interface PortalContext {
  page: Page;
  /** Extraction log lines collected from the page console since load. */
  extractionLogs: string[];
}

const TOTAL_LINE = /Total accounts extracted:\s*(\d+)/;

/**
 * Wait until the extension has finished paginating, and return the total it reported.
 *
 * Uses the extension's own completion log rather than a DOM count, because it is the one signal
 * that means the same thing in both modes regardless of how many accounts the org has.
 */
export async function waitForExtractionComplete(
  ctx: PortalContext,
  timeoutMs = 180_000
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const line = ctx.extractionLogs.find((l) => TOTAL_LINE.test(l));
    if (line) return Number.parseInt(TOTAL_LINE.exec(line)?.[1] ?? "0", 10);
    await ctx.page.waitForTimeout(500);
  }
  throw new Error(
    `Extraction did not finish within ${timeoutMs}ms. Last logs:\n` +
      ctx.extractionLogs.slice(-5).join("\n")
  );
}

/** Expand every collapsed group so account nodes become inspectable. */
export async function expandAllGroups(page: Page): Promise<void> {
  for (let pass = 0; pass < 6; pass++) {
    const togglers = await page.$$(
      '#aws-account-tree-table [role="treeitem"]:not(.p-treenode-leaf):not([aria-expanded]) .p-tree-toggler'
    );
    if (togglers.length === 0) return;
    for (const toggler of togglers) {
      await toggler.click().catch(() => {}); // nodes re-render, so stale handles are expected
    }
    await page.waitForTimeout(500);
  }
}

/** Account ids currently rendered in the extension's tree. */
export async function renderedAccountIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("#aws-account-tree-table .account-node")).map(
      (node) => node.querySelector(".account-id")?.textContent?.replace(/[()]/g, "").trim() ?? ""
    )
  );
}

/**
 * Register the shared contract specs. Call from inside a `describe`.
 *
 * `getCtx` is a getter rather than a value because the context is built in `beforeAll`, which
 * runs after the spec bodies are registered.
 */
export function definePortalContract(getCtx: () => PortalContext): void {
  it("injects its UI into the portal page", async () => {
    const { page } = getCtx();
    expect(await page.locator("#aws-account-tree-table").count()).toBe(1);
  });

  /**
   * The single most important parity assertion in the suite.
   *
   * AWS marks the final page's Next button disabled with `aria-disabled` and a hashed class, and
   * never with the `disabled` attribute. `simulator.js` reproduces that shape deliberately. If
   * AWS ever switches to a plain `disabled` attribute, this fails in the live run while the
   * simulated run keeps passing — which is exactly the signal that the fixtures have gone stale.
   *
   * @see docs/aws-page-integration.md § "Pagination controls are not disabled with `disabled`"
   */
  it("marks the final page's Next button disabled without a disabled attribute", async () => {
    const { page } = getCtx();
    await waitForExtractionComplete(getCtx());

    // Extraction leaves the portal on its last page.
    const state = await page.evaluate(() => {
      const next = document.querySelector('button[aria-label="Next page"]');
      if (!next) return null;
      return {
        hasDisabledAttribute: next.hasAttribute("disabled"),
        ariaDisabled: next.getAttribute("aria-disabled"),
        className: next.className,
      };
    });

    expect(state).not.toBeNull();
    expect(state?.hasDisabledAttribute).toBe(false);
    expect(state?.ariaDisabled).toBe("true");
    expect(state?.className).toContain("button-disabled");
  });

  /**
   * @see docs/aws-page-integration.md § "Pagination must prove it moved"
   */
  it("visits each page exactly once and never reaches the safety limit", async () => {
    const ctx = getCtx();
    await waitForExtractionComplete(ctx);

    const pageCount = await ctx.page.evaluate(() => {
      const numbers = Array.from(document.querySelectorAll('button[aria-label^="Page"]'))
        .map((b) => Number.parseInt(b.textContent ?? "", 10))
        .filter((n) => !Number.isNaN(n));
      return numbers.length > 0 ? Math.max(...numbers) : 1;
    });

    const visited = ctx.extractionLogs.filter((line) => /Starting to load page \d+/.test(line));
    expect(visited).toHaveLength(pageCount);

    expect(ctx.extractionLogs.some((line) => line.includes("safety limit"))).toBe(false);
    expect(ctx.extractionLogs.some((line) => line.includes("already seen"))).toBe(false);
  });

  it("renders every extracted account exactly once", async () => {
    const ctx = getCtx();
    const reported = await waitForExtractionComplete(ctx);

    await expandAllGroups(ctx.page);
    const ids = await renderedAccountIds(ctx.page);

    expect(ids).toHaveLength(reported);
    expect(new Set(ids).size).toBe(reported);
    for (const id of ids) {
      expect(id).toMatch(/^\d{12}$/);
    }
  });
}
