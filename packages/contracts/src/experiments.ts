import { z } from "zod";
import { experimentStatusSchema } from "./envelope.ts";
import { topologySchema } from "./networks.ts";
import { pageSchema, pageSizeSchema } from "./query.ts";

export const experimentIdSchema = z.uuid();

export const createExperimentRequestSchema = z.strictObject({
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
  network_id: z.uuid().optional(),
  config_yaml: z.string().trim().min(10).max(100_000),
  seed_base: z.int().min(0).max(1_000_000_000).optional(),
});

export const listExperimentsQuerySchema = z.strictObject({
  status: experimentStatusSchema.optional(),
  network_id: z.uuid().optional(),
  page: pageSchema,
  limit: pageSizeSchema,
});

export const listExperimentRunsQuerySchema = z.strictObject({
  page: pageSchema,
  limit: pageSizeSchema,
});

export const experimentRunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
]);

export const experimentSummarySchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  network_id: z.uuid().nullable(),
  network_name: z.string().nullable(),
  status: experimentStatusSchema,
  seed_base: z.int().nullable(),
  config_hash: z.string().min(8),
  solver_experiment_id: z.string().nullable(),
  runs_total: z.int().positive().nullable(),
  runs_done: z.int().nonnegative(),
  median_regret: z.number().nonnegative().nullable(),
  worst_sr: z.number().nonnegative().nullable(),
  progress_polled_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  started_at: z.iso.datetime().nullable(),
  finished_at: z.iso.datetime().nullable(),
});

export const experimentDetailSchema = experimentSummarySchema.extend({
  config_yaml: z.string().min(1),
});

export const experimentRunSchema = z.strictObject({
  run_index: z.int().nonnegative(),
  scenario_id: z.string().min(1),
  seed: z.int().nonnegative(),
  method: z.string().min(1),
  sensor_count: z.int().nonnegative(),
  topology: topologySchema,
  k_factor: z.number().nullable(),
  status: experimentRunStatusSchema,
  parquet_path: z.string().nullable(),
  metrics: z.unknown().nullable(),
  started_at: z.iso.datetime().nullable(),
  finished_at: z.iso.datetime().nullable(),
});

export const experimentsListResponseSchema = z.strictObject({
  items: z.array(experimentSummarySchema),
  page: z.int().positive(),
  limit: z.int().positive(),
  total: z.int().nonnegative(),
  total_pages: z.int().positive(),
});

export const experimentRunsResponseSchema = z.strictObject({
  items: z.array(experimentRunSchema),
  page: z.int().positive(),
  limit: z.int().positive(),
  total: z.int().nonnegative(),
  total_pages: z.int().positive(),
});

export type CreateExperimentRequest = z.infer<
  typeof createExperimentRequestSchema
>;
export type ListExperimentsQuery = z.infer<typeof listExperimentsQuerySchema>;
export type ListExperimentRunsQuery = z.infer<
  typeof listExperimentRunsQuerySchema
>;
export type ExperimentRunStatus = z.infer<typeof experimentRunStatusSchema>;
export type ExperimentSummaryResponse = z.infer<typeof experimentSummarySchema>;
export type ExperimentDetailResponse = z.infer<typeof experimentDetailSchema>;
export type ExperimentRunResponse = z.infer<typeof experimentRunSchema>;
export type ExperimentsListResponse = z.infer<
  typeof experimentsListResponseSchema
>;
export type ExperimentRunsResponse = z.infer<
  typeof experimentRunsResponseSchema
>;
