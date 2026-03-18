import { Tree } from "primereact/tree";
import { Button } from "primereact/button";
import { ButtonGroup } from "primereact/buttongroup";
import { Dialog } from "primereact/dialog";
import type React from "react";
import { useEffect, useState } from "react";
import "primereact/resources/themes/lara-light-blue/theme.css";
import "primereact/resources/primereact.css";
import "primeicons/primeicons.css";
import "./AccountTreeTable.css";
import {
  type Account,
  type AccountGroupNode,
  type AccountNode,
  type AccountRole,
  environments,
  type Environment,
  extractAccounts,
  getAccountRoles,
  groupAccountsByPattern,
} from "../utils/account-extractor";
import { useGroupsStore } from "../utils/groupsStore";
import { TreeNode } from "primereact/treenode";

export interface AccountTreeTableProps {
  onAccountSelect?: (accountId: string) => void;
}

function collectExpandedKeys(nodes: (AccountGroupNode | AccountNode)[]): Record<string, boolean> {
  const keys: Record<string, boolean> = {};
  for (const node of nodes) {
    if ("expandedByDefault" in node && node.expandedByDefault) {
      keys[node.key] = true;
    }
    if (node.children) {
      Object.assign(keys, collectExpandedKeys(node.children as (AccountGroupNode | AccountNode)[]));
    }
  }
  return keys;
}

function filterNodes(
  nodes: (AccountGroupNode | AccountNode)[],
  selectedEnvs: Set<Environment>
): (AccountGroupNode | AccountNode)[] {
  return nodes.reduce<(AccountGroupNode | AccountNode)[]>((acc, node) => {
    if ("id" in node.data) {
      // Account node — keep if its environment is selected
      const env = (node.data as Account).environment;
      if (env !== undefined && selectedEnvs.has(env)) acc.push(node);
    } else {
      // Group node — recurse and only keep if children remain
      const filteredChildren = filterNodes((node as AccountGroupNode).children ?? [], selectedEnvs);
      if (filteredChildren.length > 0) {
        acc.push({ ...node, children: filteredChildren } as AccountGroupNode);
      }
    }
    return acc;
  }, []);
}

function searchFilterNodes(
  nodes: (AccountGroupNode | AccountNode)[],
  query: string
): (AccountGroupNode | AccountNode)[] {
  if (!query.trim()) return nodes;

  const lowerQuery = query.toLowerCase();
  return nodes.reduce<(AccountGroupNode | AccountNode)[]>((acc, node) => {
    if ("id" in node.data) {
      // Account node — keep if name matches
      const account = node.data as Account;
      if (account.name.toLowerCase().includes(lowerQuery) || account.id.includes(query)) {
        acc.push(node);
      }
    } else {
      // Group node — recurse and keep if children match
      const filteredChildren = searchFilterNodes((node as AccountGroupNode).children ?? [], query);
      if (filteredChildren.length > 0) {
        acc.push({ ...node, children: filteredChildren } as AccountGroupNode);
      }
    }
    return acc;
  }, []);
}

function countAllAccounts(nodes: (AccountGroupNode | AccountNode)[]): number {
  let count = 0;
  for (const node of nodes) {
    if ("id" in node.data) {
      count++;
    } else if ((node as AccountGroupNode).children) {
      count += countAllAccounts((node as AccountGroupNode).children!);
    }
  }
  return count;
}

function setAccountRoles(
  nodes: AccountGroupNode[],
  accountId: string,
  roles: AccountRole[]
): AccountGroupNode[] {
  return nodes.map((node) => ({
    ...node,
    children: node.children?.map((child) => {
      if ("id" in child.data && (child.data as Account).id === accountId) {
        return { ...child, data: { ...child.data, roles } } as AccountNode;
      }
      if ("children" in child) {
        return setAccountRoles([child as AccountGroupNode], accountId, roles)[0];
      }
      return child;
    }),
  }));
}

function loadRolesForExpandedGroups(
  nodes: (AccountGroupNode | AccountNode)[],
  onLoad: (accountId: string) => Promise<void>
): void {
  for (const node of nodes) {
    if ("id" in node.data) continue; // account node, skip
    const group = node as AccountGroupNode;
    if (group.expandedByDefault) {
      for (const child of group.children ?? []) {
        if ("id" in child.data) {
          onLoad((child.data as Account).id).catch(console.error);
        }
      }
    }
    if (group.children) {
      loadRolesForExpandedGroups(group.children, onLoad);
    }
  }
}

export const AccountTreeTable: React.FC<AccountTreeTableProps> = () => {
  const { groups, setGroups } = useGroupsStore();
  const [nodes, setNodes] = useState<AccountGroupNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
  const [selectedEnvs, setSelectedEnvs] = useState<Set<Environment>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [jsonConfig, setJsonConfig] = useState(JSON.stringify(groups, null, 2));
  const [configError, setConfigError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");

  useEffect(() => {
    // Extract and group accounts from the page
    const accounts = extractAccounts();
    const grouped = groupAccountsByPattern(accounts, groups);
    setNodes(grouped);
    setExpandedKeys(collectExpandedKeys(grouped));
    loadRolesForExpandedGroups(grouped, async (accountId) => {
      const roles = await getAccountRoles(accountId);
      setNodes((prev) => setAccountRoles(prev, accountId, roles));
    });
  }, [groups]);

  useEffect(() => {
    // Update JSON config when groups change
    setJsonConfig(JSON.stringify(groups, null, 2));
  }, [groups]);

  /**
   * Render custom template for each tree node
   */
  const getEnvironmentColor = (env: Environment | undefined, accountName: string): string => {
    if (accountName.endsWith("-sandbox")) {
      return "#22c55e"; // Green
    }
    switch (env) {
      case "dev":
        return "#22c55e"; // Green
      case "test":
        return "#eab308"; // Greenish yellow
      case "uat":
        return "#f97316"; // Orange
      case "prod":
        return "#ef4444"; // Red
      default:
        return "#9ca3af"; // Gray for unknown
    }
  };

  const nodeTemplate = (node: TreeNode) => {
    const data = node.data;

    // Account node - has an id property
    if ("id" in data) {
      const account = data as Account;
      return (
        <div className="account-node">
          {(account.environment || account.name.endsWith("-sandbox")) && (
            <span
              className="environment-dot"
              style={{
                backgroundColor: getEnvironmentColor(account.environment, account.name),
                display: "inline-block",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                marginRight: "6px",
                verticalAlign: "middle",
              }}
            />
          )}
          <span className="account-name">{account.name}</span>
          <span className="account-id"> ({account.id})</span>
          {account.roles ? (
            <div className="account-roles">
              {account.roles.map((role) => (
                <a
                  key={role.name}
                  href={role.consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="account-role-link"
                >
                  {role.name}
                </a>
              ))}
            </div>
          ) : (
            <Button
              size="small"
              text
              label="Load roles"
              onClick={(e) => {
                e.stopPropagation();
                getAccountRoles(account.id)
                  .then((roles) => {
                    setNodes((prev) => setAccountRoles(prev, account.id, roles));
                  })
                  .catch(console.error);
              }}
            />
          )}
        </div>
      );
    }

    // Group node - just name
    const groupKey = node.key as string;
    const isEditing = editMode && editingGroupKey === groupKey;

    if (isEditing) {
      return (
        <div className="group-edit-container" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={editingGroupName}
            onChange={(e) => setEditingGroupName(e.target.value)}
            className="group-edit-input"
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                updateGroupName(groupKey, editingGroupName);
                setEditingGroupKey(null);
              } else if (e.key === "Escape") {
                setEditingGroupKey(null);
              }
            }}
            onBlur={() => {
              updateGroupName(groupKey, editingGroupName);
              setEditingGroupKey(null);
            }}
          />
        </div>
      );
    }

    return (
      <span
        className={`group-name ${editMode ? "group-name-editable" : ""}`}
        onClick={(e) => {
          if (editMode) {
            e.stopPropagation();
            setEditingGroupKey(groupKey);
            setEditingGroupName(data?.name || "");
          }
        }}
      >
        {data?.name} ({countAllAccounts((node as AccountGroupNode).children ?? [])})
      </span>
    );
  };

  const loadRolesForChildren = (groupNode: TreeNode) => {
    const children = (groupNode as AccountGroupNode).children ?? [];
    for (const child of children) {
      if ("id" in child.data && !(child.data as Account).roles) {
        const account = child.data as Account;
        getAccountRoles(account.id)
          .then((roles) => {
            setNodes((prev) => setAccountRoles(prev, account.id, roles));
          })
          .catch(console.error);
      }
    }
  };

  const toggleEnv = (env: Environment) => {
    setSelectedEnvs((prev) => {
      const next = new Set(prev);
      next.has(env) ? next.delete(env) : next.add(env);
      return next;
    });
  };

  const updateGroupName = (groupKey: string, newName: string) => {
    // Extract the actual group key (remove "group-" prefix)
    const actualGroupKey = groupKey.startsWith("group-") ? groupKey.substring(6) : groupKey;

    const updateInGroups = (groupsToUpdate: typeof groups): typeof groups => {
      return groupsToUpdate.map((group) => {
        if (group.key === actualGroupKey) {
          return { ...group, name: newName };
        }
        if (group.children) {
          return {
            ...group,
            children: updateInGroups(group.children),
          };
        }
        return group;
      });
    };

    const updated = updateInGroups(groups);
    setGroups(updated);
  };

  const visibleNodes = (() => {
    let filtered = nodes;

    if (selectedEnvs.size > 0) {
      filtered = filterNodes(filtered, selectedEnvs) as AccountGroupNode[];
    }

    if (searchQuery.trim()) {
      filtered = searchFilterNodes(filtered, searchQuery) as AccountGroupNode[];
    }

    return filtered;
  })();

  return (
    <div>
      <div className="filter-controls">
        <div className="group">
          <input
            type="text"
            placeholder="Search accounts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <ButtonGroup>
            {environments.map((env) => (
              <Button
                key={env}
                label={env}
                rounded
                outlined={!selectedEnvs.has(env)}
                onClick={() => toggleEnv(env)}
              />
            ))}
          </ButtonGroup>
        </div>
        <div className="group">
          <Button
            icon="pi pi-pencil"
            label={editMode ? "Stop Editing" : undefined}
            rounded
            text
            onClick={() => setEditMode(!editMode)}
            className={`edit-button ${editMode ? "edit-button-active" : ""}`}
          />
          <Button
            icon="pi pi-cog"
            rounded
            text
            onClick={() => {
              setShowSettings(true);
              setJsonConfig(JSON.stringify(groups, null, 2));
              setConfigError(null);
            }}
            className="settings-button"
          />
        </div>
      </div>
      <Dialog
        header="Settings"
        visible={showSettings}
        onHide={() => {
          setShowSettings(false);
          setJsonConfig(JSON.stringify(groups, null, 2));
          setConfigError(null);
        }}
        modal
        style={{ width: "50vw" }}
      >
        <div className="settings-content">
          <label htmlFor="json-config">Configuration (JSON)</label>
          <textarea
            id="json-config"
            value={jsonConfig}
            onChange={(e) => {
              setJsonConfig(e.target.value);
              setConfigError(null);
            }}
            rows={10}
            className="json-textarea"
          />
          {configError && <div className="config-error">{configError}</div>}
          <div className="dialog-buttons">
            <Button
              label="Save"
              onClick={() => {
                try {
                  const parsed = JSON.parse(jsonConfig);
                  setGroups(parsed);
                  setShowSettings(false);
                  setConfigError(null);
                } catch (e) {
                  setConfigError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
              className="save-button"
            />
            <Button
              label="Reset to Defaults"
              outlined
              onClick={() => {
                const { resetToDefaults } = useGroupsStore.getState();
                resetToDefaults();
                setJsonConfig(JSON.stringify(useGroupsStore.getState().groups, null, 2));
                setConfigError(null);
              }}
            />
            <Button
              label="Cancel"
              outlined
              onClick={() => {
                setShowSettings(false);
                setJsonConfig(JSON.stringify(groups, null, 2));
                setConfigError(null);
              }}
            />
          </div>
        </div>
      </Dialog>
      {nodes.length === 0 ? (
        <p>No accounts found on this page</p>
      ) : (
        <Tree
          value={visibleNodes}
          nodeTemplate={nodeTemplate}
          expandedKeys={expandedKeys}
          onToggle={(e) => setExpandedKeys(e.value)}
          onNodeClick={({ node }) => {
            if (!node.children?.length) return; // Only toggle groups
            const key = node.key as string;
            setExpandedKeys((prev) => {
              const { [key]: previousKeyValue, ...otherExpandedKeys } = prev;
              if (previousKeyValue === true) {
                return otherExpandedKeys;
              } else {
                loadRolesForChildren(node);
                return { ...otherExpandedKeys, [key]: true };
              }
            });
          }}
        />
      )}
    </div>
  );
};
