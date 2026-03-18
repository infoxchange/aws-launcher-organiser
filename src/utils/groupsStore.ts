import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PredefinedGroup {
  key: string;
  name: string;
  icon?: string;
  matcher?: string | string[];
  children?: PredefinedGroup[];
  expandedByDefault?: boolean;
}

const defaultGroups: PredefinedGroup[] = [];

interface GroupsStore {
  groups: PredefinedGroup[];
  setGroups: (groups: PredefinedGroup[]) => void;
  resetToDefaults: () => void;
}

export const useGroupsStore = create<GroupsStore>()(
  persist(
    (set) => ({
      groups: defaultGroups,
      setGroups: (groups: PredefinedGroup[]) => set({ groups }),
      resetToDefaults: () => set({ groups: defaultGroups }),
    }),
    {
      name: "aws-sso-groups-config",
    }
  )
);

export function getDefaultGroups(): PredefinedGroup[] {
  return defaultGroups;
}
