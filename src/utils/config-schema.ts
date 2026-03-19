import { z } from "zod";

export interface TagConfig {
  key: string;
  name: string;
  colour: string;
  matcher?: string;
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
  matcher: z.string().optional(),
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
