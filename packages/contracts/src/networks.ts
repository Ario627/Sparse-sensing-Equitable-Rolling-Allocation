import { z } from "zod";
import { pageSchema, pageSizeSchema, sortOrderSchema } from "./query.ts";

export const networkIdSchema = z.uuid();

export const topologySchema = z.enum(["CHAIN", "BRANCHED", "MIXED"]);

export const nodeTypeSchema = z.enum([
  "SOURCE",
  "JUNCTION",
  "GATE",
  "BLOCK_TERMINAL",
]);

export const lossZoneSchema = z.enum(["HEAD", "MIDDLE", "TAIL"]);

export const networkSortFieldSchema = z.enum([
  "created_at",
  "updated_at",
  "name",
]);

export const graphNodeSchema = z.strictObject({
  id: z.uuid(),
  type: nodeTypeSchema,
  name: z.string().trim().min(1).max(80),
  order_idx: z.int().nonnegative().max(1_000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const graphEdgeSchema = z.strictObject({
  from_node_id: z.uuid(),
  to_node_id: z.uuid(),
  length_m: z.number().positive().max(50_000).nullable().optional(),
  capacity_lps: z.number().positive().max(1_000),
  zone: lossZoneSchema,
});

export const graphBlockSchema = z.strictObject({
  node_id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  area_m2: z.number().positive().max(1_000_000),
  crop_type: z.string().trim().min(1).max(40).default("paddy"),
  nominal_flow_lps: z.number().positive().max(1_000),
  distance_from_source_m: z
    .number()
    .nonnegative()
    .max(100_000)
    .nullable()
    .optional(),
  soil_type: z.string().trim().min(1).max(60).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const networkGraphSchema = z.strictObject({
  nodes: z.array(graphNodeSchema).min(2).max(120),
  edges: z.array(graphEdgeSchema).max(300),
  blocks: z.array(graphBlockSchema).min(1).max(120),
});

export const listNetworksQuerySchema = z.strictObject({
  q: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) =>
      value === undefined || value.length === 0 ? undefined : value,
    ),
  topology: topologySchema.optional(),
  page: pageSchema,
  limit: pageSizeSchema,
  sort: networkSortFieldSchema.default("created_at"),
  order: sortOrderSchema.default("desc"),
});

export const createNetworkRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: z
    .string()
    .trim()
    .max(400)
    .nullable()
    .optional()
    .transform((value) =>
      value === undefined || value === null || value.length === 0
        ? null
        : value,
    ),
  topology: topologySchema,
  p3a_id: z.uuid().nullable().optional(),
  graph: networkGraphSchema,
});

export const replaceNetworkGraphRequestSchema = z.strictObject({
  topology: topologySchema,
  graph: networkGraphSchema,
});

export const updateNetworkRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    description: z
      .string()
      .trim()
      .max(400)
      .nullable()
      .optional()
      .transform((value) => {
        if (value === undefined || value === null) {
          return value;
        }
        return value.length === 0 ? null : value;
      }),
    topology: topologySchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { error: "at least one field must be provided" },
  );

export const networkSummarySchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  topology: topologySchema,
  p3a_id: z.uuid().nullable(),
  node_count: z.int().nonnegative(),
  edge_count: z.int().nonnegative(),
  block_count: z.int().nonnegative(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const networkNodeSchema = z.strictObject({
  id: z.uuid(),
  type: nodeTypeSchema,
  name: z.string().min(1),
  order_idx: z.int().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const networkEdgeSchema = z.strictObject({
  id: z.uuid(),
  from_node_id: z.uuid(),
  to_node_id: z.uuid(),
  length_m: z.number().nullable(),
  capacity_lps: z.number(),
  zone: lossZoneSchema,
});

export const networkBlockSchema = z.strictObject({
  id: z.uuid(),
  node_id: z.uuid(),
  name: z.string().min(1),
  area_m2: z.number(),
  crop_type: z.string().min(1),
  nominal_flow_lps: z.number(),
  distance_from_source_m: z.number().nullable(),
  soil_type: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const networkDetailSchema = networkSummarySchema.extend({
  nodes: z.array(networkNodeSchema),
  edges: z.array(networkEdgeSchema),
  blocks: z.array(networkBlockSchema),
});

export const networksListResponseSchema = z.strictObject({
  items: z.array(networkSummarySchema),
  page: z.int().positive(),
  limit: z.int().positive(),
  total: z.int().nonnegative(),
  total_pages: z.int().positive(),
});

export type Topology = z.infer<typeof topologySchema>;
export type NodeType = z.infer<typeof nodeTypeSchema>;
export type LossZone = z.infer<typeof lossZoneSchema>;
export type NetworkSortField = z.infer<typeof networkSortFieldSchema>;
export type GraphNodeInput = z.infer<typeof graphNodeSchema>;
export type GraphEdgeInput = z.infer<typeof graphEdgeSchema>;
export type GraphBlockInput = z.infer<typeof graphBlockSchema>;
export type NetworkGraphInput = z.infer<typeof networkGraphSchema>;
export type ListNetworksQuery = z.infer<typeof listNetworksQuerySchema>;
export type CreateNetworkRequest = z.infer<typeof createNetworkRequestSchema>;
export type ReplaceNetworkGraphRequest = z.infer<
  typeof replaceNetworkGraphRequestSchema
>;
export type UpdateNetworkRequest = z.infer<typeof updateNetworkRequestSchema>;
export type NetworkSummaryResponse = z.infer<typeof networkSummarySchema>;
export type NetworkNodeResponse = z.infer<typeof networkNodeSchema>;
export type NetworkEdgeResponse = z.infer<typeof networkEdgeSchema>;
export type NetworkBlockResponse = z.infer<typeof networkBlockSchema>;
export type NetworkDetailResponse = z.infer<typeof networkDetailSchema>;
export type NetworksListResponse = z.infer<typeof networksListResponseSchema>;
