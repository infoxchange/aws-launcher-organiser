import { Tree } from "primereact/tree";
import { Button } from "primereact/button";
import { ButtonGroup } from "primereact/buttongroup";
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
import { useConfigStore } from "../utils/configStore";
import { TreeNode } from "primereact/treenode";
import { SettingsDialog } from "./SettingsDialog";

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
  const { groups, setGroups, autoUpdateEnabled } = useConfigStore();
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
  const [editingDescriptionKey, setEditingDescriptionKey] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState("");

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
  const nodeTemplate = (node: TreeNode) => {
    const data = node.data;

    // Account node - has an id property
    if ("id" in data) {
      const account = data as Account;
      return (
        <div className="account-node">
          <div className="account-header">
            <span className="account-name-group">
              {(account.environment || account.name.endsWith("-sandbox")) && (
                <span
                  className={`environment-dot ${
                    account.name.endsWith("-sandbox")
                      ? "sandbox"
                      : account.environment || "unknown"
                  }`}
                />
              )}
              <span className="account-name">{account.name}</span>
            </span>
            <span className="account-id">({account.id})</span>
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
          {account.description && (
            <div className="account-description">{account.description}</div>
          )}
        </div>
      );
    }

    // Group node - just name
    const groupKey = node.key as string;
    const isEditingName = editMode && editingGroupKey === groupKey;
    const isEditingDesc = editMode && editingDescriptionKey === groupKey;

    if (isEditingName) {
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

    if (isEditingDesc) {
      return (
        <div className="group-edit-container" onClick={(e) => e.stopPropagation()}>
          <span
            className="group-name"
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
          <textarea
            value={editingDescription}
            onChange={(e) => setEditingDescription(e.target.value)}
            className="group-description-input"
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                setEditingDescriptionKey(null);
              }
            }}
            onBlur={() => {
              updateGroupDescription(groupKey, editingDescription);
              setEditingDescriptionKey(null);
            }}
            placeholder="Add description..."
          />
        </div>
      );
    }

    // Get the actual group data from the groups array
    const actualGroupKey = groupKey.startsWith("group-") ? groupKey.substring(6) : groupKey;
    const groupData = findGroupByKey(actualGroupKey);

    return (
      <div className={`group-content ${editMode ? "group-content-editable" : ""}`}>
        <span
          className="group-name"
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
        {groupData?.description ? (
          <span
            className="group-description"
            onClick={(e) => {
              if (editMode) {
                e.stopPropagation();
                setEditingDescriptionKey(groupKey);
                setEditingDescription(groupData.description || "");
              }
            }}
          >
            {groupData.description}
          </span>
        ) : editMode ? (
          <Button
            size="small"
            text
            label="Add description"
            icon="pi pi-plus"
            onClick={(e) => {
              e.stopPropagation();
              setEditingDescriptionKey(groupKey);
              setEditingDescription("");
            }}
            className="add-description-button"
          />
        ) : null}
      </div>
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

  const findGroupByKey = (actualGroupKey: string): typeof groups[0] | null => {
    const search = (groupsToSearch: typeof groups): typeof groups[0] | null => {
      for (const group of groupsToSearch) {
        if (group.key === actualGroupKey) {
          return group;
        }
        if (group.children) {
          const found = search(group.children);
          if (found) return found;
        }
      }
      return null;
    };
    return search(groups);
  };

  const updateGroupDescription = (groupKey: string, newDescription: string) => {
    const actualGroupKey = groupKey.startsWith("group-") ? groupKey.substring(6) : groupKey;

    const updateInGroups = (groupsToUpdate: typeof groups): typeof groups => {
      return groupsToUpdate.map((group) => {
        if (group.key === actualGroupKey) {
          return { ...group, description: newDescription };
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
          {!autoUpdateEnabled && (
            <Button
              icon="pi pi-pencil"
              label={editMode ? "Stop Editing" : undefined}
              rounded
              text
              onClick={() => setEditMode(!editMode)}
              className={`edit-button ${editMode ? "edit-button-active" : ""}`}
            />
          )}
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
      <SettingsDialog
        visible={showSettings}
        onHide={() => {
          setShowSettings(false);
          setJsonConfig(JSON.stringify(groups, null, 2));
          setConfigError(null);
        }}
        jsonConfig={jsonConfig}
        onConfigChange={setJsonConfig}
        configError={configError}
        onConfigError={setConfigError}
      />
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
