import { z } from "zod";

export interface TagConfig {
  key: string;
  name: string;
  colour: string;
  matcher?: string | string[];
}

export interface SortConfig {
  type: "nameSubstring" | "tags";
  direction: "asc" | "desc";
  matcher?: string;
}

export interface Group {
  key: string;
  name: string;
  icon?: string;
  matcher?: string | string[];
  children?: Group[];
  expandedByDefault?: boolean;
  description?: string;
}

export const TagConfigSchema: z.ZodType<TagConfig> = z.object({
  key: z.string(),
  name: z.string(),
  colour: z.string(),
  matcher: z.union([z.string(), z.array(z.string())]).optional(),
});

export const SortConfigSchema: z.ZodType<SortConfig> = z.object({
  type: z.enum(["nameSubstring", "tags"]),
  direction: z.enum(["asc", "desc"]),
  matcher: z.string().optional(),
});

export const GroupSchema: z.ZodType<Group> = z.lazy(() =>
  z.object({
    key: z.string(),
    name: z.string(),
    icon: z.string().optional(),
    matcher: z.union([z.string(), z.array(z.string())]).optional(),
    children: z.array(GroupSchema).optional(),
    expandedByDefault: z.boolean().optional(),
    description: z.string().optional(),
  })
);

export const RemoteConfigSchema = z.object({
  $schema: z.string().optional(),
  version: z.number(),
  groups: z.array(GroupSchema),
  tags: z.array(TagConfigSchema).optional(),
  sortBy: z.array(SortConfigSchema).optional(),
});

export type RemoteConfig = z.infer<typeof RemoteConfigSchema>;

/**
 * Determine sort order for object keys based on context
 */
function getKeyOrder(obj: Record<string, unknown>): (a: string, b: string) => number {
  const keys = Object.keys(obj);

  // Top-level config
  if (keys.includes("version") && keys.includes("groups")) {
    const topLevelOrder = ["$schema", "version", "groups", "tags", "sortBy"];
    return (a, b) => {
      const aIdx = topLevelOrder.indexOf(a);
      const bIdx = topLevelOrder.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    };
  }

  // Group object (has key and name, but not colour which is unique to tags)
  if (keys.includes("key") && keys.includes("name") && !keys.includes("colour")) {
    const groupOrder = [
      "key",
      "name",
      "icon",
      "matcher",
      "expandedByDefault",
      "description",
      "uuid",
      "children",
    ];
    return (a, b) => {
      const aIdx = groupOrder.indexOf(a);
      const bIdx = groupOrder.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    };
  }

  // TagConfig
  if (keys.includes("key") && keys.includes("colour")) {
    const tagOrder = ["key", "name", "colour", "matcher"];
    return (a, b) => {
      const aIdx = tagOrder.indexOf(a);
      const bIdx = tagOrder.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    };
  }

  // SortConfig
  if (keys.includes("type") && keys.includes("direction")) {
    const sortConfigOrder = ["type", "direction", "matcher"];
    return (a, b) => {
      const aIdx = sortConfigOrder.indexOf(a);
      const bIdx = sortConfigOrder.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    };
  }

  // Default: alphabetical
  return (a, b) => a.localeCompare(b);
}

/**
 * Recursively sort object keys for consistent JSON serialization
 */
function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }
  if (obj !== null && typeof obj === "object") {
    const objRecord = obj as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    const keyComparator = getKeyOrder(objRecord);
    for (const key of Object.keys(objRecord).sort(keyComparator)) {
      sorted[key] = sortKeys(objRecord[key]);
    }
    return sorted;
  }
  return obj;
}

/**
 * Format config with sorted keys and schema URL
 */
export function formatConfig(config: RemoteConfig): RemoteConfig {
  const sorted = sortKeys(config) as RemoteConfig;
  return {
    $schema:
      "https://raw.githubusercontent.com/infoxchange/aws-launcher-organiser/refs/heads/main/config-schema.json",
    ...sorted,
  };
}
