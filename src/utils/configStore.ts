import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  type Group,
  type RemoteConfig,
  RemoteConfigSchema,
  type SortConfig,
  type TagConfig,
} from "./config-schema";
import { generateUUID } from "./uuid";

// Re-export for convenience
export type { Group, RemoteConfig, SortConfig, TagConfig };
export { RemoteConfigSchema };

const defaultGroups: Group[] = [];
const defaultTags: TagConfig[] = [];
const defaultSortBy: SortConfig[] = [];

export const STORAGE_KEY = "aws-sso-config";

const chromeLocalStorage = createJSONStorage(() => ({
  getItem: async (name: string): Promise<string | null> => {
    const result = await chrome.storage.local.get(name);
    return (result[name] as string) ?? null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await chrome.storage.local.set({ [name]: value });
  },
  removeItem: async (name: string): Promise<void> => {
    await chrome.storage.local.remove(name);
  },
}));

interface ConfigStore {
  groups: Group[];
  tags: TagConfig[];
  sortBy: SortConfig[];
  autoUpdateEnabled: boolean;
  autoUpdateUrl: string;
  autoUpdateAuthToken: string;
  setGroups: (groups: Group[]) => void;
  setTags: (tags: TagConfig[]) => void;
  setSortBy: (sortBy: SortConfig[]) => void;
  setConfig: (config: RemoteConfig) => void;
  setAutoUpdateEnabled: (enabled: boolean) => void;
  setAutoUpdateUrl: (url: string) => void;
  setAutoUpdateAuthToken: (token: string) => void;
  resetToDefaults: () => void;
  getConfig: () => RemoteConfig;
}

const validateTags = (tags: TagConfig[]): string | null => {
  for (const tag of tags) {
    if (!tag.key || !tag.name) {
      return "All tags must have a key and name";
    }
    if (!/^#[0-9A-F]{6}$/i.test(tag.colour)) {
      return `Invalid color format for tag "${tag.key}": ${tag.colour}`;
    }
    if (tag.matcher) {
      try {
        new RegExp(`^${tag.matcher}$`);
      } catch (err) {
        return `Invalid regex for tag "${tag.key}": ${err instanceof Error ? err.message : "Unknown error"}`;
      }
    }
  }
  return null;
};

const validateSortBy = (sortBy: SortConfig[]): string | null => {
  for (const config of sortBy) {
    if (!config.type || !config.direction) {
      return "All sort configs must have a type and direction";
    }
    if (!["nameSubstring", "tags"].includes(config.type)) {
      return `Invalid sort type: ${config.type}`;
    }
    if (!(["asc", "desc"] as const).includes(config.direction)) {
      return `Invalid sort direction: ${config.direction}`;
    }
    if (config.type === "nameSubstring") {
      if (!config.matcher) {
        return 'Sort config with type "nameSubstring" must have a matcher';
      }
      try {
        new RegExp(config.matcher);
      } catch (err) {
        return `Invalid regex for sort matcher: ${err instanceof Error ? err.message : "Unknown error"}`;
      }
    }
  }
  return null;
};

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set, get) => ({
      groups: defaultGroups,
      tags: defaultTags,
      sortBy: defaultSortBy,
      autoUpdateEnabled: false,
      autoUpdateUrl: "",
      autoUpdateAuthToken: "",
      setGroups: (groups: Group[]) => set({ groups: ensureGroupUUIDs(groups) }),
      setTags: (tags: TagConfig[]) => {
        const error = validateTags(tags);
        if (error) {
          throw new Error(`Tag validation failed: ${error}`);
        }
        set({ tags });
      },
      setSortBy: (sortBy: SortConfig[]) => {
        const error = validateSortBy(sortBy);
        if (error) {
          throw new Error(`Sort config validation failed: ${error}`);
        }
        set({ sortBy });
      },
      setConfig: (config: RemoteConfig) => {
        set({
          groups: ensureGroupUUIDs(Array.isArray(config.groups) ? config.groups : defaultGroups),
          tags: Array.isArray(config.tags) ? config.tags : defaultTags,
          sortBy: Array.isArray(config.sortBy) ? config.sortBy : defaultSortBy,
        });
      },
      setAutoUpdateEnabled: (enabled: boolean) => set({ autoUpdateEnabled: enabled }),
      setAutoUpdateUrl: (url: string) => set({ autoUpdateUrl: url }),
      setAutoUpdateAuthToken: (token: string) => set({ autoUpdateAuthToken: token }),
      resetToDefaults: () =>
        set({ groups: ensureGroupUUIDs(defaultGroups), tags: defaultTags, sortBy: defaultSortBy }),
      getConfig: () => {
        const state = get();
        return {
          version: 1,
          groups: state.groups,
          tags: state.tags.length > 0 ? state.tags : undefined,
          sortBy: state.sortBy.length > 0 ? state.sortBy : undefined,
        };
      },
    }),
    {
      name: STORAGE_KEY,
      storage: chromeLocalStorage,
      migrate: (state: unknown, _version: number) => {
        // Ensure we have a valid state object
        if (!state || typeof state !== "object") {
          return {
            groups: defaultGroups,
            tags: defaultTags,
            sortBy: defaultSortBy,
            autoUpdateEnabled: false,
            autoUpdateUrl: "",
            autoUpdateAuthToken: "",
          };
        }

        const obj = state as Record<string, unknown>;

        // Extract groups and tags, handling RemoteConfig format
        let groups: Group[] = defaultGroups;
        let tags: TagConfig[] = defaultTags;
        let sortBy: SortConfig[] = defaultSortBy;

        if ("groups" in obj) {
          if (Array.isArray(obj.groups)) {
            groups = obj.groups;
          } else if (
            typeof obj.groups === "object" &&
            obj.groups !== null &&
            "groups" in obj.groups
          ) {
            // Nested RemoteConfig object
            const nested = obj.groups as Record<string, unknown>;
            groups = Array.isArray(nested.groups) ? nested.groups : defaultGroups;
            tags = Array.isArray(nested.tags) ? nested.tags : defaultTags;
            sortBy = Array.isArray(nested.sortBy) ? nested.sortBy : defaultSortBy;
          }
        }

        if ("tags" in obj && Array.isArray(obj.tags)) {
          tags = obj.tags;
        }

        if ("sortBy" in obj && Array.isArray(obj.sortBy)) {
          sortBy = obj.sortBy;
        }

        return {
          groups: ensureGroupUUIDs(groups),
          tags,
          sortBy,
          autoUpdateEnabled: obj.autoUpdateEnabled === true,
          autoUpdateUrl: typeof obj.autoUpdateUrl === "string" ? obj.autoUpdateUrl : "",
          autoUpdateAuthToken:
            typeof obj.autoUpdateAuthToken === "string" ? obj.autoUpdateAuthToken : "",
        };
      },
    }
  )
);

export function getDefaultGroups(): Group[] {
  return defaultGroups;
}

/**
 * Ensure all groups (recursively) have UUIDs
 */
export function ensureGroupUUIDs(groups: Group[]): Group[] {
  return groups.map((group) => ({
    ...group,
    key: group.key || generateUUID(),
    children: group.children ? ensureGroupUUIDs(group.children) : undefined,
  }));
}
