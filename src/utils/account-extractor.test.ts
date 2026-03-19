import { describe, expect, it } from "vitest";
import type { Account, AccountGroupNode, Group } from "./account-extractor";
import { getAccountTree } from "./account-extractor";
import type { TagConfig } from "./config-schema";

// Test helper to create an account
function createAccount(id: string, name: string): Account {
  return {
    id,
    name,
    email: `${id}@example.com`,
  };
}

// Test helper to create a group
function createGroup(key: string, name: string, matcher?: string, children?: Group[]): Group {
  return {
    key,
    name,
    matcher,
    children,
  };
}

describe("getAccountTree", () => {
  describe("basic tree structure", () => {
    it("should create groups from config even with no matching accounts", () => {
      const groups: Group[] = [
        createGroup("prod", "Production", "prod-.*"),
        createGroup("dev", "Development", "dev-.*"),
      ];
      const accounts: Account[] = [];

      const result = getAccountTree(accounts, groups);

      expect(result).toHaveLength(2);
      expect(result[0].data.name).toBe("Production");
      expect(result[1].data.name).toBe("Development");
    });

    it("should place accounts in matching groups", () => {
      const groups: Group[] = [
        createGroup("prod", "Production", "prod-.*"),
        createGroup("dev", "Development", "dev-.*"),
      ];
      const accounts: Account[] = [
        createAccount("123", "prod-account-1"),
        createAccount("456", "dev-account-1"),
      ];

      const result = getAccountTree(accounts, groups);

      expect(result[0].data.name).toBe("Production");
      expect(result[0].children).toHaveLength(1);
      expect((result[0].children![0] as any).data.id).toBe("123");

      expect(result[1].data.name).toBe("Development");
      expect(result[1].children).toHaveLength(1);
      expect((result[1].children![0] as any).data.id).toBe("456");
    });

    it("should place unmatched accounts in 'Other' group", () => {
      const groups: Group[] = [createGroup("prod", "Production", "prod-.*")];
      const accounts: Account[] = [
        createAccount("123", "prod-account"),
        createAccount("456", "random-account"),
      ];

      const result = getAccountTree(accounts, groups);

      expect(result).toHaveLength(2);
      expect(result[1].data.name).toBe("Other");
      expect(result[1].children).toHaveLength(1);
      expect((result[1].children![0] as any).data.id).toBe("456");
    });

    it("should not create 'Other' group if all accounts match", () => {
      const groups: Group[] = [createGroup("prod", "Production", ".*")];
      const accounts: Account[] = [
        createAccount("123", "prod-account"),
        createAccount("456", "dev-account"),
      ];

      const result = getAccountTree(accounts, groups);

      expect(result).toHaveLength(1);
      expect(result[0].data.name).toBe("Production");
      expect(result[0].children).toHaveLength(2);
    });
  });

  describe("nested groups with accounts at second level", () => {
    it("should place accounts in second level groups", () => {
      const groups: Group[] = [
        createGroup("cloud", "Cloud Accounts", undefined, [
          createGroup("prod", "Production", "prod-.*"),
          createGroup("dev", "Development", "dev-.*"),
        ]),
      ];
      const accounts: Account[] = [
        createAccount("123", "prod-account-1"),
        createAccount("456", "dev-account-1"),
        createAccount("789", "other-account"),
      ];

      const result = getAccountTree(accounts, groups);

      expect(result).toHaveLength(2); // Cloud Accounts + Other
      const cloudGroup = result[0];
      expect(cloudGroup.data.name).toBe("Cloud Accounts");
      expect(cloudGroup.children).toHaveLength(2); // prod and dev groups

      // Children are sorted alphabetically
      const devGroup = cloudGroup.children![0] as AccountGroupNode;
      expect(devGroup.data.name).toBe("Development");
      expect(devGroup.children).toHaveLength(1);
      expect((devGroup.children![0] as any).data.id).toBe("456");

      const prodGroup = cloudGroup.children![1] as AccountGroupNode;
      expect(prodGroup.data.name).toBe("Production");
      expect(prodGroup.children).toHaveLength(1);
      expect((prodGroup.children![0] as any).data.id).toBe("123");

      expect(result[1].data.name).toBe("Other");
      expect((result[1].children![0] as any).data.id).toBe("789");
    });

    it("should include empty nested groups in the tree", () => {
      const groups: Group[] = [
        createGroup("cloud", "Cloud Accounts", undefined, [
          createGroup("prod", "Production", "prod-.*"),
          createGroup("dev", "Development", "dev-.*"),
          createGroup("staging", "Staging", "staging-.*"),
        ]),
      ];
      const accounts: Account[] = [createAccount("123", "prod-account")];

      const result = getAccountTree(accounts, groups);

      const cloudGroup = result[0];
      expect(cloudGroup.children).toHaveLength(3); // All three nested groups should be present
      expect(cloudGroup.children!.map((c) => (c as any).data.name)).toEqual([
        "Development",
        "Production",
        "Staging",
      ]);
    });

    it("should place accounts in deepest matching group", () => {
      const groups: Group[] = [
        createGroup("cloud", "Cloud Accounts", ".*-.*", [
          createGroup("prod", "Production", "prod-.*"),
          createGroup("dev", "Development", "dev-.*"),
        ]),
      ];
      const accounts: Account[] = [
        createAccount("123", "prod-account-1"),
        createAccount("456", "dev-account-1"),
      ];

      const result = getAccountTree(accounts, groups);

      const cloudGroup = result[0];
      // Accounts should be in the second-level groups, not in the parent
      expect(cloudGroup.children![0].children).toHaveLength(1);
      expect(cloudGroup.children![1].children).toHaveLength(1);
    });
  });

  describe("deeply nested groups", () => {
    it("should handle three levels of nesting", () => {
      const groups: Group[] = [
        createGroup("aws", "AWS Accounts", undefined, [
          createGroup("us", "US Region", undefined, [
            createGroup("dev", "Development", "dev-us-.*"),
            createGroup("prod", "Production", "prod-us-.*"),
          ]),
        ]),
      ];
      const accounts: Account[] = [
        createAccount("1", "prod-us-account"),
        createAccount("2", "dev-us-account"),
      ];

      const result = getAccountTree(accounts, groups);

      expect(result).toHaveLength(1);
      const awsGroup = result[0] as AccountGroupNode;
      expect(awsGroup.data.name).toBe("AWS Accounts");
      expect(awsGroup.children).toHaveLength(1);

      const usRegion = awsGroup.children![0] as AccountGroupNode;
      expect(usRegion.data.name).toBe("US Region");
      expect(usRegion.children).toHaveLength(2); // dev and prod groups

      // Children are sorted alphabetically
      const devGroup = usRegion.children![0] as AccountGroupNode;
      expect(devGroup.data.name).toBe("Development");
      expect(devGroup.children).toHaveLength(1);
      expect((devGroup.children![0] as any).data.id).toBe("2");

      const prodGroup = usRegion.children![1] as AccountGroupNode;
      expect(prodGroup.data.name).toBe("Production");
      expect(prodGroup.children).toHaveLength(1);
      expect((prodGroup.children![0] as any).data.id).toBe("1");
    });
  });

  describe("with tags", () => {
    it("should extract tags from matched accounts", () => {
      const tags: TagConfig[] = [
        { key: "prod", name: "Production", colour: "#FF0000", matcher: "prod-.*" },
      ];
      const groups: Group[] = [createGroup("prod", "Production", "prod-.*")];
      const accounts: Account[] = [createAccount("123", "prod-account-1")];

      const result = getAccountTree(accounts, groups, tags);

      const prodGroup = result[0];
      const accountNode = prodGroup.children![0] as any;
      expect(accountNode.data.tags).toContain("prod");
    });
  });

  describe("edge cases", () => {
    it("should handle accounts with multiple matching patterns at different levels", () => {
      const groups: Group[] = [
        createGroup("all", "All Accounts", ".*", [createGroup("prod", "Production", "prod-.*")]),
      ];
      const accounts: Account[] = [createAccount("123", "prod-account")];

      const result = getAccountTree(accounts, groups);

      const allGroup = result[0] as AccountGroupNode;
      // Account should be placed in the deepest matching group (prod), not in All
      expect(allGroup.children![0].children).toHaveLength(1);
    });

    it("should sort children by name", () => {
      const groups: Group[] = [
        createGroup("main", "Main", undefined, [
          createGroup("zebra", "Zebra Group", "zebra-.*"),
          createGroup("alpha", "Alpha Group", "alpha-.*"),
          createGroup("beta", "Beta Group", "beta-.*"),
        ]),
      ];
      const accounts: Account[] = [
        createAccount("1", "alpha-account"),
        createAccount("2", "beta-account"),
        createAccount("3", "zebra-account"),
      ];

      const result = getAccountTree(accounts, groups);

      const mainGroup = result[0] as AccountGroupNode;
      const groupNames = mainGroup.children!.map((c) => (c as any).data.name);
      expect(groupNames).toEqual(["Alpha Group", "Beta Group", "Zebra Group"]);
    });

    it("should handle empty groups array", () => {
      const accounts: Account[] = [
        createAccount("123", "account-1"),
        createAccount("456", "account-2"),
      ];

      const result = getAccountTree(accounts, []);

      expect(result).toHaveLength(1);
      expect(result[0].data.name).toBe("Other");
      expect(result[0].children).toHaveLength(2);
    });

    it("should handle empty accounts array", () => {
      const groups: Group[] = [
        createGroup("prod", "Production", "prod-.*"),
        createGroup("dev", "Development", "dev-.*"),
      ];

      const result = getAccountTree([], groups);

      expect(result).toHaveLength(2);
      expect(result[0].children).toBeUndefined();
      expect(result[1].children).toBeUndefined();
    });
  });
});
