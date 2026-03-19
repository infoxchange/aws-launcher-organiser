import { z } from "zod";

export interface PredefinedGroup {
  key: string;
  name: string;
  icon?: string;
  matcher?: string | string[];
  children?: PredefinedGroup[];
  expandedByDefault?: boolean;
  description?: string;
}

export const PredefinedGroupSchema: z.ZodType<PredefinedGroup> = z.lazy(() =>
  z.object({
    key: z.string(),
    name: z.string(),
    icon: z.string().optional(),
    matcher: z.union([z.string(), z.array(z.string())]).optional(),
    children: z.array(PredefinedGroupSchema).optional(),
    expandedByDefault: z.boolean().optional(),
    description: z.string().optional(),
  })
);

export const RemoteConfigSchema = z.object({
  $schema: z.string().optional(),
  version: z.number(),
  groups: z.array(PredefinedGroupSchema),
});

export type RemoteConfig = z.infer<typeof RemoteConfigSchema>;
