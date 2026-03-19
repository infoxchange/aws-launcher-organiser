import type { Account, AccountGroupNode, AccountNode } from "./account-extractor";
import type { SortConfig, TagConfig } from "./config-schema";

/**
 * Compares two accounts based on tag configuration.
 * Returns -1 if a < b, 1 if a > b, 0 if equal.
 * Accounts WITH tags always sort before accounts WITHOUT tags (absolute rule).
 */
function compareByTags(
  a: Account,
  b: Account,
  tags: TagConfig[],
  direction: "asc" | "desc"
): number {
  const accountATags = a.tags || [];
  const accountBTags = b.tags || [];

  // Get indices of each account's tags from config
  const aTagIndices: number[] = [];
  const bTagIndices: number[] = [];

  for (const tagKey of accountATags) {
    const index = tags.findIndex((t) => t.key === tagKey);
    if (index !== -1) {
      aTagIndices.push(index);
    }
  }

  for (const tagKey of accountBTags) {
    const index = tags.findIndex((t) => t.key === tagKey);
    if (index !== -1) {
      bTagIndices.push(index);
    }
  }

  // Absolute rule: accounts with tags come first (not affected by direction)
  if (aTagIndices.length > 0 && bTagIndices.length === 0) {
    return -1; // a has tags, b doesn't → a comes first
  }
  if (aTagIndices.length === 0 && bTagIndices.length > 0) {
    return 1; // b has tags, a doesn't → a comes after
  }
  if (aTagIndices.length === 0 && bTagIndices.length === 0) {
    return 0; // neither has tags → equal
  }

  // Both have tags: sort by indices in config order
  aTagIndices.sort((x, y) => x - y);
  bTagIndices.sort((x, y) => x - y);

  let compareResult = 0;
  for (let i = 0; i < Math.max(aTagIndices.length, bTagIndices.length); i++) {
    const aIdx = aTagIndices[i] ?? Number.MAX_VALUE;
    const bIdx = bTagIndices[i] ?? Number.MAX_VALUE;

    if (aIdx !== bIdx) {
      compareResult = aIdx - bIdx;
      break;
    }
  }

  // Apply direction to the tag index comparison
  return direction === "desc" ? -compareResult : compareResult;
}

/**
 * Compares two accounts based on substring extraction from name.
 * Returns -1 if a < b, 1 if a > b, 0 if equal.
 */
function compareBySubstring(
  a: Account,
  b: Account,
  matcher: string,
  direction: "asc" | "desc"
): number {
  try {
    // Automatically add ^ and $ anchors if matcher doesn't contain either
    // This allows simple patterns like "dev-" to match full strings "^dev-$"
    // while respecting custom anchoring like "^(\\w+)-" (leaving it as-is)
    let pattern = matcher;
    if (!pattern.includes("^") && !pattern.includes("$")) {
      pattern = `^${pattern}$`;
    }

    const regex = new RegExp(pattern);
    const aMatch = a.name.match(regex);
    const bMatch = b.name.match(regex);

    // Extract value: use capture group if present, otherwise full match
    const aValue = aMatch ? aMatch[1] || aMatch[0] : null;
    const bValue = bMatch ? bMatch[1] || bMatch[0] : null;

    // Accounts with matches come first (not affected by direction)
    if (aValue && !bValue) {
      return -1; // a matches, b doesn't → a comes first
    }
    if (!aValue && bValue) {
      return 1; // b matches, a doesn't → a comes after
    }
    if (!aValue && !bValue) {
      return 0; // neither matches → equal
    }

    // Both match: compare string values
    const compareResult = (aValue || "").localeCompare(bValue || "");
    return direction === "desc" ? -compareResult : compareResult;
  } catch (err) {
    console.error("Error evaluating sort matcher regex:", err);
    return 0; // Ignore on error
  }
}

/**
 * Sorts accounts within groups based on sortBy configuration
 * @param nodes Account group nodes to sort
 * @param sortBy Sort configuration array
 * @param tags Available tags for reference
 * @returns Sorted account group nodes
 */
export function sortAccountsByConfig(
  nodes: AccountGroupNode[],
  sortBy: SortConfig[],
  tags: TagConfig[]
): AccountGroupNode[] {
  if (!sortBy || sortBy.length === 0) {
    return nodes;
  }

  return nodes.map((node) => {
    const groupNode = node as AccountGroupNode;
    const accountNodes = groupNode.children?.filter((child) => "id" in child.data) as
      | AccountNode[]
      | undefined;
    const nestedGroups = groupNode.children?.filter((child) => !("id" in child.data)) as
      | AccountGroupNode[]
      | undefined;

    if (!accountNodes || accountNodes.length === 0) {
      // No accounts to sort, but recursively sort nested groups
      if (nestedGroups && nestedGroups.length > 0) {
        const sortedNestedGroups = sortAccountsByConfig(nestedGroups, sortBy, tags);
        return {
          ...groupNode,
          children: sortedNestedGroups,
        };
      }
      return node;
    }

    // Sort accounts using the sort config array
    const sortedAccounts = [...accountNodes].sort((aNode, bNode) => {
      const a = aNode.data as Account;
      const b = bNode.data as Account;

      for (const config of sortBy) {
        let compareResult = 0;

        if (config.type === "tags" && tags && tags.length > 0) {
          compareResult = compareByTags(a, b, tags, config.direction);
        } else if (config.type === "nameSubstring" && config.matcher) {
          compareResult = compareBySubstring(a, b, config.matcher, config.direction);
        }

        // If this sort rule determined the order, return it
        if (compareResult !== 0) {
          return compareResult;
        }
      }

      // All sort rules were equal, maintain original order
      return 0;
    });

    // Recursively sort nested groups
    const sortedNestedGroups =
      nestedGroups && nestedGroups.length > 0
        ? sortAccountsByConfig(nestedGroups, sortBy, tags)
        : [];

    return {
      ...groupNode,
      children: [...(sortedAccounts as (AccountGroupNode | AccountNode)[]), ...sortedNestedGroups],
    };
  });
}
