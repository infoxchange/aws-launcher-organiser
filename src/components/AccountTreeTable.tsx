import { Button } from "primereact/button";
import { ButtonGroup } from "primereact/buttongroup";
import { Message } from "primereact/message";
import { Skeleton } from "primereact/skeleton";
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
  extractAccountsProgressive,
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
  setNodes: React.Dispatch<React.SetStateAction<(AccountGroupNode | AccountNode)[]>>;
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
  const [isRolesLoading, setIsRolesLoading] = useState(false);
  const data = node.data;
  const isButtonNode = (data as Record<string, unknown>)?.isAddButton === true;
  const account = !isButtonNode && "id" in data ? (data as Account) : null;

  const loadRoles = async () => {
    if (!account) return;
    setIsRolesLoading(true);
    try {
      const roles = await getAccountRoles(account);
      setRoleLoadError(null);
      setNodes((prev) => setAccountRoles(prev, account.id, roles));
    } catch (error) {
      setRoleLoadError((error as Error).message);
    } finally {
      setIsRolesLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally fires only on mount
  useEffect(() => {
    if (!account || account.roles) return;
    // Only load roles when the node is visible (not inside a collapsed group).
    // PrimeReact Tree hides collapsed children by setting aria-hidden="true" on the parent <ul>.
    // We use IntersectionObserver so roles only load when the row scrolls into view.
    const el = document.querySelector<HTMLElement>(`[data-account-id="${account.id}"]`);
    if (!el) {
      enqueueRoleLoad(account.id, loadRoles);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          enqueueRoleLoad(account.id, loadRoles);
        }
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
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
      <div className="account-node" data-account-id={account.id}>
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
          {account.description && <div className="account-description">{account.description}</div>}
          {account.roles ? (
            <div className="account-roles">
              {account.roles.map((role) => (
                <div key={role.name} className="account-role-wrapper">
                  <a
                    href={role.consoleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="account-role-link"
                  >
                    {role.name}
                  </a>
                  {role.accessKeysElement && (
                    <Button
                      icon="pi pi-key"
                      rounded
                      text
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        role.accessKeysElement?.click();
                      }}
                      className="access-keys-button"
                      aria-label={`Access keys for ${role.name}`}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : isRolesLoading ? (
            <Skeleton className="role-loading-skeleton" width="10rem" height="1.3rem" />
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
        {groupData?.description && <div className="group-description">{groupData.description}</div>}
      </div>
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
  nodes: (AccountGroupNode | AccountNode)[],
  accountId: string,
  roles: AccountRole[]
): (AccountGroupNode | AccountNode)[] {
  return nodes.map((node) => {
    // Check if this is an account node with matching ID
    if ("id" in node.data && (node.data as Account).id === accountId) {
      return { ...node, data: { ...node.data, roles } } as AccountNode;
    }
    // Check if this is a group node with children
    if ("children" in node) {
      const groupNode = node as AccountGroupNode;
      return {
        ...groupNode,
        children: setAccountRoles(groupNode.children ?? [], accountId, roles),
      };
    }
    return node;
  });
}

export const AccountTreeTable: React.FC<AccountTreeTableProps> = () => {
  const { groups, setGroups, tags, autoUpdateEnabled, getConfig, sortBy, showOriginalList } =
    useConfigStore();
  const [nodes, setNodes] = useState<(AccountGroupNode | AccountNode)[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState("Loading accounts...");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [jsonConfig, setJsonConfig] = useState(JSON.stringify(formatConfig(getConfig()), null, 2));
  const [configError, setConfigError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  useEffect(() => {
    if (autoUpdateEnabled) {
      setEditMode(false);
    }
  }, [autoUpdateEnabled]);

  const rawAccounts = useRef<Account[]>([]);

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

  // Run once on mount: extract all accounts from the AWS SSO page across all pages.
  useEffect(() => {
    const loadAccounts = async () => {
      try {
        await extractAccountsProgressive(
          (status) => {
            console.log(`[AccountTreeTable] Loading status: ${status}`);
            setLoadingStatus(status);
          },
          (pageAccounts) => {
            // Update rawAccounts with new accounts from this page
            rawAccounts.current.push(...pageAccounts);
            console.log(
              `[AccountTreeTable] Page loaded with ${pageAccounts.length} accounts. Total now: ${rawAccounts.current.length}`
            );
            // Re-group with updated accounts and display immediately
            const grouped = getAccountTree(rawAccounts.current, groups, tags);
            setNodes(grouped);
            setExpandedKeys((prev) => ({ ...collectExpandedKeys(grouped), ...prev }));
          }
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error("Failed to extract accounts:", error);
        setAccountsError(errorMsg);
      } finally {
        setIsLoading(false);
      }
    };

    loadAccounts();
  }, [groups, tags]);

  // Re-group cached accounts whenever groups or tags configuration changes.
  useEffect(() => {
    if (rawAccounts.current.length === 0) return;
    const grouped = getAccountTree(rawAccounts.current, groups, tags);
    setNodes((prev) => {
      // Preserve already-loaded roles from the previous nodes
      const rolesByAccountId = new Map<string, Account["roles"]>();
      const collectRoles = (nodes: (AccountGroupNode | AccountNode)[]) => {
        for (const node of nodes) {
          if ("id" in node.data && node.data.roles) {
            rolesByAccountId.set(node.data.id, node.data.roles);
          }
          if (node.children) collectRoles(node.children as (AccountGroupNode | AccountNode)[]);
        }
      };
      collectRoles(prev);

      if (rolesByAccountId.size === 0) return grouped;

      const applyRoles = (
        nodes: (AccountGroupNode | AccountNode)[]
      ): (AccountGroupNode | AccountNode)[] =>
        nodes.map((node) => {
          if ("id" in node.data) {
            const roles = rolesByAccountId.get(node.data.id);
            return roles ? { ...node, data: { ...node.data, roles } } : node;
          }
          if (node.children) {
            return {
              ...node,
              children: applyRoles(node.children as (AccountGroupNode | AccountNode)[]),
            };
          }
          return node;
        });

      return applyRoles(grouped);
    });
    setExpandedKeys((prev) => ({ ...collectExpandedKeys(grouped), ...prev }));
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
          draggable: false,
          droppable: false,
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
      filtered = searchFilterNodes(filtered, searchQuery);
    }

    // Apply sorting based on sortBy configuration
    filtered = sortAccountsByConfig(filtered, sortBy, tags, groups);

    // Inject "add group" button nodes
    filtered = injectButtonNodes(filtered);

    // Add root-level button node when in edit mode
    if (editMode) {
      const rootButton = {
        key: "add-button-root",
        data: {
          isAddButton: true,
          parentGroupKey: null,
        },
        draggable: false,
        droppable: false,
      } as unknown as AccountGroupNode | AccountNode;

      // Separate groups and accounts at root level
      const rootGroups = filtered.filter((node) => "children" in node);
      const rootAccounts = filtered.filter((node) => "id" in node.data);

      // Insert button between groups and accounts
      filtered = [...rootGroups, rootButton, ...rootAccounts];
    }

    return filtered;
  })();

  const shouldShowOriginalList =
    showOriginalList || accountsError !== null || (nodes.length === 0 && !isLoading);

  return (
    <div id="aws-account-tree-table" className={shouldShowOriginalList ? "show-original-list" : ""}>
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
          {isLoading && (
            <div className="group">
              <p className="loading-status">{loadingStatus}</p>
            </div>
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
      {accountsError !== null ? (
        <div className="error-container">
          <p className="error-message">Failed to load accounts: {accountsError}</p>
          <p className="error-fallback">Showing original AWS account list below.</p>
        </div>
      ) : nodes.length === 0 && isLoading ? (
        <p>Waiting for accounts to load...</p>
      ) : nodes.length === 0 ? (
        <div className="no-accounts-container">
          <p>No accounts found on this page</p>
          <p className="original-list-fallback">Showing original AWS account list below.</p>
        </div>
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
