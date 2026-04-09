import { describe, expect, it, vi } from "vitest";

import type { AccountGroupNode } from "./account-extractor";
import type { SortConfig } from "./config-schema";
import { sortAccountsByConfig } from "./sortAccounts";
import {
  createAccountNode,
  createGroupNode,
  createTagConfig,
  getNodeId,
  type TestNode,
} from "./test-helpers";

describe("sortAccountsByConfig", () => {
  describe("no sorting config", () => {
    it("should return nodes unchanged when sortBy is empty", () => {
      const account1 = createAccountNode("123", "Account B");
      const account2 = createAccountNode("456", "Account A");
      const group = createGroupNode("group-1", "Test Group", [account1, account2]);

      const result = sortAccountsByConfig([group], [], []) as AccountGroupNode[];

      expect(result[0].children).toEqual([account1, account2]);
    });

    it("should return nodes unchanged when sortBy is undefined", () => {
      const account1 = createAccountNode("123", "Account B");
      const account2 = createAccountNode("456", "Account A");
      const group = createGroupNode("group-1", "Test Group", [account1, account2]);

      const result = sortAccountsByConfig([group], undefined, []) as AccountGroupNode[];

      expect(result[0].children).toEqual([account1, account2]);
    });
  });

  describe("tag sorting - ascending", () => {
    it("should sort accounts by tag order (ascending)", () => {
      const tags = [
        createTagConfig("dev", "Development", "#FF0000"),
        createTagConfig("test", "Testing", "#00FF00"),
        createTagConfig("uat", "UAT", "#0000FF"),
        createTagConfig("prod", "Production", "#FFFF00"),
      ];

      const account1 = createAccountNode("111", "Account with prod", ["prod"]);
      const account2 = createAccountNode("222", "Account with dev", ["dev"]);
      const account3 = createAccountNode("333", "Account with test", ["test"]);
      const account4 = createAccountNode("444", "Account with uat", ["uat"]);

      const group = createGroupNode("group-1", "Test Group", [
        account1,
        account2,
        account3,
        account4,
      ]);

      const sortConfig: SortConfig[] = [{ type: "tags", direction: "asc" }];

      const result = sortAccountsByConfig([group], sortConfig, tags) as AccountGroupNode[];
      const sortedChildren: TestNode[] = result[0].children ?? [];

      expect(getNodeId(sortedChildren[0])).toBe("222"); // dev
      expect(getNodeId(sortedChildren[1])).toBe("333"); // test
      expect(getNodeId(sortedChildren[2])).toBe("444"); // uat
      expect(getNodeId(sortedChildren[3])).toBe("111"); // prod
    });

    it("should sort accounts by tag order when account has multiple tags", () => {
      const tags = [
        createTagConfig("dev", "Development", "#FF0000"),
        createTagConfig("test", "Testing", "#00FF00"),
        createTagConfig("uat", "UAT", "#0000FF"),
      ];

      const account1 = createAccountNode("111", "Account A", ["uat", "dev"]);
      const account2 = createAccountNode("222", "Account B", ["test", "prod"]);

      const group = createGroupNode("group-1", "Test Group", [account1, account2]);

      const sortConfig: SortConfig[] = [{ type: "tags", direction: "asc" }];

      const result = sortAccountsByConfig([group], sortConfig, tags) as AccountGroupNode[];
      const sortedChildren: TestNode[] = result[0].children ?? [];

      // account1 has tags [dev, uat] → first matching is dev (index 0)
      // account2 has tags [test] → first matching is test (index 1)
      // So account1 should come first
      expect(getNodeId(sortedChildren[0])).toBe("111");
      expect(getNodeId(sortedChildren[1])).toBe("222");
    });

    it("should place accounts without tags at the end (ascending)", () => {
      const tags = [
        createTagConfig("dev", "Development", "#FF0000"),
        createTagConfig("test", "Testing", "#00FF00"),
      ];

      const account1 = createAccountNode("111", "Account with tag", ["dev"]);
      const account2 = createAccountNode("222", "Account without tag");

      const group = createGroupNode("group-1", "Test Group", [account2, account1]);

      const sortConfig: SortConfig[] = [{ type: "tags", direction: "asc" }];

      const result = sortAccountsByConfig([group], sortConfig, tags) as AccountGroupNode[];
      const sortedChildren: TestNode[] = result[0].children ?? [];

      expect(getNodeId(sortedChildren[0])).toBe("111"); // with tag
      expect(getNodeId(sortedChildren[1])).toBe("222"); // without tag
    });
  });

  describe("tag sorting - descending", () => {
    it("should sort accounts by tag order (descending)", () => {
      const tags = [
        createTagConfig("dev", "Development", "#FF0000"),
        createTagConfig("test", "Testing", "#00FF00"),
        createTagConfig("uat", "UAT", "#0000FF"),
        createTagConfig("prod", "Production", "#FFFF00"),
      ];

      const account1 = createAccountNode("111", "Account with dev", ["dev"]);
      const account2 = createAccountNode("222", "Account with test", ["test"]);
      const account3 = createAccountNode("333", "Account with uat", ["uat"]);
      const account4 = createAccountNode("444", "Account with prod", ["prod"]);

      const group = createGroupNode("group-1", "Test Group", [
        account1,
        account2,
        account3,
        account4,
      ]);

      const sortConfig: SortConfig[] = [{ type: "tags", direction: "desc" }];

      const result = sortAccountsByConfig([group], sortConfig, tags) as AccountGroupNode[];
      const sortedChildren: TestNode[] = result[0].children ?? [];

      expect(getNodeId(sortedChildren[0])).toBe("444"); // prod (index 3)
      expect(getNodeId(sortedChildren[1])).toBe("333"); // uat (index 2)
      expect(getNodeId(sortedChildren[2])).toBe("222"); // test (index 1)
      expect(getNodeId(sortedChildren[3])).toBe("111"); // dev (index 0)
    });

    it("should place accounts without tags at the end (descending)", () => {
      const tags = [
        createTagConfig("dev", "Development", "#FF0000"),
        createTagConfig("test", "Testing", "#00FF00"),
      ];

      const account1 = createAccountNode("111", "Account with tag", ["test"]);
      const account2 = createAccountNode("222", "Account without tag");

      const group = createGroupNode("group-1", "Test Group", [account1, account2]);

      const sortConfig: SortConfig[] = [{ type: "tags", direction: "desc" }];

      const result = sortAccountsByConfig([group], sortConfig, tags) as AccountGroupNode[];
      const sortedChildren: TestNode[] = result[0].children ?? [];

      // With tag should come first, without tag at end (accounts without tags get MAX_VALUE)
      expect(getNodeId(sortedChildren[0])).toBe("111"); // with tag (test at index 1)
      expect(getNodeId(sortedChildren[1])).toBe("222"); // without tag
    });
  });

  describe("nameSubstring sorting - ascending", () => {
    it("should sort accounts by extracted substring (ascending)", () => {
      const account1 = createAccountNode("111", "prod-aws-account");
      const account2 = createAccountNode("222", "dev-aws-account");
      const account3 = createAccountNode("333", "test-aws-account");

      const group = createGroupNode("group-1", "Test Group", [account1, account2, account3]);

      const sortConfig: SortConfig[] = [
        { type: "nameSubstring", direction: "asc", matcher: "^(\\w+)-" },
      ];

      const result = sortAccountsByConfig([group], sortConfig, []) as AccountGroupNode[];
      const sortedChildren: TestNode[] = result[0].children ?? [];

      expect(getNodeId(sortedChildren[0])).toBe("222"); // dev
      expect(getNodeId(sortedChildren[1])).toBe("111"); // prod
      expect(getNodeId(sortedChildren[2])).toBe("333"); // test
    });

    it("should sort by full match when no capture group", () => {
      const account1 = createAccountNode("111", "account-xyz");
      const account2 = createAccountNode("222", "account-abc");
      const account3 = createAccountNode("333", "account-mno");

      const group = createGroupNode("group-1", "Test Group", [account1, account2, account3]);

      const sortConfig: SortConfig[] = [
        { type: "nameSubstring", direction: "asc", matcher: "account-\\w+" },
      ];

      const result = sortAccountsByConfig([group], sortConfig, []) as AccountGroupNode[];
      const sortedChildren: TestNode[] = result[0].children ?? [];

      // Sorted by locale comparison of "account-xyz", "account-abc", "account-mno"
      expect(getNodeId(sortedChildren[0])).toBe("222"); // account-abc
      expect(getNodeId(sortedChildren[1])).toBe("333"); // account-mno
      expect(getNodeId(sortedChildren[2])).toBe("111"); // account-xyz
    });

    it("should place accounts without match at the end (ascending)", () => {
      const account1 = createAccountNode("111", "prod-account");
      const account2 = createAccountNode("222", "no-match-here");

      const group = createGroupNode("group-1", "Test Group", [account2, account1]);

      const sortConfig: SortConfig[] = [
        { type: "nameSubstring", direction: "asc", matcher: "^(\\w+)-account$" },
      ];

      const result = sortAccountsByConfig([group], sortConfig, []) as AccountGroupNode[];
      const sortedChildren: TestNode[] = result[0].children ?? [];

      expect(getNodeId(sortedChildren[0])).toBe("111"); // matches pattern
      expect(getNodeId(sortedChildren[1])).toBe("222"); // no match
    });
  });

  describe("nameSubstring sorting - descending", () => {
    it("should sort accounts by extracted substring (descending)", () => {
      const account1 = createAccountNode("111", "prod-aws-account");
      const account2 = createAccountNode("222", "dev-aws-account");
      const account3 = createAccountNode("333", "test-aws-account");

      const group = createGroupNode("group-1", "Test Group", [account1, account2, account3]);

      const sortConfig: SortConfig[] = [
        { type: "nameSubstring", direction: "desc", matcher: "^(\\w+)-" },
      ];

      const result = sortAccountsByConfig([group], sortConfig, []) as AccountGroupNode[];
      const sortedChildren: TestNode[] = result[0].children ?? [];

      expect(getNodeId(sortedChildren[0])).toBe("333"); // test
      expect(getNodeId(sortedChildren[1])).toBe("111"); // prod
      expect(getNodeId(sortedChildren[2])).toBe("222"); // dev
    });
  });

  describe("multiple sorting rules", () => {
    it("should apply rules sequentially (primary, then secondary)", () => {
      const tags = [
        createTagConfig("dev", "Development", "#FF0000"),
        createTagConfig("test", "Testing", "#00FF00"),
      ];

      // Accounts: some with dev tag (should sort by name), some with test tag (should sort by name)
      const account1 = createAccountNode("111", "Zebra", ["dev"]);
      const account2 = createAccountNode("222", "Apple", ["dev"]);
      const account3 = createAccountNode("333", "Yak", ["test"]);
      const account4 = createAccountNode("444", "Banana", ["test"]);

      const group = createGroupNode("group-1", "Test Group", [
        account1,
        account2,
        account3,
        account4,
      ]);

      const sortConfig: SortConfig[] = [
        // First: sort by tag order
        { type: "tags", direction: "asc" },
        // Second: sort by name (for same tag)
        {
          type: "nameSubstring",
          direction: "asc",
          matcher: "^(\\w+)",
        },
      ];

      const result = sortAccountsByConfig([group], sortConfig, tags) as AccountGroupNode[];
      const sortedChildren: TestNode[] = result[0].children ?? [];

      // All dev accounts should come before test accounts
      // Within each tag group, should be sorted by name
      expect(getNodeId(sortedChildren[0])).toBe("222"); // Apple with dev
      expect(getNodeId(sortedChildren[1])).toBe("111"); // Zebra with dev
      expect(getNodeId(sortedChildren[2])).toBe("444"); // Banana with test
      expect(getNodeId(sortedChildren[3])).toBe("333"); // Yak with test
    });
  });

  describe("multiple groups", () => {
    it("should sort accounts within each group independently", () => {
      const tags = [
        createTagConfig("dev", "Development", "#FF0000"),
        createTagConfig("prod", "Production", "#FFFF00"),
      ];

      const account1 = createAccountNode("111", "Account prod", ["prod"]);
      const account2 = createAccountNode("222", "Account dev", ["dev"]);

      const account3 = createAccountNode("333", "Another prod", ["prod"]);
      const account4 = createAccountNode("444", "Another dev", ["dev"]);

      const group1 = createGroupNode("group-1", "Group 1", [account1, account2]);
      const group2 = createGroupNode("group-2", "Group 2", [account3, account4]);

      const sortConfig: SortConfig[] = [{ type: "tags", direction: "asc" }];

      const result = sortAccountsByConfig([group1, group2], sortConfig, tags) as AccountGroupNode[];

      const sortedGroup1: TestNode[] = result[0].children ?? [];
      const sortedGroup2: TestNode[] = result[1].children ?? [];

      // Group 1: dev should come before prod
      expect(getNodeId(sortedGroup1[0])).toBe("222"); // dev
      expect(getNodeId(sortedGroup1[1])).toBe("111"); // prod

      // Group 2: dev should come before prod
      expect(getNodeId(sortedGroup2[0])).toBe("444"); // dev
      expect(getNodeId(sortedGroup2[1])).toBe("333"); // prod
    });
  });

  describe("edge cases", () => {
    it("should handle accounts with no tags config", () => {
      const account1 = createAccountNode("111", "Account A");
      const account2 = createAccountNode("222", "Account B");

      const group = createGroupNode("group-1", "Test Group", [account1, account2]);

      const sortConfig: SortConfig[] = [{ type: "tags", direction: "asc" }];

      const result = sortAccountsByConfig([group], sortConfig, []) as AccountGroupNode[];

      // Should maintain original order when no tags config
      expect(result[0].children).toEqual([account1, account2]);
    });

    it("should handle empty groups", () => {
      const group = createGroupNode("group-1", "Empty Group", []);

      const sortConfig: SortConfig[] = [{ type: "tags", direction: "asc" }];

      const result = sortAccountsByConfig([group], sortConfig, []) as AccountGroupNode[];

      expect(result[0].children).toEqual([]);
    });

    it("should skip invalid regex patterns gracefully", () => {
      const account1 = createAccountNode("111", "Account A");
      const account2 = createAccountNode("222", "Account B");

      const group = createGroupNode("group-1", "Test Group", [account1, account2]);

      const sortConfig: SortConfig[] = [
        { type: "nameSubstring", direction: "asc", matcher: "[invalid(regex" },
      ];

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = sortAccountsByConfig([group], sortConfig, []) as AccountGroupNode[];
      errorSpy.mockRestore();
      expect(result[0].children).toEqual([account1, account2]);
    });
  });

  describe("nested groups", () => {
    it("should sort accounts in nested groups", () => {
      const tags = [
        createTagConfig("dev", "Development", "#FF0000"),
        createTagConfig("prod", "Production", "#FFFF00"),
      ];

      // Nested structure: main group contains a nested group which contains accounts
      const nestedAccount1 = createAccountNode("111", "Account prod", ["prod"]);
      const nestedAccount2 = createAccountNode("222", "Account dev", ["dev"]);
      const nestedGroup = createGroupNode("nested-group", "Nested Group", [
        nestedAccount1,
        nestedAccount2,
      ]);

      // Add nested group as a child of main group
      const mainGroup: AccountGroupNode = {
        key: "main-group",
        data: { name: "Main Group" },
        children: [nestedGroup],
      };

      const sortConfig: SortConfig[] = [{ type: "tags", direction: "asc" }];

      const result = sortAccountsByConfig([mainGroup], sortConfig, tags) as AccountGroupNode[];

      // Main group still contains the nested group
      const resultContents: TestNode[] = result[0].children ?? [];
      expect(resultContents).toHaveLength(1);
      // Nested group should be sorted internally
      const sortedNestedGroup = resultContents[0] as AccountGroupNode;
      const sortedAccounts: TestNode[] = sortedNestedGroup.children ?? [];
      expect(getNodeId(sortedAccounts[0])).toBe("222"); // dev
      expect(getNodeId(sortedAccounts[1])).toBe("111"); // prod
    });

    it("should sort accounts in multiple levels of nesting", () => {
      const tags = [
        createTagConfig("dev", "Development", "#FF0000"),
        createTagConfig("prod", "Production", "#FFFF00"),
      ];

      // Create deeply nested structure
      const deepAccount1 = createAccountNode("111", "Account prod", ["prod"]);
      const deepAccount2 = createAccountNode("222", "Account dev", ["dev"]);
      const deepGroup = createGroupNode("deep-group", "Deep Group", [deepAccount1, deepAccount2]);

      const midAccount1 = createAccountNode("333", "Mid prod", ["prod"]);
      const midAccount2 = createAccountNode("444", "Mid dev", ["dev"]);
      const midGroup: AccountGroupNode = {
        key: "mid-group",
        data: { name: "Mid Group" },
        children: [deepGroup, midAccount1, midAccount2],
      };

      const sortConfig: SortConfig[] = [{ type: "tags", direction: "asc" }];

      const result = sortAccountsByConfig([midGroup], sortConfig, tags) as AccountGroupNode[];

      // Check mid-level accounts are sorted
      const resultChildren = result[0].children ?? [];
      const accountsInMid = resultChildren.filter((child) => "id" in child.data);
      const groupsInMid = resultChildren.filter((child) => !("id" in child.data));

      // Dev accounts should come before prod
      expect(getNodeId(accountsInMid[0])).toBe("444"); // mid dev
      expect(getNodeId(accountsInMid[1])).toBe("333"); // mid prod

      // Deep group should still be there
      expect(groupsInMid).toHaveLength(1);
      const deepGroupResult = groupsInMid[0] as AccountGroupNode;
      const deepGroupAccounts: TestNode[] = deepGroupResult.children ?? [];
      expect(getNodeId(deepGroupAccounts[0])).toBe("222"); // deep dev
      expect(getNodeId(deepGroupAccounts[1])).toBe("111"); // deep prod
    });

    it("should sort multiple nested groups independently", () => {
      const tags = [
        createTagConfig("dev", "Development", "#FF0000"),
        createTagConfig("prod", "Production", "#FFFF00"),
      ];

      // Create two nested groups with different account orders
      const nested1Account1 = createAccountNode("111", "Account prod", ["prod"]);
      const nested1Account2 = createAccountNode("222", "Account dev", ["dev"]);
      const nestedGroup1 = createGroupNode("nested-1", "Nested 1", [
        nested1Account1,
        nested1Account2,
      ]);

      const nested2Account1 = createAccountNode("333", "Another prod", ["prod"]);
      const nested2Account2 = createAccountNode("444", "Another dev", ["dev"]);
      const nestedGroup2 = createGroupNode("nested-2", "Nested 2", [
        nested2Account1,
        nested2Account2,
      ]);

      const mainGroup: AccountGroupNode = {
        key: "main",
        data: { name: "Main" },
        children: [nestedGroup1, nestedGroup2],
      };

      const sortConfig: SortConfig[] = [{ type: "tags", direction: "asc" }];

      const result = sortAccountsByConfig([mainGroup], sortConfig, tags) as AccountGroupNode[];
      const resultChildren = result[0].children ?? [];

      // Check first nested group is sorted
      const sorted1 = resultChildren[0] as AccountGroupNode;
      const accounts1: TestNode[] = sorted1.children ?? [];
      expect(getNodeId(accounts1[0])).toBe("222"); // dev
      expect(getNodeId(accounts1[1])).toBe("111"); // prod

      // Check second nested group is sorted
      const sorted2 = resultChildren[1] as AccountGroupNode;
      const accounts2: TestNode[] = sorted2.children ?? [];
      expect(getNodeId(accounts2[0])).toBe("444"); // dev
      expect(getNodeId(accounts2[1])).toBe("333"); // prod
    });
  });
});
