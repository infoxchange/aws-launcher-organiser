import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  type PredefinedGroup,
  type RemoteConfig,
  RemoteConfigSchema,
  type TagConfig,
} from "./config-schema";

// Re-export for convenience
export type { PredefinedGroup, RemoteConfig, TagConfig };
export { RemoteConfigSchema };

const defaultGroups: PredefinedGroup[] = [];
const defaultTags: TagConfig[] = [];

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
  groups: PredefinedGroup[];
  tags: TagConfig[];
  autoUpdateEnabled: boolean;
  autoUpdateUrl: string;
  autoUpdateAuthToken: string;
  setGroups: (groups: PredefinedGroup[]) => void;
  setTags: (tags: TagConfig[]) => void;
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

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set, get) => ({
      groups: defaultGroups,
      tags: defaultTags,
      autoUpdateEnabled: false,
      autoUpdateUrl: "",
      autoUpdateAuthToken: "",
      setGroups: (groups: PredefinedGroup[]) => set({ groups }),
      setTags: (tags: TagConfig[]) => {
        const error = validateTags(tags);
        if (error) {
          throw new Error(`Tag validation failed: ${error}`);
        }
        set({ tags });
      },
      setConfig: (config: RemoteConfig) => {
        set({
          groups: Array.isArray(config.groups) ? config.groups : defaultGroups,
          tags: Array.isArray(config.tags) ? config.tags : defaultTags,
        });
      },
      setAutoUpdateEnabled: (enabled: boolean) => set({ autoUpdateEnabled: enabled }),
      setAutoUpdateUrl: (url: string) => set({ autoUpdateUrl: url }),
      setAutoUpdateAuthToken: (token: string) => set({ autoUpdateAuthToken: token }),
      resetToDefaults: () => set({ groups: defaultGroups, tags: defaultTags }),
      getConfig: () => {
        const state = get();
        return {
          version: 1,
          groups: state.groups,
          tags: state.tags.length > 0 ? state.tags : undefined,
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
            autoUpdateEnabled: false,
            autoUpdateUrl: "",
            autoUpdateAuthToken: "",
          };
        }

        const obj = state as Record<string, unknown>;

        // Extract groups and tags, handling RemoteConfig format
        let groups: PredefinedGroup[] = defaultGroups;
        let tags: TagConfig[] = defaultTags;

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
          }
        }

        if ("tags" in obj && Array.isArray(obj.tags)) {
          tags = obj.tags;
        }

        return {
          groups,
          tags,
          autoUpdateEnabled: obj.autoUpdateEnabled === true,
          autoUpdateUrl: typeof obj.autoUpdateUrl === "string" ? obj.autoUpdateUrl : "",
          autoUpdateAuthToken:
            typeof obj.autoUpdateAuthToken === "string" ? obj.autoUpdateAuthToken : "",
        };
      },
    }
  )
);

export function getDefaultGroups(): PredefinedGroup[] {
  return defaultGroups;
}
