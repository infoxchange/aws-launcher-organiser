/**
 * Capture a fixture of the live AWS SSO start page.
 *
 * Usage:
 *   npm run fixture:capture
 *
 * Requires `npm run test:integration:setup` to have been run once (for the SSO URL).
 *
 * The extension is deliberately NOT loaded — we want AWS's own DOM, not our injected UI.
 *
 * Outputs, all into `.fixture-capture/` (gitignored, never committed):
 *   dom/page-N.html        raw rendered DOM per pagination page
 *   dom/roles-expanded.html raw DOM with the first account's roles expanded
 *   structure-report.txt   VALUE-FREE structural report, safe to share
 *
 * Sanitising into `tests/fixtures/` is a separate, later step: the sanitiser has to be
 * written against the real structure, and the structure report is what tells us what that is.
 */

import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { navigateToUrl } from "../tests/support/test-browser";
import { loadConfig } from "../tests/support/test-config";
import { loadCookies, saveCookies } from "../tests/support/test-cookies";

const OUT_DIR = path.join(process.cwd(), ".fixture-capture");
const DOM_DIR = path.join(OUT_DIR, "dom");
const MAX_PAGES = 100;

/**
 * Selectors the extension depends on. Kept as a flat named list so the same census can later
 * drive the drift check (`fixture:check`).
 */
const SELECTOR_CENSUS: Record<string, string> = {
  mountPoint: '[role="tabpanel"]',
  accountsTable: 'table[role="treegrid"]',
  accountRow: 'table[role="treegrid"] tr[data-selection-item="item"]',
  accountNameCell: '[data-testid="account-list-cell"]',
  rowExpandButton: 'table[role="treegrid"] tr[data-selection-item="item"] button[aria-expanded]',
  paginationBar: '[data-testid="pagination-bar"]',
  nextPageButton: 'button[aria-label="Next page"]',
  prevPageButton: 'button[aria-label="Previous page"]',
  currentPageButton: 'button[aria-label^="Page"][aria-current="true"]',
  anyPageButton: 'button[aria-label^="Page"]',
  federationLink: 'a[data-testid="federation-link"]',
  accessKeysButton: '[data-testid="role-creation-action-button"]',
  errorAlert: '[data-testid="error-component-alert"]',
  retryButton: '[data-testid="retry-button"]',
  hashedErrorContent: ".awsui_content_mx3cw_1ehno_391",
};

/**
 * tsx/esbuild compiles this file with `keepNames`, which rewrites named inner functions as
 * `__name(fn, "fn")`. That helper exists in Node but not in the browser, so any page.evaluate()
 * callback containing a named inner function dies with "__name is not defined".
 * Defining a no-op shim in the page is simpler and more robust than banning named functions
 * from every evaluate callback. Passed as a raw string so it is not itself transpiled.
 */
const NAME_SHIM = "globalThis.__name = globalThis.__name || ((fn) => fn);";

async function installNameShim(page: Page): Promise<void> {
  // For all future navigations...
  await page.addInitScript(NAME_SHIM);
  // ...and for the document already loaded.
  await page.evaluate(NAME_SHIM).catch(() => {});
}

/**
 * Wait until the browser has actually landed back on the SSO start page.
 *
 * We cannot just wait for login indicators to disappear: during a SAML redirect chain there are
 * moments with no password field on the page, which makes "login looks done" fire early. Instead
 * require the URL to match the configured start page AND to stay there for several consecutive
 * checks, so an in-flight redirect does not count as arrival.
 */
async function waitForStartPage(page: Page, ssoUrl: string, timeoutMs = 600_000): Promise<void> {
  const target = new URL(ssoUrl);
  const targetPath = target.pathname.replace(/\/$/, "");
  const deadline = Date.now() + timeoutMs;
  const requiredStableChecks = 3;

  let stable = 0;
  let lastReported = "";

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

    const stillAuthenticating = await page
      .$('input[type="password"]')
      .then((el) => !!el)
      .catch(() => false);

    if (onStartPage && !stillAuthenticating) {
      stable++;
      if (stable >= requiredStableChecks) {
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        console.log(`✓ Landed on ${page.url()}`);
        return;
      }
    } else {
      if (current && current.href !== lastReported) {
        console.log(`   …currently at ${current.host}${current.pathname}`);
        lastReported = current.href;
      }
      stable = 0;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(
    `Timed out after ${Math.round(timeoutMs / 1000)}s waiting to land on ${ssoUrl}. ` +
      `Last URL: ${page.url()}`
  );
}

/**
 * Wait for the accounts UI to render. Deliberately does NOT depend on the extension's row
 * selector, which may be exactly what is broken — any table or tab panel means the app painted.
 */
async function waitForAppUi(page: Page): Promise<void> {
  const candidates = ['table[role="treegrid"]', "table", '[role="tabpanel"]', "main"];
  for (const selector of candidates) {
    try {
      await page.waitForSelector(selector, { timeout: 20000 });
      console.log(`✓ App UI present (matched ${selector})`);
      // Let the account list finish populating after first paint.
      await page.waitForTimeout(5000);
      return;
    } catch {
      // try the next, more generic, candidate
    }
  }
  console.warn("⚠ None of the expected containers appeared — capturing whatever is on the page");
}

async function main() {
  const config = loadConfig();
  if (!config?.ssoUrl) {
    throw new Error(
      "\n❌ No SSO URL configured.\n\nRun this first:\n  npm run test:integration:setup\n"
    );
  }

  fs.mkdirSync(DOM_DIR, { recursive: true });

  console.log("🔧 Launching browser (no extension loaded — capturing AWS's own DOM)...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  try {
    await loadCookies(context);
    const page = await context.newPage();
    await installNameShim(page);

    console.log(`🌐 Navigating to ${config.ssoUrl}...`);
    await navigateToUrl(page, config.ssoUrl);

    console.log(
      "\n🔐 If a login page appears, log in in the browser window." +
        "\n   Waiting until the browser returns to the start page (up to 10 minutes)...\n"
    );
    await waitForStartPage(page, config.ssoUrl);
    await installNameShim(page);
    await saveCookies(context);

    console.log("⏳ Waiting for the accounts UI...");
    await waitForAppUi(page);

    const rowsMatched = await page.$$(SELECTOR_CENSUS.accountRow).then((els) => els.length);
    if (rowsMatched > 0) {
      console.log(`✓ ${rowsMatched} account rows matched the extension's current row selector`);
    } else {
      console.warn(
        "⚠ No rows matched the extension's row selector — the report below will show why"
      );
    }

    const report: string[] = [];
    const log = (line = "") => {
      report.push(line);
      console.log(line);
    };

    log("=== AWS start page structure report ===");
    log(`captured: ${new Date().toISOString()}`);
    log("(auto-redacted: no account names, IDs, emails or tokens — skim before sharing)");
    log(`landed on path: ${new URL(page.url()).pathname}`);
    log(
      `rows matching the extension's row selector: ${rowsMatched}` +
        (rowsMatched === 0 ? "  ❌ this alone would mean zero accounts extracted" : "")
    );
    log();

    // --- Walk pagination, snapshotting each page -------------------------------------------
    const pageStats: { page: number; rows: number; nextBtn: string }[] = [];
    let pageNumber = 1;

    while (pageNumber <= MAX_PAGES) {
      const html = await page.content();
      fs.writeFileSync(path.join(DOM_DIR, `page-${pageNumber}.html`), html);

      const stats = await page.evaluate((sel) => {
        const btn = document.querySelector(sel.nextPageButton);
        const describeBtn = (el: Element | null) =>
          el
            ? Array.from(el.attributes)
                .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
                .join(" ")
            : "ABSENT";
        return {
          rows: document.querySelectorAll(sel.accountRow).length,
          nextBtn: describeBtn(btn),
        };
      }, SELECTOR_CENSUS);

      pageStats.push({ page: pageNumber, ...stats });
      log(`page ${pageNumber}: ${stats.rows} rows | next button: ${stats.nextBtn}`);

      // Replicates the extension's own hasNextPage() logic so the report shows whether it
      // would over- or under-run the real page count.
      const extensionThinksMorePages = await page.evaluate(() => {
        const b = document.querySelector('button[aria-label="Next page"]:not([disabled])');
        return !!b && !b.hasAttribute("disabled");
      });

      const trulyClickable = await page.evaluate((sel) => {
        const b = document.querySelector<HTMLButtonElement>(sel.nextPageButton);
        if (!b) return false;
        return (
          !b.disabled &&
          b.getAttribute("aria-disabled") !== "true" &&
          !b.hasAttribute("disabled") &&
          getComputedStyle(b).pointerEvents !== "none"
        );
      }, SELECTOR_CENSUS);

      if (extensionThinksMorePages !== trulyClickable) {
        log(
          `  ⚠ MISMATCH on page ${pageNumber}: extension hasNextPage()=${extensionThinksMorePages} ` +
            `but button actually clickable=${trulyClickable}`
        );
      }

      if (!trulyClickable) {
        log(`  → last page reached at page ${pageNumber}`);
        break;
      }

      const firstRowBefore = await page
        .$eval(SELECTOR_CENSUS.accountRow, (el) => el.textContent ?? "")
        .catch(() => "");
      await page.click(SELECTOR_CENSUS.nextPageButton);
      await page
        .waitForFunction(
          ({ sel, before }) => {
            const el = document.querySelector(sel);
            return el && (el.textContent ?? "") !== before;
          },
          { sel: SELECTOR_CENSUS.accountRow, before: firstRowBefore },
          { timeout: 10000 }
        )
        .catch(() => log(`  ⚠ page ${pageNumber + 1} content did not change within 10s`));
      pageNumber++;
    }

    log();
    log(`total pagination pages walked: ${pageStats.length}`);
    log(`total rows summed across pages: ${pageStats.reduce((n, p) => n + p.rows, 0)}`);
    log();

    // --- Selector census -------------------------------------------------------------------
    log("--- selector census (on the last page) ---");
    const census = await page.evaluate((sels) => {
      const out: Record<string, number> = {};
      for (const [name, sel] of Object.entries(sels)) {
        try {
          out[name] = document.querySelectorAll(sel).length;
        } catch {
          out[name] = -1;
        }
      }
      return out;
    }, SELECTOR_CENSUS);
    for (const [name, count] of Object.entries(census)) {
      const mark = count === 0 ? " ❌ NO MATCH" : "";
      log(`  ${name.padEnd(20)} ${String(count).padStart(4)}  ${SELECTOR_CENSUS[name]}${mark}`);
    }
    log();

    // --- Value-free DOM skeleton of the accounts table -------------------------------------
    log("--- accounts table skeleton (text and values classified, not shown) ---");
    const skeleton = await page.evaluate(() => {
      // Attributes whose values are structural markup, never tenant data.
      const SAFE_ATTRS = new Set([
        "role",
        "type",
        "scope",
        "tabindex",
        "focusable",
        "target",
        "rel",
        "viewBox",
        "xmlns",
        "aria-expanded",
        "aria-current",
        "aria-disabled",
        "aria-hidden",
        "aria-level",
        "aria-setsize",
        "aria-posinset",
        "aria-colindex",
        "aria-rowindex",
        "aria-colcount",
        "aria-rowcount",
        "aria-sort",
        "data-selection-item",
        "data-testid",
        "data-focus-id",
        "data-rightmost",
        "data-column-index",
        "data-awsui-motion-trigger",
      ]);
      // aria-label is structural for controls but can carry an account name, so only these
      // known-safe shapes are printed verbatim.
      const SAFE_LABELS = [/^Next page$/, /^Previous page$/, /^Page \d+$/, /^Sort by\b/i];

      // Text content is NEVER printed verbatim: account names are short and digit-free, so no
      // length/shape heuristic can separate them from labels like "Next page".
      const classify = (s: string | null | undefined): string => {
        const t = (s ?? "").trim();
        if (!t) return "";
        if (/^\d{12}$/.test(t)) return "«ACCOUNT_ID»";
        if (/^[^\s@]+@[^\s@]+$/.test(t)) return "«EMAIL»";
        if (/^\d+$/.test(t)) return `«NUM:${t.length}»`;
        return `«TEXT:${t.length}»`;
      };

      const classifyAttr = (name: string, value: string): string => {
        if (SAFE_ATTRS.has(name)) return JSON.stringify(value);
        if (name === "aria-label") {
          return SAFE_LABELS.some((re) => re.test(value)) ? JSON.stringify(value) : "«LABEL»";
        }
        return classify(value) || '""';
      };

      const render = (el: Element, depth: number, maxDepth: number): string[] => {
        if (depth > maxDepth) return [];
        const attrs = Array.from(el.attributes)
          .filter((a) => !["style"].includes(a.name))
          .map((a) => {
            if (a.name === "class") {
              const n = a.value.split(/\s+/).filter(Boolean).length;
              return `class=«${n} classes»`;
            }
            return `${a.name}=${classifyAttr(a.name, a.value)}`;
          })
          .join(" ");

        const ownText = Array.from(el.childNodes)
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent ?? "")
          .join("")
          .trim();

        const indent = "  ".repeat(depth);
        const lines = [
          `${indent}<${el.tagName.toLowerCase()}${attrs ? ` ${attrs}` : ""}>${
            ownText ? ` ${classify(ownText)}` : ""
          }`,
        ];
        for (const child of Array.from(el.children)) {
          lines.push(...render(child, depth + 1, maxDepth));
        }
        return lines;
      };

      const out: string[] = [];
      const table =
        document.querySelector('table[role="treegrid"]') ?? document.querySelector("table");
      if (!table) {
        out.push("NO <table> FOUND ON PAGE");
        const panel = document.querySelector('[role="tabpanel"]');
        if (panel) {
          out.push("tabpanel subtree (depth 4):");
          out.push(...render(panel, 0, 4));
        }
        return out.join("\n");
      }

      out.push(`table tagName=${table.tagName} role=${table.getAttribute("role")}`);
      const head = table.querySelector("thead tr");
      if (head) {
        out.push("HEADER ROW:");
        out.push(...render(head, 0, 3));
      }
      const rows = table.querySelectorAll("tbody tr");
      out.push(`tbody rows: ${rows.length}`);
      if (rows[0]) {
        out.push("FIRST BODY ROW (depth 5):");
        out.push(...render(rows[0], 0, 5));
      }
      if (rows[1]) {
        out.push("SECOND BODY ROW (depth 2):");
        out.push(...render(rows[1], 0, 2));
      }
      return out.join("\n");
    });
    log(skeleton);
    log();

    // --- Pagination bar skeleton -----------------------------------------------------------
    log("--- pagination controls skeleton ---");
    const pagination = await page.evaluate(() => {
      const candidates = [
        '[data-testid="pagination-bar"]',
        "nav[aria-label*='agination']",
        "ul[class*='pagination']",
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) {
          return `matched ${sel}\n${el.outerHTML.replace(/>[^<>]{25,}</g, ">«TEXT»<").slice(0, 2500)}`;
        }
      }
      const btn = document.querySelector('button[aria-label="Next page"]');
      if (btn?.parentElement?.parentElement) {
        return `no known pagination container; ancestor of Next button:\n${btn.parentElement.parentElement.outerHTML
          .replace(/>[^<>]{25,}</g, ">«TEXT»<")
          .slice(0, 2500)}`;
      }
      return "NO PAGINATION CONTROLS FOUND";
    });
    log(pagination);
    log();

    // --- Expand the first account's roles --------------------------------------------------
    log("--- role expansion ---");
    const expandBtn = await page.$(SELECTOR_CENSUS.rowExpandButton);
    if (!expandBtn) {
      log("❌ no row expand button matched — this is likely the roles breakage");
    } else {
      await expandBtn.click();
      await page.waitForTimeout(4000);
      fs.writeFileSync(path.join(DOM_DIR, "roles-expanded.html"), await page.content());
      const roleInfo = await page.evaluate((sel) => {
        const links = document.querySelectorAll(sel.federationLink);
        const err = document.querySelector(sel.errorAlert);
        const expandedRow = document.querySelector(
          'table[role="treegrid"] tr[data-selection-item="item"]'
        )?.nextElementSibling;
        const redact = (h: string) => h.replace(/>[^<>]{25,}</g, ">«TEXT»<").slice(0, 3000);
        return {
          federationLinks: links.length,
          errorAlertPresent: !!err,
          expandedRowHtml: expandedRow ? redact(expandedRow.outerHTML) : "NO SIBLING ROW",
        };
      }, SELECTOR_CENSUS);
      log(`federation links found: ${roleInfo.federationLinks}`);
      log(`error alert present: ${roleInfo.errorAlertPresent}`);
      log("expanded row skeleton:");
      log(roleInfo.expandedRowHtml);
    }

    fs.writeFileSync(path.join(OUT_DIR, "structure-report.txt"), report.join("\n"));
    console.log(`\n✅ Done.`);
    console.log(`   Raw DOM snapshots : ${DOM_DIR}  (gitignored — contains real account data)`);
    console.log(`   Structure report  : ${path.join(OUT_DIR, "structure-report.txt")}  (redacted)`);
    console.log(`\nShare the structure report to drive the next step.`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error("\n💥 Capture failed:", err);
  process.exit(1);
});
