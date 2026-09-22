/**
 * Turn a raw capture in `.fixture-capture/` into committable fixtures in
 * `tests/fixtures/aws-start-page/`.
 *
 * Usage:
 *   npm run fixture:sanitise
 *
 * Sanitising is deterministic and consistent across files: the Nth distinct account ID always
 * maps to the same synthetic ID in every page, so cross-page references stay coherent.
 *
 * Two kinds of output:
 *   dom/page-N.html          full page, scripts stripped, values replaced
 *   dom/table-page-N.html    just the accounts table + pagination — what the unit tests parse
 *   meta.json                capture date, selector census, expected counts
 */

import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { probeSelectors } from "../src/utils/aws-page/parse";

const RAW_DIR = path.join(process.cwd(), ".fixture-capture");
const RAW_DOM = path.join(RAW_DIR, "dom");
const OUT_DIR = path.join(process.cwd(), "tests", "fixtures", "aws-start-page");
const OUT_DOM = path.join(OUT_DIR, "dom");

/** Stable real-value -> synthetic-value maps, shared across all files in one run. */
const accountIds = new Map<string, string>();
const accountNames = new Map<string, string>();
const emails = new Map<string, string>();
const roleNames = new Map<string, string>();

function mapAccountId(real: string): string {
  let v = accountIds.get(real);
  if (!v) {
    // Keep the 12-digit shape the extension validates against.
    v = String(100000000000 + accountIds.size * 1111).padStart(12, "0");
    accountIds.set(real, v);
  }
  return v;
}

function mapAccountName(real: string): string {
  let v = accountNames.get(real);
  if (!v) {
    // Synthetic names deliberately span the grouping patterns the extension matches on
    // (env suffixes, hyphenated prefixes) so fixtures exercise real grouping logic.
    const envs = ["prod", "uat", "dev", "test", "staging"];
    const i = accountNames.size;
    v = `team${String.fromCharCode(97 + (i % 26))}-svc${i}-${envs[i % envs.length]}`;
    accountNames.set(real, v);
  }
  return v;
}

function mapEmail(real: string): string {
  let v = emails.get(real);
  if (!v) {
    v = `aws-account-${emails.size + 1}@example.com`;
    emails.set(real, v);
  }
  return v;
}

function mapRoleName(real: string): string {
  let v = roleNames.get(real);
  if (!v) {
    const roles = ["AdministratorAccess", "ReadOnlyAccess", "PowerUserAccess", "BillingAccess"];
    v = roles[roleNames.size % roles.length];
    roleNames.set(real, v);
  }
  return v;
}

/** Text-level scrub applied to every remaining text node and to attribute values. */
function scrubText(text: string): string {
  return (
    text
      // 12-digit AWS account ids, wherever they appear
      .replace(/\b\d{12}\b/g, (m) => mapAccountId(m))
      // email addresses
      .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, (m) => mapEmail(m))
      // the real SSO host
      .replace(/\b[a-z0-9-]+\.awsapps\.com\b/gi, "fixture.awsapps.com")
      // JWT-ish and other long opaque tokens
      .replace(/\b[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}\b/g, "«REDACTED_TOKEN»")
      .replace(/\b[A-Za-z0-9+/]{120,}={0,2}\b/g, "«REDACTED_BLOB»")
  );
}

function sanitiseDocument(html: string): { document: Document; window: Window } {
  const window = new Window({ url: "https://fixture.awsapps.com/start/" });
  const document = window.document as unknown as Document;
  document.write(html);

  // 1. Remove all scripts. They are the main leak vector (bootstrap state often embeds the
  //    tenant and account list) and Mode B fixtures do not want AWS's JS running anyway —
  //    the simulator supplies the behaviour instead.
  for (const el of Array.from(document.querySelectorAll("script"))) el.remove();

  // 2. External stylesheets and preloads would try to reach AWS at test time.
  for (const el of Array.from(
    document.querySelectorAll('link[rel="stylesheet"], link[rel="preload"], link[rel="preconnect"]')
  ))
    el.remove();

  // 3. Account names live in the name cell.
  for (const cell of Array.from(document.querySelectorAll('[data-testid="account-list-cell"]'))) {
    const leaf = cell.querySelector("div:not(:has(div))") ?? cell;
    const current = (leaf.textContent ?? "").trim();
    if (current) leaf.textContent = mapAccountName(current);
  }

  // 4. Role names live in the expanded role row's federation link.
  for (const link of Array.from(document.querySelectorAll('[data-testid="federation-link"]'))) {
    const current = (link.textContent ?? "").trim();
    if (current) link.textContent = mapRoleName(current);
  }

  // 5. Scrub every remaining text node and attribute value by pattern.
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const t = node.textContent ?? "";
      if (t.trim()) node.textContent = scrubText(t);
      return;
    }
    if (node.nodeType === 1) {
      const el = node as Element;
      for (const attr of Array.from(el.attributes)) {
        const scrubbed = scrubText(attr.value);
        if (scrubbed !== attr.value) el.setAttribute(attr.name, scrubbed);
      }
      // hrefs can encode account/role in query or path
      const href = el.getAttribute?.("href");
      if (href && /^https?:/i.test(href)) {
        el.setAttribute("href", "https://fixture.awsapps.com/start/#/saml/custom/placeholder");
      }
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(document.documentElement);

  return { document, window };
}

function extractTableFragment(document: Document): string {
  const table = document.querySelector('table[role="treegrid"]');
  const pagination =
    document.querySelector('[data-testid="pagination-bar"]') ??
    document.querySelector('button[aria-label="Next page"]')?.closest("ul") ??
    null;

  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><title>AWS access portal fixture</title></head>',
    "<body>",
    '<div role="tabpanel">',
    table?.outerHTML ?? "<!-- NO TABLE IN CAPTURE -->",
    pagination?.outerHTML ?? "<!-- NO PAGINATION IN CAPTURE -->",
    "</div>",
    "</body></html>",
  ].join("\n");
}

function main() {
  if (!fs.existsSync(RAW_DOM)) {
    throw new Error(
      `\n❌ No raw capture found at ${RAW_DOM}\n\nRun this first:\n  npm run fixture:capture\n`
    );
  }

  fs.mkdirSync(OUT_DOM, { recursive: true });

  const files = fs
    .readdirSync(RAW_DOM)
    .filter((f) => f.endsWith(".html"))
    .sort();

  const pages: { name: string; rows: number; bytes: number; fragmentBytes: number }[] = [];
  /** Per-fixture selector counts, so the live drift check has something to diff against. */
  const census: Record<string, Record<string, number>> = {};

  for (const file of files) {
    const raw = fs.readFileSync(path.join(RAW_DOM, file), "utf8");
    const { document, window } = sanitiseDocument(raw);

    const rows = document.querySelectorAll(
      'table[role="treegrid"] tr[data-selection-item="item"]'
    ).length;

    const full = `<!doctype html>\n${document.documentElement.outerHTML}`;
    fs.writeFileSync(path.join(OUT_DOM, file), full);

    const fragment = extractTableFragment(document);
    fs.writeFileSync(path.join(OUT_DOM, `table-${file}`), fragment);

    census[file] = probeSelectors(document);
    pages.push({ name: file, rows, bytes: full.length, fragmentBytes: fragment.length });
    console.log(
      `  ${file.padEnd(22)} rows=${String(rows).padStart(3)}  ` +
        `full=${(full.length / 1024).toFixed(0)}KB  table-only=${(fragment.length / 1024).toFixed(1)}KB`
    );

    window.close();
  }

  const pagePages = pages.filter((p) => /^page-\d+\.html$/.test(p.name));
  const meta = {
    capturedAt: new Date().toISOString().slice(0, 10),
    note: "Regenerate with: npm run fixture:capture && npm run fixture:sanitise",
    pages: pagePages.length,
    expectedAccountTotal: pagePages.reduce((n, p) => n + p.rows, 0),
    rowsPerPage: pagePages.map((p) => p.rows),
    distinctAccountIds: accountIds.size,
    distinctAccountNames: accountNames.size,
    distinctRoleNames: roleNames.size,
    files: pages.map((p) => p.name),
    selectorCensus: census,
  };
  fs.writeFileSync(path.join(OUT_DIR, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);

  console.log(`\n✅ Sanitised fixtures written to ${OUT_DIR}`);
  console.log(`   pages: ${meta.pages}, expected account total: ${meta.expectedAccountTotal}`);
  console.log(`\nNow run:  npm run fixture:verify-clean`);
}

main();
