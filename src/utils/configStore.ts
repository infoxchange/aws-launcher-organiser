import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { type PredefinedGroup, RemoteConfigSchema } from "./config-schema";

// Re-export for convenience
export type { PredefinedGroup };
export { RemoteConfigSchema };

const defaultGroups: PredefinedGroup[] = [];

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
  autoUpdateEnabled: boolean;
  autoUpdateUrl: string;
  autoUpdateAuthToken: string;
  setGroups: (groups: PredefinedGroup[]) => void;
  setAutoUpdateEnabled: (enabled: boolean) => void;
  setAutoUpdateUrl: (url: string) => void;
  setAutoUpdateAuthToken: (token: string) => void;
  resetToDefaults: () => void;
}

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set) => ({
      groups: defaultGroups,
      autoUpdateEnabled: false,
      autoUpdateUrl: "",
      autoUpdateAuthToken: "",
      setGroups: (groups: PredefinedGroup[]) => set({ groups }),
      setAutoUpdateEnabled: (enabled: boolean) => set({ autoUpdateEnabled: enabled }),
      setAutoUpdateUrl: (url: string) => set({ autoUpdateUrl: url }),
      setAutoUpdateAuthToken: (token: string) => set({ autoUpdateAuthToken: token }),
      resetToDefaults: () => set({ groups: defaultGroups }),
    }),
    {
      name: STORAGE_KEY,
      storage: chromeLocalStorage,
    }
  )
);

export function getDefaultGroups(): PredefinedGroup[] {
  return defaultGroups;
}
