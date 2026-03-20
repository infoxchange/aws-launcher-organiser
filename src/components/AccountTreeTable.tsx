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
import { formatConfig, type Group, type TagConfig, useConfigStore } from "../utils/configStore";
import { sortAccountsByConfig } from "../utils/sortAccounts";
import { generateUUID } from "../utils/uuid";
import { GroupEditor } from "./GroupEditor";
import { SettingsDialog } from "./SettingsDialog";

interface NodeTemplateProps {
  node: TreeNode;
  tags: TagConfig[];
  editMode: boolean;
  editingGroupKey: string | null;
  setEditingGroupKey: (key: string | null) => void;
  updateGroup: (groupKey: string, updatedGroup: Group) => void;
  addChildGroup: (parentKey: string) => void;
  addRootGroup: () => void;
  deleteGroup: (groupKey: string) => void;
  findGroupByKey: (key: string) => Group | null;
  setNodes: React.Dispatch<React.SetStateAction<AccountGroupNode[]>>;
  enqueueRoleLoad: (accountId: string, execute: () => Promise<void>) => void;
}

const NodeTemplate: React.FC<NodeTemplateProps> = ({
  node,
  tags,
  editMode,
  editingGroupKey,
  setEditingGroupKey,
  updateGroup,
  addChildGroup,
  addRootGroup,
  deleteGroup,
  findGroupByKey,
  setNodes,
  enqueueRoleLoad,
}) => {
  const [roleLoadError, setRoleLoadError] = useState<string | null>(null);
  const data = node.data;
  const isButtonNode = (data as Record<string, unknown>)?.isAddButton === true;
  const account = !isButtonNode && "id" in data ? (data as Account) : null;

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

  // Button node - special node for adding child groups
  if (isButtonNode) {
    const parentGroupKey = (node.data as Record<string, unknown>)?.parentGroupKey as string | null;
    const isRootButton = parentGroupKey === null;
    return (
      <Button
        label="+ add group"
        onClick={(e) => {
          e.stopPropagation();
          if (isRootButton) {
            addRootGroup();
          } else {
            addChildGroup(parentGroupKey);
          }
        }}
        text
        size="small"
        className="add-child-group-button"
      />
    );
  }

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

  // Group node - render with optional GroupEditor dialog
  const groupKey = node.key as string;
  const isEditing = editMode && editingGroupKey === groupKey;
  const actualGroupKey = groupKey.startsWith("group-") ? groupKey.substring(6) : groupKey;
  const groupData = findGroupByKey(actualGroupKey);

  if (isEditing && groupData) {
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: Container div only stops event propagation
      // biome-ignore lint/a11y/useKeyWithClickEvents: Container div only stops event propagation
      <div className="group-edit-container" onClick={(e) => e.stopPropagation()}>
        <GroupEditor
          group={groupData}
          onSave={(updatedGroup) => {
            updateGroup(groupKey, updatedGroup);
          }}
          onAddChild={() => {
            addChildGroup(groupKey);
          }}
          onDelete={() => {
            deleteGroup(groupKey);
          }}
          onCancel={() => {
            setEditingGroupKey(null);
          }}
        />
      </div>
    );
  }

  // Display group name and description
  return (
    <div className={`group-content ${editMode ? "group-content-editable" : ""}`}>
      <div className="group-name-row">
        {editMode ? (
          <>
            <i className="pi pi-bars drag-handle" />
            <div className="group-name">
              {data?.name} ({countAllAccounts((node as AccountGroupNode).children ?? [])})
            </div>
            <Button
              icon="pi pi-pencil"
              rounded
              text
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setEditingGroupKey(groupKey);
              }}
              className="group-edit-button"
              aria-label="Edit group"
            />
          </>
        ) : (
          <div className="group-name">
            {data?.name} ({countAllAccounts((node as AccountGroupNode).children ?? [])})
          </div>
        )}
      </div>
      {groupData?.description && <div className="group-description">{groupData.description}</div>}
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
  const [jsonConfig, setJsonConfig] = useState(JSON.stringify(formatConfig(getConfig()), null, 2));
  const [configError, setConfigError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);

  useEffect(() => {
    if (autoUpdateEnabled) {
      setEditMode(false);
    }
  }, [autoUpdateEnabled]);

  const roleLoadQueue = useRef<{ accountId: string; execute: () => Promise<void> }[]>([]);
  const activeLoads = useRef(0);
  const MAX_CONCURRENT = 3;

  const processQueue = useCallback(() => {
    while (activeLoads.current < MAX_CONCURRENT && roleLoadQueue.current.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: length check above guarantees non-null
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
    setJsonConfig(JSON.stringify(formatConfig(getConfig()), null, 2));
  }, [getConfig]);

  const nodeTemplate = (node: TreeNode) => (
    <NodeTemplate
      node={node}
      tags={tags}
      editMode={editMode}
      editingGroupKey={editingGroupKey}
      setEditingGroupKey={setEditingGroupKey}
      updateGroup={updateGroup}
      addChildGroup={addChildGroup}
      addRootGroup={addRootGroup}
      deleteGroup={deleteGroup}
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

  const updateGroup = (groupKey: string, updatedGroup: Group) => {
    const actualGroupKey = groupKey.startsWith("group-") ? groupKey.substring(6) : groupKey;

    const updateInGroups = (groupsToUpdate: typeof groups): typeof groups => {
      return groupsToUpdate.map((group) => {
        if (group.key === actualGroupKey) {
          return updatedGroup;
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
    setEditingGroupKey(null);
  };

  const addChildGroup = (parentKey: string) => {
    const actualParentKey = parentKey.startsWith("group-") ? parentKey.substring(6) : parentKey;

    const addToGroups = (groupsToUpdate: typeof groups): typeof groups => {
      return groupsToUpdate.map((group) => {
        if (group.key === actualParentKey) {
          const newChild: Group = {
            key: generateUUID(),
            name: "New Child Group",
          };
          return {
            ...group,
            children: [...(group.children || []), newChild],
          };
        }
        if (group.children) {
          return {
            ...group,
            children: addToGroups(group.children),
          };
        }
        return group;
      });
    };

    const updated = addToGroups(groups);
    setGroups(updated);
  };

  const addRootGroup = () => {
    const newGroup: Group = {
      key: generateUUID(),
      name: "New Group",
    };
    setGroups([...groups, newGroup]);
  };

  const deleteGroup = (groupKey: string) => {
    const actualGroupKey = groupKey.startsWith("group-") ? groupKey.substring(6) : groupKey;

    const removeFromGroups = (groupsToUpdate: typeof groups): typeof groups => {
      return groupsToUpdate
        .filter((group) => group.key !== actualGroupKey)
        .map((group) => {
          if (group.children) {
            return {
              ...group,
              children: removeFromGroups(group.children),
            };
          }
          return group;
        });
    };

    const updated = removeFromGroups(groups);
    setGroups(updated);
    setEditingGroupKey(null);
  };

  const reorderGroups = (dragKey: string, dropKey: string, dropIndex: number) => {
    const dragActualKey = dragKey.startsWith("group-") ? dragKey.substring(6) : dragKey;
    const dropActualKey = dropKey?.startsWith("group-") ? dropKey.substring(6) : dropKey;

    // Don't allow dropping a group onto itself
    if (dragActualKey === dropActualKey) return;

    let draggedGroup: Group | null = null;

    // Function to find and remove a group from the tree, storing it in draggedGroup
    const removeGroup = (groupsToSearch: typeof groups): typeof groups => {
      return groupsToSearch.reduce<typeof groups>((acc, group) => {
        if (group.key === dragActualKey) {
          draggedGroup = group;
          return acc; // Exclude this group from results
        }
        if (group.children) {
          const updatedChildren = removeGroup(group.children);
          // Only update if children actually changed
          if (updatedChildren.length !== group.children.length) {
            acc.push({ ...group, children: updatedChildren });
          } else {
            acc.push(group);
          }
        } else {
          acc.push(group);
        }
        return acc;
      }, []);
    };

    // Function to add the dragged group to the specified location
    const addGroup = (groupsToSearch: typeof groups): typeof groups => {
      return groupsToSearch.map((group) => {
        // If this is the drop target, add the dragged group to its children
        if (dropActualKey && group.key === dropActualKey && draggedGroup) {
          const currentChildren = group.children || [];
          const insertIndex = dropIndex < 0 ? currentChildren.length : dropIndex;
          return {
            ...group,
            children: [
              ...currentChildren.slice(0, insertIndex),
              draggedGroup,
              ...currentChildren.slice(insertIndex),
            ],
          };
        }
        // Recurse into children for nested groups
        if (group.children) {
          return {
            ...group,
            children: addGroup(group.children),
          };
        }
        return group;
      });
    };

    // Remove the dragged group from its current location
    let updated = removeGroup(groups);

    // If no drop target, add to root level
    if (!dropActualKey) {
      const insertIndex = dropIndex < 0 ? updated.length : dropIndex;
      if (draggedGroup) {
        updated = [...updated.slice(0, insertIndex), draggedGroup, ...updated.slice(insertIndex)];
      }
    } else {
      // Add to the drop target's children
      updated = addGroup(updated);
    }

    setGroups(updated);
  };

  const injectButtonNodes = (
    nodes: (AccountGroupNode | AccountNode)[]
  ): (AccountGroupNode | AccountNode)[] => {
    if (!editMode) return nodes;
    return nodes.map((node) => {
      if ("children" in node) {
        const groupNode = node as AccountGroupNode;
        const originalChildren = groupNode.children || [];

        // Separate existing children into groups, accounts, and any existing buttons
        const nestedGroups = originalChildren.filter((child) => "children" in child);
        const accountNodes = originalChildren.filter((child) => "id" in child.data);
        const existingButtons = originalChildren.filter(
          // biome-ignore lint/suspicious/noExplicitAny: Button nodes have dynamic data structure
          (child) => "isAddButton" in child.data && (child.data as any).isAddButton
        );

        // Create the new button node
        const newButton = {
          key: `add-button-${groupNode.key}`,
          data: {
            isAddButton: true,
            parentGroupKey: groupNode.key,
          },
        } as unknown as AccountNode;

        // Combine: groups, buttons (existing + new), accounts
        const childrenWithButton: (AccountGroupNode | AccountNode)[] = [
          ...nestedGroups,
          ...existingButtons,
          newButton,
          ...accountNodes,
        ];

        return {
          ...groupNode,
          children: injectButtonNodes(childrenWithButton),
        } as AccountGroupNode;
      }
      return node;
    });
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
    filtered = sortAccountsByConfig(filtered, sortBy, tags, groups);

    // Inject "add group" button nodes
    filtered = injectButtonNodes(filtered) as AccountGroupNode[];

    // Add root-level button node when in edit mode
    if (editMode) {
      const rootButton = {
        key: "add-button-root",
        data: {
          isAddButton: true,
          parentGroupKey: null,
        },
      } as unknown as AccountGroupNode;
      filtered = [...filtered, rootButton];
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
              setJsonConfig(JSON.stringify(formatConfig(getConfig()), null, 2));
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
          setJsonConfig(JSON.stringify(formatConfig(getConfig()), null, 2));
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
        <>
          <Tree
            value={visibleNodes}
            dragdropScope={editMode ? "accounts-tree" : undefined}
            nodeTemplate={nodeTemplate}
            expandedKeys={expandedKeys}
            onDragDrop={(e) => {
              const dragKey = e.dragNode?.key as string;
              const dropKey = e.dropNode?.key as string;
              // Only allow reordering of groups
              if (dragKey?.startsWith("group-") && (dropKey?.startsWith("group-") || !dropKey)) {
                reorderGroups(dragKey, dropKey, e.dropIndex ?? -1);
              }
            }}
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
          {editMode && (
            <div className="add-root-group-container">
              <Button
                label="+ add group"
                onClick={addRootGroup}
                size="small"
                text
                className="add-root-group-button"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};
