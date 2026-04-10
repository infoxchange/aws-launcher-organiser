import type { TreeNode } from "primereact/treenode";
import type { IconType } from "primereact/utils";
import { BackgroundLoadedImage } from "../components/BackgroundLoadedImage";
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
function getCurrentPageNumber(): number {
  // AWS SSO uses aria-current="true" on the active page button (not the standard "page" value)
  const activePage = document.querySelector<HTMLElement>(
    'button[aria-label^="Page"][aria-current="true"]:not(#aws-account-tree-table *)'
  );
  if (activePage) {
    const num = parseInt(activePage.textContent ?? "", 10);
    if (!Number.isNaN(num)) return num;
  }
  return 1;
}

/**
 * Extract accounts from the current page only
 * The accounts are displayed in a table with 3 columns: Name (TH), ID (TD), Email (TD)
 */
function extractAccountsFromCurrentPage(pageNumber: number): Account[] {
  const accounts: Account[] = [];

  // Get all table rows in the accounts table
  // The table has role="treegrid" and contains rows with data-selection-item="item"
  const rows = document.querySelectorAll('table[role="treegrid"] tr[data-selection-item="item"]');

  rows.forEach((row, _idx) => {
    // Each row has 3 cells:
    // 1. TH element with account name (in a div with data-testid="account-list-cell")
    // 2. TD element with account ID (in a span)
    // 3. TD element with email address
    const nameCell = row.querySelector("th");
    const cells = Array.from(row.querySelectorAll("td"));

    if (nameCell && cells.length >= 2) {
      // Extract account name from TH cell
      const nameElement = nameCell.querySelector('[data-testid="account-list-cell"]');
      const name = nameElement?.textContent?.trim();

      // Extract account ID from first TD cell
      const id = cells[0]?.textContent?.trim();

      // Extract email from second TD cell
      const email = cells[1]?.textContent?.trim();

      if (id && name && email) {
        accounts.push({
          id,
          name,
          email,
          pageNumber,
        });
      }
    }
  });

  return accounts;
}

/**
 * Check if there's a next page available
 */
function hasNextPage(): boolean {
  const nextButton = document.querySelector('button[aria-label="Next page"]:not([disabled])');
  return !!nextButton && !nextButton.hasAttribute("disabled");
}

/**
 * Click the next page button and wait for page to load
 */
async function goToNextPage(): Promise<boolean> {
  const nextButton = document.querySelector<HTMLButtonElement>('button[aria-label="Next page"]');

  if (!nextButton || nextButton.hasAttribute("disabled")) {
    return false;
  }

  // Capture the text of the first account on the current page so we can detect when it changes
  const firstRowText =
    document.querySelector('table[role="treegrid"] tr[data-selection-item="item"] th')
      ?.textContent ?? "";

  nextButton.click();

  // Wait for the page to update by detecting that the first row's content has changed
  return new Promise((resolve) => {
    const maxWait = 5000;
    const startTime = Date.now();

    const checkInterval = setInterval(() => {
      const currentFirstRowText =
        document.querySelector('table[role="treegrid"] tr[data-selection-item="item"] th')
          ?.textContent ?? "";

      // Page has updated when the first row text changes, or fall back to maxWait
      if (currentFirstRowText !== firstRowText || Date.now() - startTime > maxWait) {
        clearInterval(checkInterval);
        resolve(true);
      }
    }, 100);
  });
}

/**
 * Extracts account information progressively, calling onAccountsFound for each page of accounts
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
    await waitForAnyElement(
      document.body,
      ['table[role="treegrid"] tr[data-selection-item="item"]'],
      15000
    );
  } catch {
    console.warn(
      "[extractAccountsProgressive] Timed out waiting for account rows to appear in DOM"
    );
    return [];
  }

  try {
    while (pageNumber <= maxPages) {
      // Wait for any "Loading accounts" indicator inside the treegrid to disappear
      await waitForLoadingToComplete('table[role="treegrid"]');

      console.log(`[extractAccountsProgressive] Starting to load page ${pageNumber}...`);

      document.querySelectorAll('table[role="treegrid"] tr');
      document.querySelectorAll('table[role="treegrid"] tr[data-selection-item="item"]');

      onProgress?.(`Loading page ${pageNumber}… (${allAccounts.length} accounts so far)`);
      const pageAccounts = extractAccountsFromCurrentPage(pageNumber);
      allAccounts.push(...pageAccounts);
      console.log(
        `[extractAccountsProgressive] Page ${pageNumber}: Found ${pageAccounts.length} accounts. Total so far: ${allAccounts.length}`
      );
      onAccountsFound?.(pageAccounts);

      if (!hasNextPage()) {
        console.log("[extractAccountsProgressive] No more pages available - pagination complete");
        break;
      }

      console.log(`[extractAccountsProgressive] Moving to page ${pageNumber + 1}...`);
      await goToNextPage();
      pageNumber++;
    }
  } catch (error) {
    console.error("[extractAccountsProgressive] Error extracting accounts:", error);
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
function waitForLoadingToComplete(containerSelector: string, timeout = 10000): Promise<void> {
  return new Promise((resolve) => {
    const isLoading = () => {
      const container = document.querySelector(containerSelector);
      if (!container) return false;
      return container.textContent?.includes("Loading accounts") ?? false;
    };

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

    const container = document.querySelector(containerSelector);
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
 * Mutex for page navigation — prevents concurrent role loads from racing to navigate
 * to different pages simultaneously, which corrupts the pagination state.
 */
let navigationLock: Promise<void> = Promise.resolve();

/**
 * Navigate to a specific page in the accounts table
 */
async function navigateToPage(targetPageNumber: number): Promise<void> {
  const currentPageNumber = getCurrentPageNumber();

  // Debug: log pagination DOM state on first call
  document.querySelector('[data-testid="pagination-bar"]');
  document.querySelector('button[aria-label="Previous page"]');
  document.querySelector('button[aria-label="Next page"]');

  if (currentPageNumber === targetPageNumber) {
    return;
  }

  console.log(
    `[navigateToPage] Navigating from page ${currentPageNumber} to page ${targetPageNumber}`
  );

  if (targetPageNumber > currentPageNumber) {
    // Go forward
    for (let i = currentPageNumber; i < targetPageNumber; i++) {
      await goToNextPage();
    }
  } else {
    // Go backward - click previous page button and wait for content to change
    for (let i = currentPageNumber; i > targetPageNumber; i--) {
      const prevButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Previous page"]'
      );
      if (!prevButton || prevButton.hasAttribute("disabled")) break;

      const firstRowText =
        document.querySelector('table[role="treegrid"] tr[data-selection-item="item"] th')
          ?.textContent ?? "";

      prevButton.click();

      // Wait for the first row's content to change (same detection as goToNextPage)
      await new Promise<void>((resolve) => {
        const maxWait = 5000;
        const startTime = Date.now();
        const interval = setInterval(() => {
          const current =
            document.querySelector('table[role="treegrid"] tr[data-selection-item="item"] th')
              ?.textContent ?? "";
          if (current !== firstRowText || Date.now() - startTime > maxWait) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
      });
    }
  }
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

  // Serialise all page navigation through a mutex so concurrent role loads don't race.
  let releaseLock!: () => void;
  const lockAcquired = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const previousLock = navigationLock;
  navigationLock = lockAcquired;

  try {
    await previousLock;

    // Navigate to the correct page if specified
    if (pageNumber) {
      await navigateToPage(pageNumber);
    }

    const rows = document.querySelectorAll<HTMLTableRowElement>(
      'table[role="treegrid"] tr[data-selection-item="item"]'
    );

    let accountButton: HTMLButtonElement | null = null;
    let matchedRow: HTMLTableRowElement | null = null;
    for (const row of rows) {
      const tds = row.querySelectorAll("td");
      const firstTDText = tds[0]?.textContent?.trim();
      if (firstTDText === accountId) {
        accountButton = row.querySelector<HTMLButtonElement>("button[aria-expanded]");
        matchedRow = row;
        break;
      }
    }

    if (!accountButton || !matchedRow) {
      throw new Error(`Account button not found for id: ${accountId}`);
    }

    // Use the table row as the scope for waiting for federation links
    const rowElement = matchedRow;

    if (accountButton.getAttribute("aria-expanded") !== "true") {
      accountButton.click();
      // Wait for the expanded role row to be inserted after the current row
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const roleRow = rowElement.nextElementSibling as Element | null;

    // Try up to 3 times to load roles, retrying on error
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Wait for either federation link or error alert to appear in the expanded sibling row
        await waitForAnyElement(
          roleRow ?? document.body,
          ['a[data-testid="federation-link"]', 'div[data-testid="error-component-alert"]'],
          5000
        );
        const scope = roleRow ?? document.body;

        // Check if federation link appeared
        const federationLink = scope.querySelector('a[data-testid="federation-link"]');
        if (federationLink) {
          // Got the roles — collect all federation links in the expanded area
          const allLinks = Array.from(
            scope.querySelectorAll<HTMLAnchorElement>('a[data-testid="federation-link"]')
          );
          return allLinks.map((link) => {
            const roleContainer =
              link.closest('[data-testid="account-list-cell"]') || link.parentElement;
            const accessKeysElement = roleContainer?.querySelector<HTMLElement>(
              '[data-testid="role-creation-action-button"]'
            );
            return {
              name: link.textContent?.trim() ?? "",
              consoleUrl: link.href,
              accessKeysElement: accessKeysElement ?? undefined,
            };
          });
        }

        // Check if error alert appeared
        const errorAlert = scope.querySelector('div[data-testid="error-component-alert"]');
        if (errorAlert && attempt < MAX_RETRIES - 1) {
          const retryButton = errorAlert.querySelector('button[data-testid="retry-button"]');
          if (retryButton) {
            const errorMessage =
              errorAlert.querySelector(".awsui_content_mx3cw_1ehno_391")?.textContent || "";
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
            const errorMessage =
              errorAlert.querySelector(".awsui_content_mx3cw_1ehno_391")?.textContent ||
              "Unknown error";
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
          const errorAlert = (roleRow ?? document.body).querySelector<Element>(
            'div[data-testid="error-component-alert"]'
          );
          const errorMessage = errorAlert
            ? errorAlert.querySelector(".awsui_content_mx3cw_1ehno_391")?.textContent ||
              "Unknown error"
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
    releaseLock();
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
