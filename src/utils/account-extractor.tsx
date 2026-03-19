import type { TreeNode } from "primereact/treenode";
import type { IconType } from "primereact/utils";
import type { Group, TagConfig } from "./configStore";

/**
 * Extracts and groups AWS accounts from the SSO start page
 */

export interface Account {
  id: string;
  name: string;
  email: string;
  tags?: string[];
  roles?: AccountRole[];
  description?: string;
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
 * Extracts account information from AWS SSO start page DOM
 */
export function extractAccounts(): Account[] {
  const accounts: Account[] = [];

  // AWS SSO displays accounts in specific container elements
  // Look for account tiles or list items with account information
  const accountElements = document.querySelectorAll(
    '[data-testid="account-list-cell"] > :last-child'
  );

  accountElements.forEach((element) => {
    const name = element.children[0]?.textContent?.trim();
    const [id, email] =
      element.children[1]?.textContent?.split(" | ").map((part) => part.trim()) || [];

    accounts.push({
      id,
      name,
      email,
    });
  });

  return accounts;
}

export interface AccountRole {
  name: string;
  consoleUrl: string;
}

function waitForElement(parent: Element, selector: string, timeout = 5000): Promise<Element> {
  return new Promise((resolve, reject) => {
    const existing = parent.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = parent.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(parent, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for ${selector}`));
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

export async function getAccountRoles(accountId: string): Promise<AccountRole[]> {
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    'button[data-testid="account-list-cell"]'
  );

  let accountButton: HTMLButtonElement | null = null;
  for (const button of buttons) {
    if (button.textContent?.includes(accountId)) {
      accountButton = button;
      break;
    }
  }

  if (!accountButton) {
    throw new Error(`Account button not found for id: ${accountId}`);
  }

  const parentElement = accountButton.parentElement;
  if (!parentElement) {
    throw new Error(`Account button has no parent element for id: ${accountId}`);
  }

  if (accountButton.getAttribute("aria-expanded") !== "true") {
    accountButton.click();
  }

  // Try up to 3 times to load roles, retrying on error
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Wait for either federation link or error alert to appear
      await waitForAnyElement(
        parentElement,
        ['a[data-testid="federation-link"]', 'div[data-testid="error-component-alert"]'],
        5000
      );

      // Check if federation link appeared
      const federationLink = parentElement.querySelector('a[data-testid="federation-link"]');
      if (federationLink) {
        // Got the roles
        const container = parentElement.querySelector('div[data-testid="role-list-container"]');
        if (container) {
          return Array.from(
            container.querySelectorAll<HTMLAnchorElement>('a[data-testid="federation-link"]')
          ).map((link) => ({
            name: link.textContent?.trim() ?? "",
            consoleUrl: link.href,
          }));
        }
      }

      // Check if error alert appeared
      const errorAlert = parentElement.querySelector('div[data-testid="error-component-alert"]');
      if (errorAlert && attempt < MAX_RETRIES - 1) {
        const retryButton = errorAlert.querySelector('button[data-testid="retry-button"]');
        if (retryButton) {
          const errorMessage =
            errorAlert.querySelector(".awsui_content_mx3cw_1ehno_391")?.textContent || "";
          // Wait times: 2s, 5s, 10s (longer for rate limiting)
          const isRateLimited = errorMessage.includes("HTTP 429");
          const waitTimes = [2000, 5000, 10000];
          const waitTime = isRateLimited ? waitTimes[attempt] : waitTimes[attempt];
          console.log(`[getAccountRoles] Error detected for account ${accountId}: ${errorMessage}`);
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
        const errorAlert = parentElement.querySelector('div[data-testid="error-component-alert"]');
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
}

/**
 * Test if an account name matches a matcher (single or multiple RegExps)
 */
function testMatcher(matcher: string | string[] | undefined, accountName: string): boolean {
  if (!matcher) return false;

  const createRegex = (str: string): RegExp => {
    // Add ^ and $ anchors if matcher doesn't contain them
    let pattern = str;
    if (!pattern.includes("^") && !pattern.includes("$")) {
      pattern = `^${pattern}$`;
    }
    return new RegExp(pattern);
  };

  if (Array.isArray(matcher)) {
    return matcher.some((m) => createRegex(m).test(accountName));
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
        const pattern =
          tag.matcher.includes("^") || tag.matcher.includes("$") ? tag.matcher : `^${tag.matcher}$`;
        const regex = new RegExp(pattern);
        matches = regex.test(accountName);
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
 * Find the deepest matching group for an account
 * Returns the path to the deepest matching group, or null if no match
 */
function findDeepestMatchingGroup(
  account: Account,
  groups: Group[]
): { group: Group; path: Group[] } | null {
  let deepestMatch: { group: Group; path: Group[] } | null = null;

  const search = (groupsToSearch: Group[], currentPath: Group[]): void => {
    for (const group of groupsToSearch) {
      const groupMatches = testMatcher(group.matcher, account.name);

      if (groupMatches) {
        deepestMatch = { group, path: [...currentPath, group] };
      }

      // Always search children if they exist, regardless of whether parent matched
      // This allows groups without matchers to be traversed
      if (group.children) {
        search(group.children, groupMatches ? [...currentPath, group] : currentPath);
      }
    }
  };

  search(groups, []);
  return deepestMatch;
}

/**
 * Build the complete account tree from groups and accounts
 */
function buildAccountTree(
  groups: Group[],
  accounts: Account[],
  tagConfigs: TagConfig[]
): AccountGroupNode[] {
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
        const iconFunction: IconType<AccountGroupNode> = (options) => {
          const { ref, iconProps } = options;
          return <img src={src} {...iconProps} ref={ref} alt="" aria-hidden="true" />;
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

  // Create "other" group for unmatched accounts
  const unmatchedAccounts = accounts.filter((account) => !placedAccountIds.has(account.id));
  const otherGroupNode: AccountGroupNode | null =
    unmatchedAccounts.length > 0
      ? {
          key: "group-other",
          data: { name: "Other" },
          expandedByDefault: false,
          icon: "pi pi-folder",
          children: unmatchedAccounts.map((account) => ({
            key: account.id,
            data: {
              ...account,
              tags: extractTagsFromName(account.name, tagConfigs),
            },
          })),
        }
      : null;

  return otherGroupNode ? [...configGroupNodes, otherGroupNode] : configGroupNodes;
}

/**
 * Gets the complete account tree from groups and accounts
 * Accounts are placed in the deepest matching group
 */
export function getAccountTree(
  accounts: Account[],
  groups: Group[],
  tagConfigs: TagConfig[] = []
): AccountGroupNode[] {
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

  console.log(
    "buildAccountTree(groups, accounts, tagConfigs)",
    buildAccountTree(groups, accounts, tagConfigs)
  );

  return buildAccountTree(groups, accounts, tagConfigs);
}
