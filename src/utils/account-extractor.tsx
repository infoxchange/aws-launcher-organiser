import type { TreeNode } from "primereact/treenode";
import type { IconType } from "primereact/utils";
import { BackgroundLoadedImage } from "../components/BackgroundLoadedImage";
import {
  decideNavigationStep,
  describeBrokenSelectors,
  extractAccountsFromPage,
  findAccountRowById,
  getAccountRows,
  getErrorAlert,
  getErrorMessage,
  getRetryButton,
  getRoleRowFor,
  getRowExpandButton,
  hasPaginationControls,
  isRowExpanded,
  parseRoles,
  getCurrentPageNumber as readCurrentPageNumber,
  hasNextPage as readHasNextPage,
  hasPrevPage as readHasPrevPage,
  isLoading as readIsLoading,
} from "./aws-page/parse";
import { selectors } from "./aws-page/selectors";
import type { Group, TagConfig } from "./configStore";

/**
 * Extracts and groups AWS accounts from the SSO start page
 */

export type { Group };
export interface Account {
  id: string;
  name: string;
  email: string;
  tags?: string[];
  roles?: AccountRole[];
  description?: string;
  pageNumber?: number; // Track which page this account is on (1-indexed)
}

export interface AccountGroupNode extends TreeNode {
  key: string;
  data: {
    name: string;
  };
  expandedByDefault?: boolean;
  children?: (AccountGroupNode | AccountNode)[];
}

export interface AccountNode extends TreeNode {
  key: string;
  data: Account;
}

/**
 * Get the current page number from pagination controls
 */
function getCurrentPageNumber(): number | null {
  return readCurrentPageNumber(document);
}

/**
 * Wait for the pagination controls to be usable, i.e. present and reporting a current page.
 *
 * They vanish briefly whenever the portal re-renders after a page change. Acting during that
 * window is what made navigation give up on the wrong page.
 */
async function waitForPaginationReady(timeout = 5000): Promise<number | null> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (hasPaginationControls(document)) {
      const current = getCurrentPageNumber();
      if (current !== null) return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

/**
 * Extract accounts from the current page only
 * The accounts are displayed in a table with 3 columns: Name (TH), ID (TD), Email (TD)
 */
function extractAccountsFromCurrentPage(pageNumber: number): Account[] {
  return extractAccountsFromPage(document, pageNumber);
}

/**
 * Check if there's a next page available
 */
function hasNextPage(): boolean {
  return readHasNextPage(document);
}

/**
 * Wait until the portal has finished rendering its first page.
 *
 * The account list and the pagination controls appear progressively, and extraction used to
 * start as soon as the first row existed. That produced two failures at once on a real portal:
 * a truncated account list (99 of 100 rows), and — because the pagination controls had not
 * rendered yet — `hasNextPage()` seeing no Next button and concluding there were no further
 * pages, so extraction stopped after page one.
 *
 * Readiness means: not showing the loading indicator, a stable row count, and pagination
 * present. If the portal never settles we extract anyway rather than hanging, but say so.
 */
async function waitForPortalReady(timeout = 30000): Promise<void> {
  const pollMs = 250;
  const requiredStableMs = 1000;
  const start = Date.now();

  let lastCount = -1;
  let stableMs = 0;

  while (Date.now() - start < timeout) {
    const loading = readIsLoading(document);
    const count = getAccountRows(document).length;
    const paginationReady = hasPaginationControls(document);

    if (!loading && count > 0 && count === lastCount && paginationReady) {
      stableMs += pollMs;
      if (stableMs >= requiredStableMs) {
        console.log(`[waitForPortalReady] Portal settled: ${count} rows, pagination present`);
        return;
      }
    } else {
      stableMs = 0;
    }

    lastCount = count;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  console.warn(
    `[waitForPortalReady] Portal did not settle within ${timeout}ms ` +
      `(rows=${lastCount}, pagination=${hasPaginationControls(document)}). Extracting anyway.`
  );
}

/**
 * Identifier for the accounts currently displayed, used to detect that pagination actually
 * moved. The first row's text alone is not enough: two pages can share a first row while the
 * rest differs, and more importantly a click that does nothing leaves it identical.
 */
function getPageFingerprint(): string {
  return extractAccountsFromPage(document, 0)
    .map((account) => account.id)
    .join(",");
}

/**
 * Click the next page button and wait for the account list to actually change.
 *
 * @see docs/aws-page-integration.md § "Pagination must prove it moved"
 *
 * Returns false if there was no next page, or if the list never changed — the caller must treat
 * that as "pagination is finished" rather than retrying. Previously this resolved `true` on
 * timeout, so a click that did nothing looked like a successful page turn and extraction kept
 * re-scraping the same page.
 */
async function goToNextPage(): Promise<boolean> {
  if (!hasNextPage()) {
    return false;
  }

  const nextButton = document.querySelector<HTMLButtonElement>(selectors.nextPageButton);
  if (!nextButton) {
    return false;
  }

  const before = getPageFingerprint();
  nextButton.click();

  return new Promise((resolve) => {
    const maxWait = 5000;
    const startTime = Date.now();

    const checkInterval = setInterval(() => {
      if (getPageFingerprint() !== before) {
        clearInterval(checkInterval);
        resolve(true);
        return;
      }
      if (Date.now() - startTime > maxWait) {
        clearInterval(checkInterval);
        console.warn(
          "[goToNextPage] Account list did not change after clicking Next — treating pagination as complete"
        );
        resolve(false);
      }
    }, 100);
  });
}

/**
 * Click the previous page button and wait for the account list to actually change.
 * Mirrors goToNextPage, including returning false when nothing moved.
 */
async function goToPrevPage(): Promise<boolean> {
  if (!readHasPrevPage(document)) {
    return false;
  }

  const prevButton = document.querySelector<HTMLButtonElement>(selectors.prevPageButton);
  if (!prevButton) {
    return false;
  }

  const before = getPageFingerprint();
  prevButton.click();

  return new Promise((resolve) => {
    const maxWait = 5000;
    const startTime = Date.now();

    const interval = setInterval(() => {
      if (getPageFingerprint() !== before) {
        clearInterval(interval);
        resolve(true);
        return;
      }
      if (Date.now() - startTime > maxWait) {
        clearInterval(interval);
        console.warn("[goToPrevPage] Account list did not change after clicking Previous");
        resolve(false);
      }
    }, 100);
  });
}

/**
 * Extracts account information progressively, calling onAccountsFound for each page of accounts
 * Acquires "*" (extraction mode lock) for the entire duration to prevent concurrent role loading
 * on different pages from interfering with pagination.
 */
export async function extractAccountsProgressive(
  onProgress?: (status: string) => void,
  onAccountsFound?: (accounts: Account[]) => void
): Promise<Account[]> {
  const allAccounts: Account[] = [];
  let pageNumber = 1;
  const maxPages = 100; // Safety limit to prevent infinite loops

  try {
    // Wait for account rows to appear - they may not be in the DOM immediately
    onProgress?.("Waiting for accounts to appear on the page...");
    await waitForAnyElement(document.body, [selectors.anyItemRow], 15000);
  } catch {
    // Name the selector that stopped matching. AWS rewrites this page without notice, and
    // "no accounts found" on its own gives a bug report nothing to go on.
    const broken = describeBrokenSelectors(document);
    const detail = broken
      ? `The AWS page structure has changed — these selectors no longer match: ${broken}`
      : "Timed out waiting for account rows to appear on the AWS page";
    console.warn(`[extractAccountsProgressive] ${detail}`);
    throw new Error(detail);
  }

  // Acquire extraction mode lock for the entire extraction process
  // This prevents any other code from accessing pages until all extraction is complete
  let releaseExtractionLock: (() => void) | null = null;

  try {
    releaseExtractionLock = await acquirePageAccess("*", "extractAccountsProgressive");

    onProgress?.("Waiting for the account list to finish loading…");
    await waitForPortalReady();

    // Accounts are deduplicated by id. AWS pagination cannot be fully trusted — if a page turn
    // silently fails we would otherwise scrape the same page repeatedly and report a total far
    // higher than the real account count.
    const seenIds = new Set<string>();

    while (pageNumber <= maxPages) {
      // Wait for any "Loading accounts" indicator inside the treegrid to disappear
      await waitForLoadingToComplete();

      console.log(`[extractAccountsProgressive] Starting to load page ${pageNumber}...`);

      onProgress?.(`Loading page ${pageNumber}… (${allAccounts.length} accounts so far)`);
      const pageAccounts = extractAccountsFromCurrentPage(pageNumber);
      const newAccounts = pageAccounts.filter((account) => !seenIds.has(account.id));
      for (const account of newAccounts) {
        seenIds.add(account.id);
      }
      allAccounts.push(...newAccounts);

      console.log(
        `[extractAccountsProgressive] Page ${pageNumber}: Found ${pageAccounts.length} accounts ` +
          `(${newAccounts.length} new). Total so far: ${allAccounts.length}`
      );

      if (newAccounts.length > 0) {
        onAccountsFound?.(newAccounts);
      }

      // Belt and braces: even if the pagination controls claim another page exists, a page that
      // contributes nothing new means we are going in circles.
      if (pageAccounts.length > 0 && newAccounts.length === 0) {
        console.warn(
          `[extractAccountsProgressive] Page ${pageNumber} contained only accounts already seen — stopping`
        );
        break;
      }

      // Re-check readiness first: the pagination controls disappear briefly while the portal
      // re-renders after a page turn, and a missing Next button is indistinguishable from a
      // disabled one. Without this, extraction can stop early believing it reached the end.
      await waitForPaginationReady();

      if (!hasNextPage()) {
        console.log("[extractAccountsProgressive] No more pages available - pagination complete");
        break;
      }

      console.log(`[extractAccountsProgressive] Moving to page ${pageNumber + 1}...`);
      const moved = await goToNextPage();
      if (!moved) {
        console.warn(
          "[extractAccountsProgressive] Could not advance past " +
            `page ${pageNumber} — stopping pagination`
        );
        break;
      }
      pageNumber++;
    }

    if (pageNumber > maxPages) {
      console.warn(
        `[extractAccountsProgressive] Hit the ${maxPages}-page safety limit. ` +
          "This usually means the pagination controls changed shape again."
      );
    }
  } catch (error) {
    console.error("[extractAccountsProgressive] Error extracting accounts:", error);
    throw error;
  } finally {
    // Release extraction lock
    if (releaseExtractionLock) {
      releaseExtractionLock();
    }
  }

  console.log(`[extractAccountsProgressive] ✓ Total accounts extracted: ${allAccounts.length}`);
  return allAccounts;
}

export interface AccountRole {
  name: string;
  consoleUrl: string;
  accessKeysElement?: HTMLElement;
}

/**
 * Wait until no element within the given selector contains the text "Loading accounts"
 */
function waitForLoadingToComplete(timeout = 10000): Promise<void> {
  return new Promise((resolve) => {
    const isLoading = () => readIsLoading(document);

    if (!isLoading()) {
      resolve();
      return;
    }

    console.log("[extractAccountsProgressive] Waiting for loading indicator to disappear...");
    const startTime = Date.now();

    const observer = new MutationObserver(() => {
      if (!isLoading() || Date.now() - startTime > timeout) {
        observer.disconnect();
        resolve();
      }
    });

    const container = document.querySelector(selectors.accountsTable);
    if (container) {
      observer.observe(container, { childList: true, subtree: true, characterData: true });
    }

    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, timeout);
  });
}

/**
 * Wait for any of multiple elements to appear in the DOM
 */
function waitForAnyElement(parent: Element, selectors: string[], timeout = 5000): Promise<Element> {
  return new Promise((resolve, reject) => {
    // Check if any element already exists
    for (const selector of selectors) {
      const existing = parent.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }
    }

    const observer = new MutationObserver(() => {
      for (const selector of selectors) {
        const el = parent.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
          return;
        }
      }
    });

    observer.observe(parent, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for any of: ${selectors.join(", ")}`));
    }, timeout);
  });
}

/**
 * Page access locking mechanism with extraction priority
 * The extraction code claims "*" for exclusive access to all pages.
 * Other code claims a specific page number and must wait if "*" is locked.
 *
 * Only one claim can exist at a time for "*" (extraction mode).
 * Multiple concurrent claims can exist for a specific page number (if not in extraction mode).
 * Once extraction acquires "*", all other code waits until extraction releases it.
 */
let currentPageLocked: string | number | null = null; // "*" for extraction, or a page number
let pageAccessClaims = 0;
const pageChangeWaiters: (() => void)[] = [];

/**
 * Acquire access to a page or to all pages for extraction
 *
 * @param pageNumber - "*" for exclusive extraction mode, or a specific page number
 * @param caller - Name/ID of the code requesting access (for logging)
 * @returns Release function to call when done
 *
 * Extraction mode ("*"):
 *   - Waits until no locks exist
 *   - Only one claim allowed at a time
 *   - Blocks all other page access
 *
 * Specific page mode (number):
 *   - Waits if "*" is locked or a different page is locked
 *   - Multiple concurrent claims on same page allowed
 *   - Other pages will wait
 */
async function acquirePageAccess(
  pageNumber: string | number,
  caller: string = "unknown"
): Promise<() => void> {
  const isExtractionMode = pageNumber === "*";

  console.log(
    `🔒 [${caller}] Requesting page access: ${isExtractionMode ? "EXTRACTION MODE (*)" : `page ${pageNumber}`}`
  );

  // Wait if another lock is active
  while (currentPageLocked !== null && currentPageLocked !== pageNumber) {
    const lockedDesc =
      currentPageLocked === "*" ? "EXTRACTION MODE (*)" : `page ${currentPageLocked}`;
    console.log(`⏳ [${caller}] Waiting - ${lockedDesc} is locked`);
    await new Promise<void>((resolve) => pageChangeWaiters.push(() => resolve()));
  }

  // Acquire the lock
  if (currentPageLocked === null) {
    currentPageLocked = pageNumber;
  }
  pageAccessClaims++;

  const claimDesc = isExtractionMode ? "EXTRACTION MODE (*)" : `page ${pageNumber}`;
  console.log(`✅ [${caller}] Acquired page access: ${claimDesc} (claims: ${pageAccessClaims})`);

  return () => {
    pageAccessClaims--;
    const claimDesc = isExtractionMode ? "EXTRACTION MODE (*)" : `page ${pageNumber}`;
    console.log(
      `🔓 [${caller}] Releasing page access: ${claimDesc} (claims remaining: ${pageAccessClaims})`
    );

    if (pageAccessClaims === 0) {
      // Lock is now free
      currentPageLocked = null;
      console.log(`🆓 Page lock released, all access claims are done`);
      // Wake up any code waiting for page change
      const waiters = pageChangeWaiters.splice(0);
      waiters.forEach((resolve) => {
        resolve();
      });
    }
  };
}

/**
 * Navigate to a specific page in the accounts table
 */
/**
 * Only one navigation may be in flight at a time.
 *
 * The page-access lock deliberately allows several role loads for the *same* page to run
 * concurrently. Each of them calls navigateToPage, and without this guard they each read the
 * current page and each click Next — so a single requested step moves two pages, and everyone
 * ends up reading the wrong one. Serialising means the second caller waits, re-reads, and finds
 * it has nothing to do.
 */
let navigationInFlight: Promise<boolean> | null = null;

async function navigateToPage(targetPageNumber: number, timeout = 30000): Promise<boolean> {
  // Wait out any navigation already running before deciding whether we need to move.
  while (navigationInFlight) {
    await navigationInFlight.catch(() => false);
  }

  const alreadyThere = await waitForPaginationReady();
  if (alreadyThere === targetPageNumber) {
    return true;
  }

  const run = performNavigation(targetPageNumber, timeout);
  navigationInFlight = run;
  try {
    return await run;
  } finally {
    navigationInFlight = null;
  }
}

async function performNavigation(targetPageNumber: number, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  let announced = false;

  while (Date.now() < deadline) {
    // Never act on a guessed page number: if the controls are mid-render, wait for them.
    const currentPageNumber = await waitForPaginationReady();
    if (currentPageNumber === null) {
      console.warn("[navigateToPage] Pagination controls unavailable; retrying");
      continue;
    }

    const step = decideNavigationStep(
      currentPageNumber,
      targetPageNumber,
      readHasNextPage(document),
      readHasPrevPage(document)
    );

    if (step === "arrived") {
      return true;
    }

    if (step === "wait" || step === "unreachable") {
      // "unreachable" is not final either: the control may have been mid-render. Re-read and
      // try again until the deadline rather than giving up on the wrong page.
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }

    if (!announced) {
      console.log(
        `[navigateToPage] Navigating from page ${currentPageNumber} to page ${targetPageNumber}`
      );
      announced = true;
    }

    const moved = step === "next" ? await goToNextPage() : await goToPrevPage();

    if (!moved) {
      // A failed step is not proof the target is unreachable — the control may simply have been
      // re-rendering. Re-read the page and try again until the deadline.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  const finalPage = getCurrentPageNumber();
  if (finalPage === targetPageNumber) {
    return true;
  }
  console.warn(
    `[navigateToPage] Gave up trying to reach page ${targetPageNumber}; still on ${finalPage}`
  );
  return false;
}

/**
 * Wait for an account's row to be present on the currently displayed page.
 *
 * Polling rather than checking once: a page turn leaves the table re-rendering, so the row can
 * be a moment behind the pagination state.
 */
async function waitForAccountRow(
  accountId: string,
  expectedPage: number | undefined,
  timeout = 8000
): Promise<Element | null> {
  const deadline = Date.now() + timeout;
  let reNavigated = false;

  while (Date.now() < deadline) {
    const row = findAccountRowById(document, accountId);
    if (row) return row;

    // A concurrent role load may have moved the portal on. Re-assert our page once before
    // giving up, rather than reporting a row missing that is simply displayed elsewhere.
    if (expectedPage !== undefined && !reNavigated) {
      const current = getCurrentPageNumber();
      if (current !== null && current !== expectedPage) {
        reNavigated = true;
        await navigateToPage(expectedPage);
        continue;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

/**
 * Wait for the expanded role row belonging to an account.
 *
 * The row is re-resolved by account id on every poll rather than held as an element reference:
 * the portal re-renders its table (page changes, virtualisation), which detaches the original
 * `<tr>`. Polling a detached node waits forever for a sibling that will never arrive, which
 * surfaced as "the expanded row never rendered" for accounts that were otherwise fine. If the
 * re-render also collapsed the row, expand it again.
 *
 * Returns null on timeout. Callers must NOT fall back to searching the whole document: every
 * other expanded account's roles live there too, and attributing them all to one account is
 * exactly the "this account has dozens of roles" bug.
 */
async function waitForRoleRow(accountId: string, timeout = 10000): Promise<Element | null> {
  const start = Date.now();
  let reExpanded = 0;

  while (Date.now() - start < timeout) {
    const row = findAccountRowById(document, accountId);
    if (row) {
      const roleRow = getRoleRowFor(row);
      if (roleRow) return roleRow;

      // A re-render can drop the expanded state; re-open it rather than waiting on a row that
      // is no longer coming.
      if (!isRowExpanded(row) && reExpanded < 3) {
        reExpanded++;
        getRowExpandButton(row)?.click();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

export async function getAccountRoles(account: Account | string): Promise<AccountRole[]> {
  // Support both old API (string accountId) and new API (Account object)
  let accountId: string;
  let pageNumber: number | undefined;

  if (typeof account === "string") {
    accountId = account;
  } else {
    accountId = account.id;
    pageNumber = account.pageNumber;
  }

  // Acquire page access lock for the duration of this operation
  // This prevents conflicts with concurrent extraction or other role loads on different pages
  let releasePageAccess: (() => void) | null = null;

  try {
    // Navigate to the correct page if specified
    if (pageNumber) {
      releasePageAccess = await acquirePageAccess(pageNumber, `getAccountRoles(${accountId})`);
      await navigateToPage(pageNumber);
    }

    const matchedRow = await waitForAccountRow(accountId, pageNumber);
    if (!matchedRow) {
      throw new Error(
        `Account row not found for id: ${accountId} ` +
          `(wanted page ${pageNumber ?? "any"}, portal is on page ${getCurrentPageNumber()})`
      );
    }

    const accountButton = getRowExpandButton(matchedRow);
    if (!accountButton) {
      throw new Error(`Account expand button not found for id: ${accountId}`);
    }

    if (!isRowExpanded(matchedRow)) {
      accountButton.click();
    }

    // The portal injects the roles as a sibling row nested one aria-level deeper, after a
    // network round trip. Wait for that row rather than assuming a fixed delay is enough:
    // scoping role parsing to the whole document when it is missing attributes every role on
    // the page to this one account.
    const roleRow = await waitForRoleRow(accountId);
    if (!roleRow) {
      throw new Error(
        `Roles did not appear for account ${accountId}: the expanded row never rendered`
      );
    }

    // Try up to 3 times to load roles, retrying on error
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Wait for either federation link or error alert to appear in the expanded sibling row
        await waitForAnyElement(roleRow, [selectors.federationLink, selectors.errorAlert], 5000);
        const scope = roleRow;

        const roles = parseRoles(scope);
        if (roles.length > 0) {
          return roles;
        }

        // Check if error alert appeared
        const errorAlert = getErrorAlert(scope);
        if (errorAlert && attempt < MAX_RETRIES - 1) {
          const retryButton = getRetryButton(errorAlert);
          if (retryButton) {
            const errorMessage = getErrorMessage(scope) ?? "";
            // Wait times: 2s, 5s, 10s (longer for rate limiting)
            const isRateLimited = errorMessage.includes("HTTP 429");
            const waitTimes = [2000, 5000, 10000];
            const waitTime = isRateLimited ? waitTimes[attempt] : waitTimes[attempt];
            console.log(
              `[getAccountRoles] Retrying in ${waitTime}ms (attempt ${attempt + 1}/${MAX_RETRIES - 1})...`
            );
            (retryButton as HTMLButtonElement).click();
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          }
        }

        // If we got here, federation link didn't appear but error alert did
        if (errorAlert) {
          if (attempt === MAX_RETRIES - 1) {
            const errorMessage = getErrorMessage(scope) ?? "Unknown error";
            throw new Error(
              `Failed to load roles for account ${accountId} after ${MAX_RETRIES} attempts: ${errorMessage}`
            );
          }
        } else {
          // Neither link nor error appeared before timeout - shouldn't happen with waitForAnyElement
          throw new Error(
            `Failed to load roles for account ${accountId}: no federation link or error alert appeared`
          );
        }
      } catch (error) {
        // Only re-throw if this was the last attempt or an unexpected error
        if (attempt === MAX_RETRIES - 1) {
          if (error instanceof Error && error.message.includes("Failed to load roles")) {
            throw error;
          }
          const scope = roleRow;
          const errorMessage = getErrorAlert(scope)
            ? (getErrorMessage(scope) ?? "Unknown error")
            : "Timeout waiting for roles";
          throw new Error(
            `Failed to load roles for account ${accountId} after ${MAX_RETRIES} attempts: ${errorMessage}`
          );
        }
      }
    }

    // Shouldn't reach here
    throw new Error(`Failed to load roles for account ${accountId} after ${MAX_RETRIES} attempts`);
  } finally {
    if (releasePageAccess) {
      releasePageAccess();
    }
  }
}

/**
 * Test if an account name matches a matcher (single or multiple RegExps)
 */
function testMatcher(matcher: string | string[] | undefined, accountName: string): boolean {
  if (!matcher) return false;

  const createRegex = (str: string): RegExp => {
    return new RegExp(str);
  };

  if (Array.isArray(matcher)) {
    return matcher.filter((m) => m).some((m) => createRegex(m).test(accountName));
  }

  return createRegex(matcher).test(accountName);
}

/**
 * Extract tags from account name based on available tag configs
 */
function extractTagsFromName(accountName: string, tagConfigs: TagConfig[]): string[] {
  const foundTags: string[] = [];
  for (const tag of tagConfigs) {
    let matches = false;
    // Use matcher if provided, otherwise fall back to suffix matching
    if (tag.matcher) {
      try {
        const matchers = Array.isArray(tag.matcher) ? tag.matcher : [tag.matcher];
        matches = matchers
          .filter((m) => m)
          .some((m) => {
            return new RegExp(m).test(accountName);
          });
      } catch {
        // If regex is invalid, skip this tag
        matches = false;
      }
    } else {
      const keySuffix = accountName.endsWith(`-${tag.key}`);
      const nameSuffix = accountName.endsWith(`-${tag.name.toLowerCase()}`);
      matches = keySuffix || nameSuffix;
    }
    if (matches) {
      foundTags.push(tag.key);
    }
  }
  return foundTags;
}

/**
 * Get the longest matching substring for a regex matcher against account name
 */
function getLongestMatchLength(
  matcher: string | string[] | undefined,
  accountName: string
): number {
  if (!matcher) return 0;

  const matchers = Array.isArray(matcher) ? matcher : [matcher];
  let longestLength = 0;

  for (const m of matchers) {
    if (!m) continue;
    try {
      const regex = new RegExp(m);
      const match = accountName.match(regex);
      if (match) {
        // Use the first captured group if it exists, otherwise use the entire match
        const matchedString = match[1] || match[0];
        longestLength = Math.max(longestLength, matchedString.length);
      }
    } catch {
      // Invalid regex, skip
    }
  }

  return longestLength;
}

/**
 * Find the deepest matching group for an account
 * Uses depth-first search to find the deepest level, then selects the group with
 * the longest matching substring if multiple groups match at the same depth.
 * Returns the path to the deepest matching group, or null if no match
 */
function findDeepestMatchingGroup(
  account: Account,
  groups: Group[]
): { group: Group; path: Group[] } | null {
  interface DepthMatch {
    group: Group;
    path: Group[];
    matchLength: number;
  }

  let deepestMatches: DepthMatch[] = [];
  let currentDepth = 0;

  const search = (groupsToSearch: Group[], currentPath: Group[], depth: number): void => {
    let hasMatchAtThisDepth = false;
    const matchesAtThisDepth: DepthMatch[] = [];

    for (const group of groupsToSearch) {
      const groupMatches = testMatcher(group.matcher, account.name);

      if (groupMatches) {
        hasMatchAtThisDepth = true;
        const matchLength = getLongestMatchLength(group.matcher, account.name);
        matchesAtThisDepth.push({
          group,
          path: [...currentPath, group],
          matchLength,
        });
      }

      // Always search children if they exist, regardless of whether parent matched
      // This allows groups without matchers to be traversed
      if (group.children) {
        search(group.children, groupMatches ? [...currentPath, group] : currentPath, depth + 1);
      }
    }

    // Update deepest matches if we found matches at this depth
    if (hasMatchAtThisDepth) {
      if (depth > currentDepth) {
        currentDepth = depth;
        deepestMatches = matchesAtThisDepth;
      } else if (depth === currentDepth) {
        deepestMatches.push(...matchesAtThisDepth);
      }
    }
  };

  search(groups, [], 0);

  // If no matches found, return null
  if (deepestMatches.length === 0) {
    return null;
  }

  // If only one match, return it
  if (deepestMatches.length === 1) {
    return { group: deepestMatches[0].group, path: deepestMatches[0].path };
  }

  // Multiple matches at same depth: return the one with longest match
  const bestMatch = deepestMatches.reduce((prev, curr) =>
    curr.matchLength > prev.matchLength ? curr : prev
  );

  return { group: bestMatch.group, path: bestMatch.path };
}

/**
 * Build the complete account tree from groups and accounts
 */
function buildAccountTree(
  groups: Group[],
  accounts: Account[],
  tagConfigs: TagConfig[]
): (AccountGroupNode | AccountNode)[] {
  // Track which accounts have been placed in groups
  const placedAccountIds = new Set<string>();

  /**
   * Recursively build tree structure from groups
   */
  const buildGroupNodes = (groupsToProcess: Group[]): AccountGroupNode[] => {
    return groupsToProcess.map((group) => {
      // Find all accounts that match this specific group as their deepest match
      const accountsForThisGroup = accounts.filter((account) => {
        const deepestMatch = findDeepestMatchingGroup(account, groups);
        if (!deepestMatch) return false;
        // Check if this account's deepest match is this specific group
        const isMatch = deepestMatch.group.key === group.key;
        if (isMatch) {
          placedAccountIds.add(account.id);
        }
        return isMatch;
      });

      const children: (AccountGroupNode | AccountNode)[] = [];

      // Add account nodes
      accountsForThisGroup.forEach((account) => {
        const accountNode: AccountNode = {
          key: account.id,
          data: {
            ...account,
            tags: extractTagsFromName(account.name, tagConfigs),
          } as Account,
          icon: "pi pi-box",
        };
        children.push(accountNode);
      });

      // Add nested group nodes recursively
      if (group.children && group.children.length > 0) {
        children.push(...buildGroupNodes(group.children));
      }

      // Sort children by name
      children.sort((a, b) => a.data.name.localeCompare(b.data.name));

      const renderIconSrc = (src: string) => {
        const iconFunction: IconType<TreeNode> = (options) => {
          const { ref, iconProps } = options;
          return (
            <BackgroundLoadedImage
              src={src}
              iconProps={iconProps}
              forwardedRef={ref}
              placeholder="pi pi-folder"
            />
          );
        };
        return iconFunction;
      };

      // Include group even if it has no children
      return {
        key: `group-${group.key}`,
        data: {
          name: group.name,
        },
        expandedByDefault: group.expandedByDefault ?? false,
        icon: group.icon ? renderIconSrc(group.icon) : "pi pi-folder",
        children: children.length > 0 ? children : undefined,
      };
    });
  };

  // Build groups from configuration
  const configGroupNodes = buildGroupNodes(groups);

  // Add unmatched accounts to an "Other" group
  const unmatchedAccounts = accounts.filter((account) => !placedAccountIds.has(account.id));

  if (unmatchedAccounts.length > 0) {
    const unmatchedAccountNodes: AccountNode[] = unmatchedAccounts.map((account) => ({
      key: account.id,
      data: {
        ...account,
        tags: extractTagsFromName(account.name, tagConfigs),
      },
      icon: "pi pi-box",
    }));

    // Sort by name
    unmatchedAccountNodes.sort((a, b) => a.data.name.localeCompare(b.data.name));

    const otherGroup: AccountGroupNode = {
      key: "group-other",
      data: {
        name: "Other",
      },
      expandedByDefault: false,
      icon: "pi pi-folder",
      children: unmatchedAccountNodes,
    };

    return [...configGroupNodes, otherGroup];
  }

  return configGroupNodes;
}

/**
 * Gets the complete account tree from groups and accounts
 * Accounts are placed in the deepest matching group
 */
export function getAccountTree(
  accounts: Account[],
  groups: Group[],
  tagConfigs: TagConfig[] = []
): (AccountGroupNode | AccountNode)[] {
  // Defensive checks
  if (!Array.isArray(groups)) {
    console.error("getAccountTree received non-array groups:", groups);
    groups = [];
  }

  if (!Array.isArray(tagConfigs)) {
    console.error("getAccountTree received non-array tagConfigs:", tagConfigs);
    tagConfigs = [];
  }

  if (!Array.isArray(accounts)) {
    console.error("getAccountTree received non-array accounts:", accounts);
    accounts = [];
  }

  return buildAccountTree(groups, accounts, tagConfigs);
}
