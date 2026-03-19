import type { AccountGroupNode, AccountNode } from "./account-extractor";
import type { SortConfig, TagConfig } from "./config-schema";

/**
 * Test utility to create an account node for testing
 */
export function createAccountNode(id: string, name: string, tags?: string[]): AccountNode {
  return {
    key: `account-${id}`,
    data: {
      id,
      name,
      email: `${id}@example.com`,
      tags,
    },
  };
}

/**
 * Test utility to create a group node with accounts
 */
export function createGroupNode(
  key: string,
  name: string,
  children: AccountNode[]
): AccountGroupNode {
  return {
    key,
    data: { name },
    expandedByDefault: false,
    children,
  };
}

/**
 * Test utility to create a tag config
 */
export function createTagConfig(key: string, name: string, colour: string): TagConfig {
  return {
    key,
    name,
    colour,
  };
}

/**
 * Test utility to create a sort config
 */
export function createSortConfig(
  type: "nameSubstring" | "tags",
  direction: "asc" | "desc",
  matcher?: string
): SortConfig {
  return {
    type,
    direction,
    matcher,
  };
}
