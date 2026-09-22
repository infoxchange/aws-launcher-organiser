/**
 * Pure reads of the AWS access portal DOM.
 *
 * Every function takes an explicit `root` rather than reaching for the global `document`, so
 * they can be unit-tested against a captured fixture in happy-dom with no browser involved.
 * Nothing here mutates the page or awaits anything — behaviour that clicks and waits lives in
 * `account-extractor.tsx`.
 */

import {
  DISABLED_CLASS_FRAGMENT,
  LOADING_TEXT,
  ROLE_ROW_ARIA_LEVEL,
  type SelectorName,
  selectors,
} from "./selectors";

export interface ParsedAccount {
  id: string;
  name: string;
  email: string;
  pageNumber: number;
}

export interface ParsedRole {
  name: string;
  consoleUrl: string;
  accessKeysElement?: HTMLElement;
}

export function getAccountsTable(root: ParentNode): HTMLTableElement | null {
  return root.querySelector<HTMLTableElement>(selectors.accountsTable);
}

/**
 * Is this row an account row, as opposed to the role row the portal injects underneath an
 * expanded account?
 *
 * @see docs/aws-page-integration.md § "Expanded role rows masquerade as account rows"
 *
 * Both kinds carry `data-selection-item="item"`, so the row selector alone cannot tell them
 * apart. The account name cell is the real distinguishing feature; `aria-level` is checked only
 * as a secondary signal, because relying on it alone would break if AWS flattened the tree.
 */
export function isAccountRow(row: Element): boolean {
  if (row.getAttribute("aria-level") === ROLE_ROW_ARIA_LEVEL) return false;
  return !!row.querySelector(selectors.accountNameCell);
}

export function isRoleRow(row: Element | null | undefined): boolean {
  if (!row) return false;
  if (row.getAttribute("aria-level") === ROLE_ROW_ARIA_LEVEL) return true;
  // Fall back to content: a row holding role links is a role row whatever its aria-level says.
  return !!row.querySelector(selectors.federationLink);
}

/** Account rows on the currently displayed page, excluding any expanded role rows. */
export function getAccountRows(root: ParentNode): HTMLTableRowElement[] {
  const rows = Array.from(root.querySelectorAll<HTMLTableRowElement>(selectors.anyItemRow));
  return rows.filter(isAccountRow);
}

/**
 * Read one account row.
 *
 * Layout is: a `th` holding the name cell, then two `td`s — account id, then email. The id cell
 * now wraps the id in an anchor, which `textContent` sees through.
 */
export function parseAccountRow(row: Element, pageNumber: number): ParsedAccount | null {
  const nameCell = row.querySelector("th");
  const cells = Array.from(row.querySelectorAll("td"));
  if (!nameCell || cells.length < 2) return null;

  const name = nameCell.querySelector(selectors.accountNameCell)?.textContent?.trim();
  const id = cells[0]?.textContent?.trim();
  const email = cells[1]?.textContent?.trim();

  if (!id || !name || !email) return null;
  return { id, name, email, pageNumber };
}

export function extractAccountsFromPage(root: ParentNode, pageNumber: number): ParsedAccount[] {
  const accounts: ParsedAccount[] = [];
  for (const row of getAccountRows(root)) {
    const account = parseAccountRow(row, pageNumber);
    if (account) accounts.push(account);
  }
  return accounts;
}

/**
 * Is a pagination control disabled?
 *
 * @see docs/aws-page-integration.md § "Pagination controls are not disabled with `disabled`"
 *
 * AWS does NOT use the `disabled` attribute here. On the last page the Next button carries
 * `aria-disabled="true"`, `tabindex="-1"` and a hashed `…button-disabled…` class, while
 * remaining a perfectly clickable-looking button in the DOM.
 *
 * Missing this is what caused the extension to page forever: `hasNextPage()` stayed true on the
 * final page, so extraction re-scraped it up to its 100-page safety limit and reported a wildly
 * inflated account count. Several independent signals are checked so that AWS dropping any one
 * of them does not resurrect that bug.
 */
export function isControlDisabled(el: Element | null | undefined): boolean {
  if (!el) return true;
  if (el.hasAttribute("disabled")) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  if (el.className?.includes?.(DISABLED_CLASS_FRAGMENT)) return true;
  return false;
}

export function getNextPageButton(root: ParentNode): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(selectors.nextPageButton);
}

export function getPrevPageButton(root: ParentNode): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(selectors.prevPageButton);
}

/** Whether a further page of accounts exists after the one currently displayed. */
export function hasNextPage(root: ParentNode): boolean {
  return !isControlDisabled(getNextPageButton(root));
}

export function hasPrevPage(root: ParentNode): boolean {
  return !isControlDisabled(getPrevPageButton(root));
}

/**
 * Are the pagination controls rendered yet?
 *
 * Distinguishing "not rendered yet" from "on the last page" matters: both leave
 * `getNextPageButton()` returning null, and treating the first as the second makes extraction
 * stop after page one. Callers should wait for this before trusting `hasNextPage()`.
 */
export function hasPaginationControls(root: ParentNode): boolean {
  return (
    !!getNextPageButton(root) ||
    !!getPrevPageButton(root) ||
    root.querySelectorAll(selectors.anyPageButton).length > 0
  );
}

/**
 * Which page the portal is currently showing, or null if that cannot be determined.
 *
 * Returning null matters. This used to default to 1 when no active page button was found, but
 * the pagination controls disappear briefly while the portal re-renders after a page change. A
 * caller on page 4 would then be told it was on page 1, try to move *forward* to reach page 3,
 * hit the disabled Next button and give up — silently leaving the portal on the wrong page.
 * Callers must wait for a real answer rather than act on a guess.
 */
export function getCurrentPageNumber(root: ParentNode): number | null {
  const active = root.querySelector<HTMLElement>(selectors.currentPageButton);
  if (!active) return null;
  const parsed = Number.parseInt(active.textContent ?? "", 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Total number of pages offered by the pagination control, or 1 if there is no pagination. */
export function getPageCount(root: ParentNode): number {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>(selectors.anyPageButton));
  const numbers = buttons
    .map((b) => Number.parseInt(b.textContent ?? "", 10))
    .filter((n) => !Number.isNaN(n));
  return numbers.length > 0 ? Math.max(...numbers) : 1;
}

export function findAccountRowById(
  root: ParentNode,
  accountId: string
): HTMLTableRowElement | null {
  for (const row of getAccountRows(root)) {
    const cells = Array.from(row.querySelectorAll("td"));
    if (cells[0]?.textContent?.trim() === accountId) return row;
  }
  return null;
}

export function getRowExpandButton(row: ParentNode): HTMLButtonElement | null {
  return row.querySelector<HTMLButtonElement>(selectors.rowExpandButton);
}

export function isRowExpanded(row: ParentNode): boolean {
  return getRowExpandButton(row)?.getAttribute("aria-expanded") === "true";
}

/** The role row belonging to an account row, if it is currently expanded. */
export function getRoleRowFor(accountRow: Element): Element | null {
  const sibling = accountRow.nextElementSibling;
  return isRoleRow(sibling) ? sibling : null;
}

export function parseRoles(scope: ParentNode): ParsedRole[] {
  const links = Array.from(scope.querySelectorAll<HTMLAnchorElement>(selectors.federationLink));
  return links.map((link) => {
    const container = link.closest(selectors.accountNameCell) ?? link.parentElement;
    const accessKeysElement = container?.querySelector<HTMLElement>(selectors.accessKeysButton);
    return {
      name: link.textContent?.trim() ?? "",
      consoleUrl: link.href,
      accessKeysElement: accessKeysElement ?? undefined,
    };
  });
}

export function getErrorAlert(scope: ParentNode): Element | null {
  return scope.querySelector(selectors.errorAlert);
}

export function getRetryButton(scope: ParentNode): HTMLButtonElement | null {
  return scope.querySelector<HTMLButtonElement>(selectors.retryButton);
}

/**
 * Message text from a role-loading error alert.
 *
 * Reads the alert's own text rather than a hashed Cloudscape class. The previous
 * implementation selected `.awsui_content_mx3cw_1ehno_391`, which is regenerated on every AWS
 * release and no longer matches anything.
 */
export function getErrorMessage(scope: ParentNode): string | null {
  const alert = getErrorAlert(scope);
  if (!alert) return null;
  const text = alert.textContent?.replace(/\s+/g, " ").trim();
  return text || null;
}

export function isLoading(root: ParentNode): boolean {
  const table = getAccountsTable(root);
  return table?.textContent?.includes(LOADING_TEXT) ?? false;
}

/**
 * Count every selector against a page. Shared by the unit tests and the live drift check so
 * both measure exactly the same thing.
 */
export function probeSelectors(root: ParentNode): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, selector] of Object.entries(selectors)) {
    try {
      out[name] = root.querySelectorAll(selector).length;
    } catch {
      out[name] = -1;
    }
  }
  return out;
}

/**
 * Which load-bearing selectors currently match nothing.
 *
 * Used to turn "no accounts found" — the symptom users report — into a message naming the
 * selector AWS moved, so a bug report identifies the cause instead of just the effect.
 * Role selectors are excluded because they legitimately match nothing until a row is expanded.
 */
export function findBrokenSelectors(root: ParentNode): SelectorName[] {
  const required: SelectorName[] = ["mountPoint", "accountsTable", "anyItemRow", "accountNameCell"];
  const census = probeSelectors(root);
  return required.filter((name) => (census[name] ?? 0) === 0);
}

/** Human-readable description of broken selectors, for display in the extension's error state. */
export function describeBrokenSelectors(root: ParentNode): string | null {
  const broken = findBrokenSelectors(root);
  if (broken.length === 0) return null;
  return broken.map((name) => `${name} (${selectors[name]})`).join(", ");
}

/** What a caller trying to reach a page should do next. */
export type NavigationStep = "arrived" | "next" | "prev" | "wait" | "unreachable";

/**
 * Decide the next move when navigating to a page.
 *
 * Extracted as a pure function because the bug it guards against is a *decision*, not a timing
 * artefact, and is impossible to reproduce reliably in a browser: it needs a read to land inside
 * the few hundred milliseconds where the portal has removed its pagination controls to re-render.
 *
 * What went wrong live: `current` was unknown during that window and the code assumed page 1. On
 * page 4, aiming for page 3, it therefore decided to move *forward*, found Next disabled, and
 * concluded the page was unreachable — leaving the portal on page 4, where the account it wanted
 * did not exist. Hence "Account row not found for id: …" for a scattering of accounts whenever
 * several pages' worth of roles loaded at once.
 *
 * @see docs/aws-page-integration.md § "The pagination controls vanish on every page change, not just at load"
 */
export function decideNavigationStep(
  current: number | null,
  target: number,
  canGoNext: boolean,
  canGoPrev: boolean
): NavigationStep {
  // Never guess. An unknown page means the controls are mid-render; wait for a real answer.
  if (current === null) return "wait";
  if (current === target) return "arrived";

  if (target > current) return canGoNext ? "next" : "unreachable";
  return canGoPrev ? "prev" : "unreachable";
}
