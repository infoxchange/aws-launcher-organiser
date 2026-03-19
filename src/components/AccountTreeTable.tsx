import { Button } from "primereact/button";
import { ButtonGroup } from "primereact/buttongroup";
import { Message } from "primereact/message";
import { Tree } from "primereact/tree";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { type Group, type TagConfig, useConfigStore } from "../utils/configStore";
import { sortAccountsByConfig } from "../utils/sortAccounts";
import { SettingsDialog } from "./SettingsDialog";

interface NodeTemplateProps {
  node: TreeNode;
  tags: TagConfig[];
  editMode: boolean;
  editingGroupKey: string | null;
  editingGroupName: string;
  setEditingGroupKey: (key: string | null) => void;
  setEditingGroupName: (name: string) => void;
  editingDescriptionKey: string | null;
  editingDescription: string;
  setEditingDescriptionKey: (key: string | null) => void;
  setEditingDescription: (desc: string) => void;
  updateGroupName: (groupKey: string, name: string) => void;
  updateGroupDescription: (groupKey: string, desc: string) => void;
  findGroupByKey: (key: string) => Group | null;
  setNodes: React.Dispatch<React.SetStateAction<AccountGroupNode[]>>;
  enqueueRoleLoad: (accountId: string, execute: () => Promise<void>) => void;
}

const NodeTemplate: React.FC<NodeTemplateProps> = ({
  node,
  tags,
  editMode,
  editingGroupKey,
  editingGroupName,
  setEditingGroupKey,
  setEditingGroupName,
  editingDescriptionKey,
  editingDescription,
  setEditingDescriptionKey,
  setEditingDescription,
  updateGroupName,
  updateGroupDescription,
  findGroupByKey,
  setNodes,
  enqueueRoleLoad,
}) => {
  const [roleLoadError, setRoleLoadError] = useState<string | null>(null);
  const data = node.data;
  const account = "id" in data ? (data as Account) : null;

  const loadRoles = async () => {
    if (!account) return;
    try {
      const roles = await getAccountRoles(account.id);
      setRoleLoadError(null);
      setNodes((prev) => setAccountRoles(prev, account.id, roles));
    } catch (error) {
      setRoleLoadError((error as Error).message);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally fires only on mount
  useEffect(() => {
    if (!account || account.roles) return;
    enqueueRoleLoad(account.id, loadRoles);
  }, []);

  // Account node - has an id property
  if (account) {
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
            <div className="account-role-load">
              {roleLoadError && (
                <Message severity="error" text={roleLoadError} className="role-load-error" />
              )}
              <Button
                size="small"
                text
                label={roleLoadError ? "Retry loading roles" : "Load roles"}
                onClick={(e) => {
                  e.stopPropagation();
                  loadRoles();
                }}
              />
            </div>
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

  const roleLoadQueue = useRef<{ accountId: string; execute: () => Promise<void> }[]>([]);
  const activeLoads = useRef(0);
  const MAX_CONCURRENT = 3;

  const processQueue = useCallback(() => {
    while (activeLoads.current < MAX_CONCURRENT && roleLoadQueue.current.length > 0) {
      const entry = roleLoadQueue.current.shift()!;
      activeLoads.current++;
      entry.execute().finally(() => {
        activeLoads.current--;
        processQueue();
      });
    }
  }, []);

  const enqueueRoleLoad = useCallback(
    (accountId: string, execute: () => Promise<void>) => {
      if (roleLoadQueue.current.some((entry) => entry.accountId === accountId)) return;
      roleLoadQueue.current.push({ accountId, execute });
      processQueue();
    },
    [processQueue]
  );

  useEffect(() => {
    // Extract and group accounts from the page
    const accounts = extractAccounts();
    const grouped = getAccountTree(accounts, groups, tags);
    setNodes(grouped);
    setExpandedKeys(collectExpandedKeys(grouped));
  }, [groups, tags]);

  useEffect(() => {
    // Update JSON config when groups or tags change
    setJsonConfig(JSON.stringify(getConfig(), null, 2));
  }, [getConfig]);

  const nodeTemplate = (node: TreeNode) => (
    <NodeTemplate
      node={node}
      tags={tags}
      editMode={editMode}
      editingGroupKey={editingGroupKey}
      editingGroupName={editingGroupName}
      setEditingGroupKey={setEditingGroupKey}
      setEditingGroupName={setEditingGroupName}
      editingDescriptionKey={editingDescriptionKey}
      editingDescription={editingDescription}
      setEditingDescriptionKey={setEditingDescriptionKey}
      setEditingDescription={setEditingDescription}
      updateGroupName={updateGroupName}
      updateGroupDescription={updateGroupDescription}
      findGroupByKey={findGroupByKey}
      setNodes={setNodes}
      enqueueRoleLoad={enqueueRoleLoad}
    />
  );

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

    // Apply sorting based on sortBy configuration
    filtered = sortAccountsByConfig(filtered, sortBy, tags);

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
            setExpandedKeys(e.value as Record<string, boolean>);
          }}
          onNodeClick={({ node }) => {
            if (!node.children?.length) return; // Only toggle groups
            const key = node.key as string;
            setExpandedKeys((prev) => {
              const { [key]: previousKeyValue, ...otherExpandedKeys } = prev;
              const isExpanding = !previousKeyValue;
              return isExpanding ? { ...otherExpandedKeys, [key]: true } : otherExpandedKeys;
            });
          }}
        />
      )}
    </div>
  );
};
