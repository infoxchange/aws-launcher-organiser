/**
 * Serve the captured AWS portal fixtures to a Playwright browser context.
 *
 * No local web server and no TLS certificate are needed: requests to the fixture host are
 * intercepted and fulfilled from disk. The host matters — it must match the content script's
 * `https://*.awsapps.com/start/` pattern, so the extension injects exactly as it does in
 * production.
 *
 * @see docs/testing.md § "Serving fixtures to a browser"
 */

import fs from "node:fs";
import path from "node:path";
import type { BrowserContext } from "playwright";

export const FIXTURE_HOST = "fixture.awsapps.com";
export const FIXTURE_URL = `https://${FIXTURE_HOST}/start/`;

const FIXTURE_DIR = path.join(process.cwd(), "tests", "fixtures", "aws-start-page");
const DOM_DIR = path.join(FIXTURE_DIR, "dom");

export interface FixtureMeta {
  capturedAt: string;
  pages: number;
  expectedAccountTotal: number;
  rowsPerPage: number[];
}

export function loadFixtureMeta(): FixtureMeta {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "meta.json"), "utf8"));
}

/** Warn when fixtures are old enough that AWS has probably moved on. */
export function warnIfFixturesStale(maxAgeDays = 90): void {
  const meta = loadFixtureMeta();
  const ageDays = Math.floor((Date.now() - Date.parse(meta.capturedAt)) / 86_400_000);
  if (ageDays > maxAgeDays) {
    console.warn(
      `⚠ Fixtures are ${ageDays} days old (captured ${meta.capturedAt}). ` +
        "Re-capture with: npm run fixture:capture && npm run fixture:sanitise"
    );
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/**
 * Route every request for the fixture host to a file on disk.
 *
 * `/start/` serves the requested page fragment with the behaviour simulator injected, so
 * pagination and role expansion work. Anything not on disk is aborted rather than reaching the
 * network, so a test can never accidentally hit real AWS.
 */
export async function serveFixture(
  context: BrowserContext,
  options: { page?: string } = {}
): Promise<void> {
  const entryPage = options.page ?? "table-page-1.html";
  const simulator = fs.readFileSync(path.join(FIXTURE_DIR, "simulator.js"), "utf8");

  await context.route(`https://${FIXTURE_HOST}/**`, async (route) => {
    const url = new URL(route.request().url());
    const name = path.posix.basename(url.pathname);

    // The start page itself: entry fixture + simulator.
    if (url.pathname === "/start/" || url.pathname === "/start" || name === "") {
      const html = fs.readFileSync(path.join(DOM_DIR, entryPage), "utf8");
      const withSimulator = html.replace("</body>", `<script>${simulator}</script></body>`);
      await route.fulfill({
        status: 200,
        contentType: CONTENT_TYPES[".html"],
        body: withSimulator,
      });
      return;
    }

    // Page fragments the simulator fetches for subsequent pages.
    const candidate = path.join(DOM_DIR, name);
    if (name && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      await route.fulfill({
        status: 200,
        contentType: CONTENT_TYPES[path.extname(name)] ?? "application/octet-stream",
        body: fs.readFileSync(candidate),
      });
      return;
    }

    // Never let a fixture test reach the real internet.
    await route.abort();
  });
}
