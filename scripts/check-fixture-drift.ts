/**
 * Early warning that AWS has changed the access portal's markup.
 *
 * Usage:
 *   npm run fixture:check
 *
 * Logs into the real portal, counts every selector the extension depends on, and diffs those
 * counts against the committed fixture's census. One page load, no extension, no DOM dump —
 * it answers "did anything move?" in seconds, and when something has, it names the selector
 * instead of surfacing later as an empty account list.
 *
 * This is the only part of the test suite that needs a live AWS session, so it stays manual.
 */

import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { selectors } from "../src/utils/aws-page/selectors";
import { navigateToUrl } from "../tests/support/test-browser";
import { loadConfig } from "../tests/support/test-config";
import { loadCookies, saveCookies } from "../tests/support/test-cookies";

const META_FILE = path.join(process.cwd(), "tests", "fixtures", "aws-start-page", "meta.json");

/** Mirrors capture-fixture.ts — see the comment there for why absence of a login form is not enough. */
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
      if (++stable >= 3) {
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        return;
      }
    } else {
      stable = 0;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`Timed out waiting to land on ${ssoUrl}. Last URL: ${page.url()}`);
}

async function main() {
  const config = loadConfig();
  if (!config?.ssoUrl) {
    throw new Error(
      "\n❌ No SSO URL configured.\n\nRun this first:\n  npm run test:integration:setup\n"
    );
  }
  if (!fs.existsSync(META_FILE)) {
    throw new Error(
      `\n❌ No fixture census at ${META_FILE}\n\nRun:\n  npm run fixture:capture && npm run fixture:sanitise\n`
    );
  }

  const meta = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
  const expected: Record<string, number> = meta.selectorCensus?.["page-1.html"] ?? {};

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  try {
    await loadCookies(context);
    const page = await context.newPage();
    // Named-function helpers are rewritten by esbuild's keepNames into a `__name()` call that
    // does not exist in the page; this no-op shim keeps page.evaluate working.
    const shim = "globalThis.__name = globalThis.__name || ((fn) => fn);";
    await page.addInitScript(shim);

    console.log(`🌐 Navigating to ${config.ssoUrl}...`);
    await navigateToUrl(page, config.ssoUrl);
    console.log("\n🔐 Log in if prompted. Waiting for the start page...\n");
    await waitForStartPage(page, config.ssoUrl);
    await page.evaluate(shim).catch(() => {});
    await saveCookies(context);

    await page
      .waitForSelector(selectors.accountsTable, { timeout: 30000 })
      .catch(() => console.warn("⚠ Accounts table never appeared — the census will show that"));
    await page.waitForTimeout(3000);

    const live: Record<string, number> = await page.evaluate(
      (sels) => {
        const out: Record<string, number> = {};
        for (const [name, sel] of Object.entries(sels)) {
          try {
            out[name] = document.querySelectorAll(sel as string).length;
          } catch {
            out[name] = -1;
          }
        }
        return out;
      },
      selectors as unknown as Record<string, string>
    );

    console.log(`\nComparing live page against fixture captured ${meta.capturedAt}\n`);
    console.log(`  ${"selector".padEnd(20)} ${"fixture".padStart(8)} ${"live".padStart(8)}`);
    console.log(`  ${"-".repeat(20)} ${"-".repeat(8)} ${"-".repeat(8)}`);

    const moved: string[] = [];
    const gone: string[] = [];

    for (const name of Object.keys(selectors)) {
      const was = expected[name];
      const now = live[name] ?? 0;
      // Presence is what matters, not exact counts: the live org may have a different number of
      // accounts than the fixture, and that is not drift.
      const wasPresent = (was ?? 0) > 0;
      const isPresent = now > 0;

      let mark = "";
      if (wasPresent && !isPresent) {
        mark = "  ❌ GONE";
        gone.push(name);
      } else if (!wasPresent && isPresent) {
        mark = "  ➕ now present";
        moved.push(name);
      }

      console.log(
        `  ${name.padEnd(20)} ${String(was ?? "-").padStart(8)} ${String(now).padStart(8)}${mark}`
      );
    }

    // The specific shape that broke pagination: a disabled control that carries no `disabled`
    // attribute. Worth reporting explicitly since a count-only census cannot see it.
    const nextButtonAttrs = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value]));
    }, selectors.nextPageButton);

    if (nextButtonAttrs) {
      console.log("\nNext-page button attributes (disabled-state detection depends on these):");
      for (const [k, v] of Object.entries(nextButtonAttrs)) {
        if (k === "class") {
          console.log(`  class = ${String(v).split(/\s+/).length} classes`);
        } else {
          console.log(`  ${k} = ${JSON.stringify(v)}`);
        }
      }
    }

    console.log("");
    if (gone.length === 0 && moved.length === 0) {
      console.log("✅ No drift — every selector still matches the live page.");
      return;
    }

    if (gone.length > 0) {
      console.error(`❌ ${gone.length} selector(s) no longer match: ${gone.join(", ")}`);
      console.error("   Update src/utils/aws-page/selectors.ts and re-capture the fixtures.");
    }
    if (moved.length > 0) {
      console.log(
        `ℹ ${moved.length} selector(s) present live but absent from the fixture: ${moved.join(", ")}`
      );
      console.log("   Usually just fixture staleness — re-capture to refresh.");
    }
    process.exitCode = gone.length > 0 ? 1 : 0;
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error("\n💥 Drift check failed:", err);
  process.exit(1);
});
