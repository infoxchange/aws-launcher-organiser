import { Button } from "primereact/button";
import { ButtonGroup } from "primereact/buttongroup";
import { Tree } from "primereact/tree";
import type React from "react";
import { useEffect, useState } from "react";
import "primereact/resources/themes/lara-light-blue/theme.css";
import "primereact/resources/primereact.css";
import "primeicons/primeicons.css";
import "./AccountTreeTable.css";
import type { TreeNode } from "primereact/treenode";
import {
  type Account,
  type AccountGroupNode,
  type AccountNode,
  type AccountRole,
  extractAccounts,
  getAccountRoles,
  getAccountTree,
} from "../utils/account-extractor";
import { useConfigStore } from "../utils/configStore";
import { sortAccountsByConfig } from "../utils/sortAccounts";
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
  selectedTags: Set<string>
): (AccountGroupNode | AccountNode)[] {
  return nodes.reduce<(AccountGroupNode | AccountNode)[]>((acc, node) => {
    if ("id" in node.data) {
      // Account node — keep if it has any of the selected tags
      const account = node.data as Account;
      const accountTags = new Set(account.tags || []);
      // If no tags selected, show all accounts; if tags selected, only show if account has matching tag
      if (selectedTags.size === 0 || Array.from(selectedTags).some((tag) => accountTags.has(tag))) {
        acc.push(node);
      }
    } else {
      // Group node — recurse and only keep if children remain
      const filteredChildren = filterNodes((node as AccountGroupNode).children ?? [], selectedTags);
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
    } else {
      const groupNode = node as AccountGroupNode;
      if (groupNode.children) {
        count += countAllAccounts(groupNode.children);
      }
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
  const { groups, setGroups, tags, autoUpdateEnabled, getConfig, sortBy } = useConfigStore();
  const [nodes, setNodes] = useState<AccountGroupNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [jsonConfig, setJsonConfig] = useState(JSON.stringify(getConfig(), null, 2));
  const [configError, setConfigError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [editingDescriptionKey, setEditingDescriptionKey] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState("");

  useEffect(() => {
    // Extract and group accounts from the page
    const accounts = extractAccounts();
    const grouped = getAccountTree(accounts, groups, tags);
    setNodes(grouped);
    setExpandedKeys(collectExpandedKeys(grouped));
    loadRolesForExpandedGroups(grouped, async (accountId) => {
      const roles = await getAccountRoles(accountId);
      setNodes((prev) => setAccountRoles(prev, accountId, roles));
    });
  }, [groups, tags]);

  useEffect(() => {
    // Update JSON config when groups or tags change
    setJsonConfig(JSON.stringify(getConfig(), null, 2));
  }, [getConfig]);

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
              {account.tags && account.tags.length > 0 && (
                <div className="tag-dots">
                  {account.tags.map((tagKey) => {
                    const tagConfig = tags.find((t) => t.key === tagKey);
                    return tagConfig ? (
                      <span
                        key={tagKey}
                        className="tag-dot"
                        style={{ backgroundColor: tagConfig.colour }}
                        title={tagConfig.name}
                      />
                    ) : null;
                  })}
                </div>
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
          {account.description && <div className="account-description">{account.description}</div>}
        </div>
      );
    }

    // Group node - just name
    const groupKey = node.key as string;
    const isEditingName = editMode && editingGroupKey === groupKey;
    const isEditingDesc = editMode && editingDescriptionKey === groupKey;

    if (isEditingName) {
      return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: Container div only stops event propagation
        // biome-ignore lint/a11y/noStaticElementInteractions: Container div only stops event propagation
        <div className="group-edit-container" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={editingGroupName}
            onChange={(e) => setEditingGroupName(e.target.value)}
            className="group-edit-input"
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
        // biome-ignore lint/a11y/useKeyWithClickEvents: Container div only stops event propagation
        // biome-ignore lint/a11y/noStaticElementInteractions: Container div only stops event propagation
        <div className="group-edit-container" onClick={(e) => e.stopPropagation()}>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: Editing mode */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Editing mode */}
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
        {editMode ? (
          <button
            className="group-name"
            onClick={(e) => {
              e.stopPropagation();
              setEditingGroupKey(groupKey);
              setEditingGroupName(data?.name || "");
            }}
            type="button"
          >
            {data?.name} ({countAllAccounts((node as AccountGroupNode).children ?? [])})
          </button>
        ) : (
          <div className="group-name">
            {data?.name} ({countAllAccounts((node as AccountGroupNode).children ?? [])})
          </div>
        )}
        {groupData?.description ? (
          editMode ? (
            <button
              className="group-description"
              onClick={(e) => {
                e.stopPropagation();
                setEditingDescriptionKey(groupKey);
                setEditingDescription(groupData.description || "");
              }}
              type="button"
            >
              {groupData.description}
            </button>
          ) : (
            <div className="group-description">{groupData.description}</div>
          )
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
    (async () => {
      const accountsToLoad = children.filter(
        (child) => "id" in child.data && !(child.data as Account).roles
      );

      // Maintain a queue and load up to 3 in parallel
      // As soon as one finishes, start the next one
      const queue = [...accountsToLoad];
      const MAX_CONCURRENT = 3;

      const processNext = async () => {
        if (queue.length === 0) return;

        const child = queue.shift()!;
        const account = child.data as Account;

        try {
          const roles = await getAccountRoles(account.id);
          setNodes((prev) => setAccountRoles(prev, account.id, roles));
        } catch (error) {
          console.error(error);
        }

        // After this finishes, start the next one
        if (queue.length > 0) {
          await processNext();
        }
      };

      // Start up to 3 concurrent workers
      const workers = [];
      for (let i = 0; i < Math.min(MAX_CONCURRENT, accountsToLoad.length); i++) {
        workers.push(processNext());
      }
      await Promise.all(workers);
    })();
  };

  const toggleTag = (tagKey: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      next.has(tagKey) ? next.delete(tagKey) : next.add(tagKey);
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

  const findGroupByKey = (actualGroupKey: string): (typeof groups)[0] | null => {
    const search = (groupsToSearch: typeof groups): (typeof groups)[0] | null => {
      // Defensive check: ensure groupsToSearch is an array
      if (!Array.isArray(groupsToSearch)) {
        console.error("findGroupByKey received non-array groupsToSearch:", groupsToSearch);
        // Try to extract groups if it looks like a RemoteConfig object
        if (
          typeof groupsToSearch === "object" &&
          groupsToSearch !== null &&
          "groups" in groupsToSearch
        ) {
          const config = groupsToSearch as Record<string, unknown>;
          if (Array.isArray(config.groups)) {
            groupsToSearch = config.groups;
          } else {
            return null;
          }
        } else {
          return null;
        }
      }
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

    if (selectedTags.size > 0) {
      filtered = filterNodes(filtered, selectedTags) as AccountGroupNode[];
    }

    if (searchQuery.trim()) {
      filtered = searchFilterNodes(filtered, searchQuery) as AccountGroupNode[];
    }

    console.log("___SSS", JSON.parse(JSON.stringify(filtered, null, 2)));

    // Apply sorting based on sortBy configuration
    filtered = sortAccountsByConfig(filtered, sortBy, tags);
    console.log("___SSS2", JSON.parse(JSON.stringify(filtered, null, 2)));

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
          {tags.length > 0 && (
            <ButtonGroup>
              {tags.map((tag) => (
                <Button
                  key={tag.key}
                  label={tag.name}
                  rounded
                  outlined={!selectedTags.has(tag.key)}
                  onClick={() => toggleTag(tag.key)}
                  style={{
                    borderColor: tag.colour,
                    color: selectedTags.has(tag.key) ? "white" : tag.colour,
                    backgroundColor: selectedTags.has(tag.key) ? tag.colour : "transparent",
                  }}
                />
              ))}
            </ButtonGroup>
          )}
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
              setJsonConfig(JSON.stringify(getConfig(), null, 2));
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
          setJsonConfig(JSON.stringify(getConfig(), null, 2));
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
          onToggle={(e) => {
            const newExpandedKeys = e.value as Record<string, boolean>;
            // Find which keys were newly expanded
            for (const key of Object.keys(newExpandedKeys)) {
              if (!expandedKeys[key]) {
                // This key was just expanded, find and load roles for the node
                const findNodeByKey = (
                  nodes: (AccountGroupNode | AccountNode)[],
                  targetKey: string
                ): TreeNode | null => {
                  for (const node of nodes) {
                    if (node.key === targetKey) return node;
                    if (node.children) {
                      const found = findNodeByKey(
                        node.children as (AccountGroupNode | AccountNode)[],
                        targetKey
                      );
                      if (found) return found;
                    }
                  }
                  return null;
                };
                const expandedNode = findNodeByKey(visibleNodes, key);
                if (expandedNode) {
                  loadRolesForChildren(expandedNode);
                }
              }
            }
            setExpandedKeys(newExpandedKeys);
          }}
          onNodeClick={({ node }) => {
            if (!node.children?.length) return; // Only toggle groups
            const key = node.key as string;
            setExpandedKeys((prev) => {
              const { [key]: previousKeyValue, ...otherExpandedKeys } = prev;
              const isExpanding = !previousKeyValue;
              const newKeys = isExpanding
                ? { ...otherExpandedKeys, [key]: true }
                : otherExpandedKeys;
              if (isExpanding) {
                loadRolesForChildren(node);
              }
              return newKeys;
            });
          }}
        />
      )}
    </div>
  );
};
