import type { TreeNode } from "primereact/treenode";
import type { IconType } from "primereact/utils";
import type { PredefinedGroup, TagConfig } from "./configStore";

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
    await waitForElement(parentElement, 'a[data-testid="federation-link"]');
  }

  const container = parentElement.querySelector('div[data-testid="role-list-container"]');
  if (!container) return [];

  return Array.from(
    container.querySelectorAll<HTMLAnchorElement>('a[data-testid="federation-link"]')
  ).map((link) => ({
    name: link.textContent?.trim() ?? "",
    consoleUrl: link.href,
  }));
}

/**
 * Groups accounts by a pattern derived from display name, supporting nested groups
 */
export function groupAccountsByPattern(
  accounts: Account[],
  predefinedGroups: PredefinedGroup[],
  availableTags: TagConfig[] = []
): AccountGroupNode[] {
  // Defensive check: ensure predefinedGroups is an array
  if (!Array.isArray(predefinedGroups)) {
    console.error("groupAccountsByPattern received non-array predefinedGroups:", predefinedGroups);
    // Try to extract groups if it looks like a RemoteConfig object
    if (
      typeof predefinedGroups === "object" &&
      predefinedGroups !== null &&
      "groups" in predefinedGroups
    ) {
      const config = predefinedGroups as Record<string, unknown>;
      if (Array.isArray(config.groups)) {
        predefinedGroups = config.groups;
      } else {
        predefinedGroups = [];
      }
    } else {
      predefinedGroups = [];
    }
  }

  // Defensive check: ensure availableTags is an array
  if (!Array.isArray(availableTags)) {
    console.error("groupAccountsByPattern received non-array availableTags:", availableTags);
    // Try to extract tags if it looks like a RemoteConfig object
    if (typeof availableTags === "object" && availableTags !== null && "tags" in availableTags) {
      const config = availableTags as Record<string, unknown>;
      if (Array.isArray(config.tags)) {
        availableTags = config.tags;
      } else {
        availableTags = [];
      }
    } else {
      availableTags = [];
    }
  }

  /**
   * Test if an account name matches a matcher (single or multiple RegExps)
   */
  function testMatcher(matcher: string | string[] | undefined, accountName: string): boolean {
    if (!matcher) return false;

    const createRegex = (str: string): RegExp => new RegExp(`^${str}$`);

    if (Array.isArray(matcher)) {
      return matcher.some((m) => createRegex(m).test(accountName));
    }

    return createRegex(matcher).test(accountName);
  }

  /**
   * Extract tags from account name based on available tag keys
   */
  function extractTagsFromName(accountName: string, tagConfigs: TagConfig[]): string[] {
    const foundTags: string[] = [];
    for (const tag of tagConfigs) {
      let matches = false;
      // Use matcher if provided, otherwise fall back to suffix matching
      if (tag.matcher) {
        try {
          const regex = new RegExp(`^${tag.matcher}$`);
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
   * Recursively collect all account IDs that match any predefined group
   */
  function collectMatchedAccountIds(
    groupsToCheck: PredefinedGroup[],
    accountsToCheck: Account[]
  ): Set<string> {
    const matched = new Set<string>();
    groupsToCheck.forEach((group) => {
      accountsToCheck.forEach((account) => {
        if (testMatcher(group.matcher, account.name)) {
          matched.add(account.id);
        }
      });
      if (group.children) {
        const childMatched = collectMatchedAccountIds(group.children, accountsToCheck);
        for (const id of childMatched) {
          matched.add(id);
        }
      }
    });
    return matched;
  }

  /**
   * Build tree from predefined groups, placing accounts in their matching groups
   */
  function buildGroupTree(groupsToProcess: PredefinedGroup[]): AccountGroupNode[] {
    // Defensive check: ensure groupsToProcess is an array
    if (!Array.isArray(groupsToProcess)) {
      console.error("buildGroupTree received non-array value:", groupsToProcess);
      // Try to extract groups if it looks like a RemoteConfig object
      if (
        typeof groupsToProcess === "object" &&
        groupsToProcess !== null &&
        "groups" in groupsToProcess
      ) {
        const config = groupsToProcess as Record<string, unknown>;
        if (Array.isArray(config.groups)) {
          groupsToProcess = config.groups;
        } else {
          return [];
        }
      } else {
        return [];
      }
    }

    return groupsToProcess
      .map((group) => {
        // Find all accounts matching this group
        const matchingAccounts = accounts.filter((account) =>
          testMatcher(group.matcher, account.name)
        );

        // Build children: nested groups + matching accounts
        const children: (AccountGroupNode | AccountNode)[] = [];

        // Add nested groups if they exist
        if (group.children && group.children.length > 0) {
          children.push(...buildGroupTree(group.children));
        }

        // Add matching accounts that aren't already in nested groups
        const accountsInNestedGroups = new Set<string>();
        if (group.children) {
          group.children.forEach((child) => {
            accounts.forEach((account) => {
              if (testMatcher(child.matcher, account.name)) {
                accountsInNestedGroups.add(account.id);
              }
            });
          });
        }

        matchingAccounts.forEach((account) => {
          if (!accountsInNestedGroups.has(account.id)) {
            const accountNode: AccountNode = {
              key: account.id,
              data: {
                ...account,
                tags: extractTagsFromName(account.name, availableTags),
              } as Account,
              icon: "pi pi-box",
            };
            children.push(accountNode);
          }
        });

        children.sort((a, b) => {
          const getPrefix = (node: AccountGroupNode | AccountNode): string => {
            const name = node.data.name;
            // Remove any tag suffixes from the name for sorting
            const tagKeysAndNames = availableTags.flatMap((t) => [t.key, t.name.toLowerCase()]);
            let prefix = name;
            for (const tag of tagKeysAndNames) {
              if (prefix.endsWith(`-${tag}`)) {
                prefix = prefix.slice(0, -(tag.length + 1));
              }
            }
            return prefix;
          };

          const prefixA = getPrefix(a);
          const prefixB = getPrefix(b);
          if (prefixA !== prefixB) return prefixA.localeCompare(prefixB);

          // If prefixes are equal, compare by name
          return a.data.name.localeCompare(b.data.name);
        });

        const renderIconSrc = (src: string) => {
          const iconFunction: IconType<AccountGroupNode> = (options) => {
            const { ref, iconProps } = options;
            return <img src={src} {...iconProps} ref={ref} alt="" aria-hidden="true" />;
          };
          return iconFunction;
        };

        // Only include group if it has children or matching accounts
        if (children.length > 0) {
          return {
            key: `group-${group.key}`,
            data: {
              name: group.name,
            },
            expandedByDefault: group.expandedByDefault ?? false,
            icon: group.icon ? renderIconSrc(group.icon) : "pi pi-folder",
            children,
          };
        }

        return null;
      })
      .filter((group) => group !== null) as AccountGroupNode[];
  }

  // Build predefined groups
  const predefinedGroupNodes = buildGroupTree(predefinedGroups);

  // Find accounts that don't match any predefined group
  const matchedAccountIds = collectMatchedAccountIds(predefinedGroups, accounts);
  const unmatchedAccounts = accounts.filter((account) => !matchedAccountIds.has(account.id));

  // Group unmatched accounts by first word (prefix)
  const prefixGroups = new Map<string, Account[]>();
  unmatchedAccounts.forEach((account) => {
    const parts = account.name.toLowerCase().split(/[-_\s]/);
    const prefix = parts.length > 0 && parts[0] ? parts[0] : "other";
    if (!prefixGroups.has(prefix)) {
      prefixGroups.set(prefix, []);
    }
    const groupAccounts = prefixGroups.get(prefix);
    if (groupAccounts) {
      groupAccounts.push(account);
    }
  });

  // Convert prefix groups to tree nodes
  const prefixGroupNodes: AccountGroupNode[] = Array.from(prefixGroups.entries()).map(
    ([prefix, prefixAccounts]) => {
      const groupName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
      return {
        key: `group-${prefix}`,
        data: {
          name: groupName,
        },
        children: prefixAccounts.map((account) => ({
          key: account.id,
          data: {
            ...account,
            tags: extractTagsFromName(account.name, availableTags),
          },
        })),
      };
    }
  );

  console.log("Predefined groups built:", [...predefinedGroupNodes, ...prefixGroupNodes]);

  return [...predefinedGroupNodes, ...prefixGroupNodes];
}
