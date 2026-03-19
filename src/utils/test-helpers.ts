import type { AccountGroupNode, AccountNode } from "./account-extractor";
import type { SortConfig, TagConfig } from "./config-schema";

/**
 * Mixed node type for test access - represents either group or account
 */
export type TestNode = AccountGroupNode | AccountNode;

/**
 * Type guard to check if a node is an AccountNode (has actual account data)
 */
export function isAccountNode(node: TestNode): node is AccountNode {
  return "id" in node.data;
}

/**
 * Safely get account ID from a node, asserting it's an account node
 */
export function getNodeId(node: TestNode): string {
  if (isAccountNode(node)) {
    return node.data.id;
  }
  // Should not reach here in well-formed tests
  throw new Error(`Expected account node but got group node: ${node.data.name}`);
}

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
