/**
 * The real built extension against captured AWS fixtures, in both browsers.
 *
 * No AWS login, no network, deterministic counts — these run in CI. The shared contract specs
 * here also run against the real portal from `tests/live/`, which is what keeps the simulation
 * honest.
 *
 * Requires a build:  npm run build:chrome  (and build:firefox for the Firefox target)
 *
 * @see docs/testing.md § "The layers"
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  definePortalContract,
  expandAllGroups,
  type PortalContext,
  renderedAccountIds,
  waitForExtractionComplete,
} from "../shared/portal-contract";
import {
  type LaunchedExtension,
  launchWithExtension,
  type TargetBrowser,
} from "../support/launch-extension";
import {
  FIXTURE_URL,
  loadFixtureMeta,
  serveFixture,
  warnIfFixturesStale,
} from "../support/serve-fixture";

const meta = loadFixtureMeta();

// Firefox needs the RDP install helper; set FIXTURE_BROWSERS=chrome to skip it while iterating.
const browsers = (process.env.FIXTURE_BROWSERS ?? "chrome,firefox").split(",") as TargetBrowser[];

describe.each(browsers)("extension against fixtures (%s)", (browser) => {
  let launched: LaunchedExtension;
  let ctx: PortalContext;

  beforeAll(async () => {
    warnIfFixturesStale();
    launched = await launchWithExtension(browser);
    await serveFixture(launched.context);

    const page = await launched.context.newPage();
    const extractionLogs: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (/extractAccountsProgressive|goToNextPage|getAccountRoles/.test(text)) {
        extractionLogs.push(text);
      }
    });

    await page.goto(FIXTURE_URL);
    await page.waitForSelector("#aws-account-tree-table", { timeout: 30000 });
    ctx = { page, extractionLogs };
  }, 120000);

  afterAll(async () => {
    await launched?.close();
  });

  // The same specs run against the live portal — see tests/live/portal.test.ts.
  definePortalContract(() => ctx);

  /** @see docs/testing.md § "The simulator" */
  it("has a fully initialised fixture simulator", async () => {
    await ctx.page.waitForFunction(
      () => document.documentElement.dataset.fixtureSimulatorReady === "true",
      undefined,
      { timeout: 30000 }
    );
    // The simulator blacks out the pagination controls briefly on each page change, mirroring
    // the portal, so wait for them rather than sampling at an arbitrary moment.
    await ctx.page.waitForFunction(
      (expected) => document.querySelectorAll('button[aria-label^="Page"]').length === expected,
      meta.pages,
      { timeout: 15000 }
    );
  });

  // Only the fixture run can assert exact numbers: it knows what was captured. The live run
  // asserts the same behaviour in terms of self-consistency instead.
  it("extracts exactly the captured number of accounts", async () => {
    const reported = await waitForExtractionComplete(ctx);
    expect(reported).toBe(meta.expectedAccountTotal);

    await expandAllGroups(ctx.page);
    const ids = await renderedAccountIds(ctx.page);
    expect(ids).toHaveLength(meta.expectedAccountTotal);
    expect(new Set(ids).size).toBe(meta.expectedAccountTotal);
  }, 180000);

  it("walks exactly the captured number of pages", async () => {
    await waitForExtractionComplete(ctx);
    const visited = ctx.extractionLogs.filter((line) => /Starting to load page \d+/.test(line));
    expect(visited).toHaveLength(meta.pages);
  });
});
