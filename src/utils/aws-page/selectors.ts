/**
 * Every selector this extension uses against the AWS access portal page, in one place.
 *
 * AWS rewrites this page's markup without notice, and when it does, the extension breaks in
 * ways that are hard to attribute. Centralising the selectors means:
 *   - the unit tests can assert each one against a captured fixture (tests/fixtures/),
 *   - the drift check can probe them all against the live page and report which ones moved,
 *   - a breakage names the selector that moved instead of surfacing as a generic timeout.
 *
 * When AWS changes something, this file and `parse.ts` should be the only places that need
 * editing.
 *
 * @see docs/aws-page-integration.md § "All selectors live in one module"
 */

export const selectors = {
  /** Where the extension mounts its own UI. NOTE: more than one of these exists on the page;
   *  the accounts table lives inside the first. */
  mountPoint: '[role="tabpanel"]',

  accountsTable: 'table[role="treegrid"]',

  /**
   * Any row the portal marks as a selectable item. This matches BOTH account rows and the
   * expanded role rows, so never use it directly — use `getAccountRows()`, which separates
   * them. Kept here because the drift check wants the raw count.
   */
  anyItemRow: 'table[role="treegrid"] tr[data-selection-item="item"]',

  /** Present only in account rows, which is what distinguishes them from role rows. */
  accountNameCell: '[data-testid="account-list-cell"]',

  /** Expands an account row to reveal its roles. */
  rowExpandButton: "button[aria-expanded]",

  /** Role link inside an expanded role row. */
  federationLink: 'a[data-testid="federation-link"]',

  /** "Access keys" style action button beside a role. */
  accessKeysButton: '[data-testid="role-creation-action-button"]',

  errorAlert: '[data-testid="error-component-alert"]',
  retryButton: 'button[data-testid="retry-button"]',

  nextPageButton: 'button[aria-label="Next page"]',
  prevPageButton: 'button[aria-label="Previous page"]',
  /** AWS uses aria-current="true" (not the standard "page") on the active page button. */
  currentPageButton: 'button[aria-label^="Page"][aria-current="true"]',
  anyPageButton: 'button[aria-label^="Page"]',
} as const;

export type SelectorName = keyof typeof selectors;

/** Text the portal shows while the account list is still loading. */
export const LOADING_TEXT = "Loading accounts";

/**
 * Substring of the hashed Cloudscape class AWS puts on a disabled pagination button
 * (e.g. `awsui_button-disabled_fvjdu_5ng4o_79`). The hash changes between AWS releases, so
 * only the stable middle is matched, and only ever as one signal among several —
 * see `isControlDisabled()`.
 */
export const DISABLED_CLASS_FRAGMENT = "button-disabled";

/**
 * Rows the portal nests one level deep are roles belonging to the account row above them.
 */
export const ROLE_ROW_ARIA_LEVEL = "2";
export const ACCOUNT_ROW_ARIA_LEVEL = "1";
