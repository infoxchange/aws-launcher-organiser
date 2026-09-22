/**
 * Unit tests for the AWS page adapter, run against sanitised fixtures captured from the real
 * access portal (see docs/testing.md § "Fixtures").
 *
 * These are the fast guard against AWS changing its markup: they need no browser, no login and
 * no network, and when one fails it names the exact selector or field that moved.
 *
 * Regenerate fixtures with:  npm run fixture:capture && npm run fixture:sanitise
 */

import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decideNavigationStep,
  extractAccountsFromPage,
  findAccountRowById,
  getAccountRows,
  getAccountsTable,
  getCurrentPageNumber,
  getErrorAlert,
  getErrorMessage,
  getNextPageButton,
  getPageCount,
  getPrevPageButton,
  getRetryButton,
  getRoleRowFor,
  getRowExpandButton,
  hasNextPage,
  hasPaginationControls,
  hasPrevPage,
  isAccountRow,
  isControlDisabled,
  isRoleRow,
  isRowExpanded,
  parseAccountRow,
  parseRoles,
  probeSelectors,
} from "./parse";

const FIXTURE_DIR = path.join(process.cwd(), "tests", "fixtures", "aws-start-page");
const DOM_DIR = path.join(FIXTURE_DIR, "dom");

function loadFixture(name: string): Document {
  const html = fs.readFileSync(path.join(DOM_DIR, name), "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

interface FixtureMeta {
  pages: number;
  expectedAccountTotal: number;
  rowsPerPage: number[];
}

let meta: FixtureMeta;

beforeAll(() => {
  meta = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "meta.json"), "utf8"));
});

describe("page adapter against captured AWS markup", () => {
  describe("table and rows", () => {
    it("finds the accounts table", () => {
      expect(getAccountsTable(loadFixture("table-page-1.html"))).not.toBeNull();
    });

    it("finds every account row on a full page", () => {
      const rows = getAccountRows(loadFixture("table-page-1.html"));
      expect(rows).toHaveLength(100);
    });

    it("finds the account rows on the short final page", () => {
      const rows = getAccountRows(loadFixture("table-page-4.html"));
      expect(rows).toHaveLength(meta.rowsPerPage[meta.rowsPerPage.length - 1]);
    });

    it("parses id, name and email from a row", () => {
      const rows = getAccountRows(loadFixture("table-page-4.html"));
      const account = parseAccountRow(rows[0], 4);

      expect(account).not.toBeNull();
      expect(account?.id).toMatch(/^\d{12}$/);
      expect(account?.name).toBeTruthy();
      expect(account?.email).toContain("@");
      expect(account?.pageNumber).toBe(4);
    });

    it("extracts all accounts on a page with ids, names and emails", () => {
      const accounts = extractAccountsFromPage(loadFixture("table-page-1.html"), 1);
      expect(accounts).toHaveLength(100);
      for (const account of accounts) {
        expect(account.id).toMatch(/^\d{12}$/);
        expect(account.name.length).toBeGreaterThan(0);
        expect(account.email).toContain("@");
      }
    });

    it("yields unique account ids within a page", () => {
      const accounts = extractAccountsFromPage(loadFixture("table-page-2.html"), 2);
      expect(new Set(accounts.map((a) => a.id)).size).toBe(accounts.length);
    });

    it("locates a row by account id", () => {
      const doc = loadFixture("table-page-4.html");
      const accounts = extractAccountsFromPage(doc, 4);
      const target = accounts[2];

      const row = findAccountRowById(doc, target.id);
      expect(row).not.toBeNull();
      expect(parseAccountRow(row as Element, 4)?.name).toBe(target.name);
    });

    it("returns null for an id that is not present", () => {
      expect(findAccountRowById(loadFixture("table-page-4.html"), "999999999999")).toBeNull();
    });
  });

  /** @see docs/aws-page-integration.md § "Expanded role rows masquerade as account rows" */
  describe("role rows are not mistaken for accounts", () => {
    it("excludes the expanded role row from account rows", () => {
      const doc = loadFixture("table-roles-expanded.html");
      const allItemRows = doc.querySelectorAll('tr[data-selection-item="item"]');
      const accountRows = getAccountRows(doc);

      expect(allItemRows.length).toBe(8);
      expect(accountRows).toHaveLength(7);
    });

    it("classifies account rows and role rows correctly", () => {
      const doc = loadFixture("table-roles-expanded.html");
      const rows = Array.from(doc.querySelectorAll('tr[data-selection-item="item"]'));

      expect(isAccountRow(rows[0])).toBe(true);
      expect(isRoleRow(rows[0])).toBe(false);
      expect(isAccountRow(rows[1])).toBe(false);
      expect(isRoleRow(rows[1])).toBe(true);
    });

    it("does not inflate the account count when a row is expanded", () => {
      const accounts = extractAccountsFromPage(loadFixture("table-roles-expanded.html"), 4);
      expect(accounts).toHaveLength(7);
    });
  });

  describe("roles", () => {
    it("finds the expand button and reads its state", () => {
      const collapsed = getAccountRows(loadFixture("table-page-4.html"))[0];
      expect(getRowExpandButton(collapsed)).not.toBeNull();
      expect(isRowExpanded(collapsed)).toBe(false);

      const expanded = getAccountRows(loadFixture("table-roles-expanded.html"))[0];
      expect(isRowExpanded(expanded)).toBe(true);
    });

    it("finds the role row belonging to the expanded account", () => {
      const expandedRow = getAccountRows(loadFixture("table-roles-expanded.html"))[0];
      expect(getRoleRowFor(expandedRow)).not.toBeNull();
    });

    it("returns no role row for a collapsed account", () => {
      const collapsedRow = getAccountRows(loadFixture("table-page-4.html"))[0];
      expect(getRoleRowFor(collapsedRow)).toBeNull();
    });

    it("parses roles with a name and a console url", () => {
      const expandedRow = getAccountRows(loadFixture("table-roles-expanded.html"))[0];
      const roleRow = getRoleRowFor(expandedRow);
      const roles = parseRoles(roleRow as ParentNode);

      expect(roles.length).toBeGreaterThan(0);
      for (const role of roles) {
        expect(role.name.length).toBeGreaterThan(0);
        expect(role.consoleUrl).toMatch(/^https?:\/\//);
      }
    });

    it("reports no error message when roles loaded fine", () => {
      const expandedRow = getAccountRows(loadFixture("table-roles-expanded.html"))[0];
      expect(getErrorMessage(getRoleRowFor(expandedRow) as ParentNode)).toBeNull();
    });
  });

  /** @see docs/aws-page-integration.md § "Pagination controls are not disabled with `disabled`" */
  describe("pagination", () => {
    it("treats the Next button as enabled on a non-final page", () => {
      const doc = loadFixture("table-page-1.html");
      expect(hasNextPage(doc)).toBe(true);
      expect(isControlDisabled(getNextPageButton(doc))).toBe(false);
    });

    it("treats the Next button as disabled on the final page", () => {
      const doc = loadFixture("table-page-4.html");
      expect(hasNextPage(doc)).toBe(false);
      expect(isControlDisabled(getNextPageButton(doc))).toBe(true);
    });

    it("recognises the final-page Next button despite it having no disabled attribute", () => {
      const button = getNextPageButton(loadFixture("table-page-4.html"));
      // Documents exactly why the old check failed, so a future reader sees the shape of it.
      expect(button?.hasAttribute("disabled")).toBe(false);
      expect(button?.getAttribute("aria-disabled")).toBe("true");
      expect(isControlDisabled(button)).toBe(true);
    });

    it("reports Previous as available once past the first page", () => {
      expect(hasPrevPage(loadFixture("table-page-4.html"))).toBe(true);
      expect(getPrevPageButton(loadFixture("table-page-4.html"))).not.toBeNull();
    });

    it("reads the current page number", () => {
      expect(getCurrentPageNumber(loadFixture("table-page-4.html"))).toBe(4);
    });

    /**
     * Regression: this used to default to 1 when no active page button was found. The controls
     * vanish briefly while the portal re-renders, so a caller on the last page was told it was
     * on page 1, tried to move forward, hit the disabled Next button and gave up — silently
     * leaving the portal on the wrong page and failing to find the account row it wanted.
     */
    it("returns null rather than guessing when pagination is not rendered", () => {
      const noPagination = new DOMParser().parseFromString(
        '<table role="treegrid"><tbody></tbody></table>',
        "text/html"
      );
      expect(getCurrentPageNumber(noPagination)).toBeNull();
    });

    it("reads the total page count", () => {
      expect(getPageCount(loadFixture("table-page-1.html"))).toBe(meta.pages);
    });
  });

  /** @see docs/aws-page-integration.md § "All selectors live in one module" - a breakage names itself */
  /**
   * Regression: the portal renders its rows and its pagination controls progressively. Before
   * pagination exists, `getNextPageButton()` is null and `hasNextPage()` is false — which is
   * indistinguishable from being on the last page unless callers check for the controls first.
   * Extraction saw this on the live portal and stopped after page one with a truncated list.
   */
  describe("telling 'not rendered yet' apart from 'last page'", () => {
    const withoutPagination = () =>
      new DOMParser().parseFromString(
        '<table role="treegrid"><tbody><tr data-selection-item="item" aria-level="1">' +
          '<th><div data-testid="account-list-cell">a</div></th><td>100000000000</td>' +
          "<td>a@example.com</td></tr></tbody></table>",
        "text/html"
      );

    it("reports no pagination controls when they have not rendered", () => {
      expect(hasPaginationControls(withoutPagination())).toBe(false);
    });

    it("reports pagination controls once they exist", () => {
      expect(hasPaginationControls(loadFixture("table-page-1.html"))).toBe(true);
      expect(hasPaginationControls(loadFixture("table-page-4.html"))).toBe(true);
    });

    it("still finds account rows while pagination is missing", () => {
      // The rows arriving before the controls is exactly the window extraction used to race.
      expect(getAccountRows(withoutPagination())).toHaveLength(1);
    });
  });

  /**
   * Regression: role parsing must be scoped to the account's own role row.
   *
   * When several accounts are expanded, every one of their roles is present in the document. The
   * old code looked up the role row once, shortly after clicking expand, and fell back to
   * scanning the whole document when it had not appeared yet — attributing every role on the
   * page to that one account. On the live portal that showed up as accounts sprouting roles
   * belonging to other accounts.
   */
  describe("roles are scoped to their own account", () => {
    const twoExpandedAccounts = () =>
      new DOMParser().parseFromString(
        `<table role="treegrid"><tbody>
          <tr data-selection-item="item" aria-level="1">
            <th><div data-testid="account-list-cell">first</div></th>
            <td>100000000000</td><td>a@example.com</td>
          </tr>
          <tr data-selection-item="item" aria-level="2">
            <th><a data-testid="federation-link" href="https://example.com/1">RoleOne</a></th>
            <td></td><td></td>
          </tr>
          <tr data-selection-item="item" aria-level="1">
            <th><div data-testid="account-list-cell">second</div></th>
            <td>100000001111</td><td>b@example.com</td>
          </tr>
          <tr data-selection-item="item" aria-level="2">
            <th>
              <a data-testid="federation-link" href="https://example.com/2">RoleTwo</a>
              <a data-testid="federation-link" href="https://example.com/3">RoleThree</a>
            </th>
            <td></td><td></td>
          </tr>
        </tbody></table>`,
        "text/html"
      );

    it("gives each account only the roles from its own role row", () => {
      const doc = twoExpandedAccounts();
      const [first, second] = getAccountRows(doc);

      expect(parseRoles(getRoleRowFor(first) as ParentNode).map((r) => r.name)).toEqual([
        "RoleOne",
      ]);
      expect(parseRoles(getRoleRowFor(second) as ParentNode).map((r) => r.name)).toEqual([
        "RoleTwo",
        "RoleThree",
      ]);
    });

    it("would over-report if scoped to the whole document", () => {
      // Pins why the scoping matters: document-wide parsing sees every account's roles.
      const doc = twoExpandedAccounts();
      expect(parseRoles(doc)).toHaveLength(3);
    });

    it("counts only the account rows, not the expanded role rows", () => {
      expect(getAccountRows(twoExpandedAccounts())).toHaveLength(2);
    });
  });

  describe("selector census", () => {
    it("matches every load-bearing selector on a real page", () => {
      const census = probeSelectors(loadFixture("table-page-4.html"));

      expect(census.accountsTable).toBe(1);
      expect(census.anyItemRow).toBe(7);
      expect(census.accountNameCell).toBe(7);
      expect(census.nextPageButton).toBe(1);
      expect(census.prevPageButton).toBe(1);
      expect(census.currentPageButton).toBe(1);
      expect(census.anyPageButton).toBe(meta.pages);
    });

    it("finds the role selectors once a row is expanded", () => {
      const census = probeSelectors(loadFixture("table-roles-expanded.html"));
      expect(census.federationLink).toBeGreaterThan(0);
      expect(census.accessKeysButton).toBeGreaterThan(0);
    });
  });

  /**
   * Built on a hand-authored fixture, not a capture — see the notice at the top of
   * table-roles-error.html. These cover our error-handling control flow, not AWS's markup.
   */
  describe("role loading errors", () => {
    it("detects the error alert on the role row", () => {
      const row = getAccountRows(loadFixture("table-roles-error.html"))[0];
      const roleRow = getRoleRowFor(row);
      expect(roleRow).not.toBeNull();
      expect(getErrorAlert(roleRow as ParentNode)).not.toBeNull();
    });

    it("reads the error message without depending on a hashed class", () => {
      const row = getAccountRows(loadFixture("table-roles-error.html"))[0];
      const message = getErrorMessage(getRoleRowFor(row) as ParentNode);
      // The old implementation selected .awsui_content_mx3cw_1ehno_391, a build-hashed class.
      expect(message).toContain("HTTP 429");
    });

    it("finds the retry button so the retry loop can click it", () => {
      const row = getAccountRows(loadFixture("table-roles-error.html"))[0];
      expect(getRetryButton(getRoleRowFor(row) as ParentNode)).not.toBeNull();
    });

    it("reports no roles when the row is showing an error", () => {
      const row = getAccountRows(loadFixture("table-roles-error.html"))[0];
      expect(parseRoles(getRoleRowFor(row) as ParentNode)).toHaveLength(0);
    });

    it("still reads the account itself while its roles failed to load", () => {
      const accounts = extractAccountsFromPage(loadFixture("table-roles-error.html"), 1);
      expect(accounts).toHaveLength(1);
      expect(accounts[0].id).toMatch(/^\d{12}$/);
    });
  });

  describe("whole-fixture totals", () => {
    it("extracts exactly the captured number of accounts across all pages", () => {
      const all = meta.rowsPerPage.flatMap((_, i) =>
        extractAccountsFromPage(loadFixture(`table-page-${i + 1}.html`), i + 1)
      );

      expect(all).toHaveLength(meta.expectedAccountTotal);
      // Every account distinct — the inflated-count bug would break this.
      expect(new Set(all.map((a) => a.id)).size).toBe(meta.expectedAccountTotal);
    });
  });
});

/**
 * The navigation decision that caused "Account row not found for id: …".
 *
 * These are deterministic where the browser test is not: reproducing the real failure needs a
 * read to land inside the few hundred milliseconds where the portal has removed its pagination
 * controls, which no amount of scrolling makes reliable. The decision itself is pure, so it can
 * be pinned exactly.
 *
 * @see docs/aws-page-integration.md § "The pagination controls vanish on every page change, not just at load"
 */
describe("decideNavigationStep", () => {
  it("waits instead of guessing when the current page is unknown", () => {
    // The whole bug in one assertion: assuming page 1 here is what sent a caller on page 4
    // forwards to reach page 3.
    expect(decideNavigationStep(null, 3, true, true)).toBe("wait");
  });

  it("waits even when only one direction is available", () => {
    expect(decideNavigationStep(null, 3, false, true)).toBe("wait");
    expect(decideNavigationStep(null, 1, true, false)).toBe("wait");
  });

  it("reports arrival when already on the target page", () => {
    expect(decideNavigationStep(3, 3, true, true)).toBe("arrived");
  });

  it("goes forward towards a later page", () => {
    expect(decideNavigationStep(1, 3, true, true)).toBe("next");
  });

  it("goes backward towards an earlier page", () => {
    // The live scenario, decided correctly: on the last page, wanting an earlier one.
    expect(decideNavigationStep(4, 3, false, true)).toBe("prev");
  });

  it("does not try to move forward from the last page", () => {
    expect(decideNavigationStep(4, 5, false, true)).toBe("unreachable");
  });

  it("does not try to move backward from the first page", () => {
    expect(decideNavigationStep(1, 0, true, false)).toBe("unreachable");
  });
});
