import { z } from "zod";
import { alertCodeSchema, alertSeveritySchema } from "./envelope.ts";
import { pageSchema, pageSizeSchema, sortOrderSchema } from "./query.ts";

export const eventIdSchema = z.uuid();

export const eventTypeSchema = z.enum([
  "trigger",
  "fallback",
  "alert",
  "system",
]);

export const listEventsQuerySchema = z
  .strictObject({
    type: eventTypeSchema.optional(),
    severity: alertSeveritySchema.optional(),
    code: alertCodeSchema.optional(),
    acknowledged: z.stringbool().optional(),
    network_id: z.uuid().optional(),
    plan_id: z.uuid().optional(),
    q: z
      .string()
      .trim()
      .max(160)
      .optional()
      .transform((value) =>
        value === undefined || value.length === 0 ? undefined : value,
      ),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    page: pageSchema,
    limit: pageSizeSchema,
    order: sortOrderSchema.default("desc"),
  })
  .refine(
    (value) =>
      value.from === undefined ||
      value.to === undefined ||
      Date.parse(value.from) <= Date.parse(value.to),
    { error: "from must not be later than to" },
  );

export const eventActorSchema = z.strictObject({
  id: z.uuid(),
  full_name: z.string().min(1),
});

export const eventSchema = z.strictObject({
  id: z.uuid(),
  type: eventTypeSchema,
  severity: alertSeveritySchema,
  message: z.string().min(1),
  network_id: z.uuid().nullable(),
  plan_id: z.uuid().nullable(),
  payload: z.unknown().nullable(),
  acknowledged_at: z.iso.datetime().nullable(),
  acknowledged_by: eventActorSchema.nullable(),
  created_at: z.iso.datetime(),
});

export const eventsListResponseSchema = z.strictObject({
  items: z.array(eventSchema),
  page: z.int().positive(),
  limit: z.int().positive(),
  total: z.int().nonnegative(),
  total_pages: z.int().positive(),
});

export const eventsStatsResponseSchema = z.strictObject({
  unacknowledged: z.int().nonnegative(),
  by_severity: z.strictObject({
    info: z.int().nonnegative(),
    warning: z.int().nonnegative(),
    critical: z.int().nonnegative(),
  }),
});

export type EventType = z.infer<typeof eventTypeSchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type EventActorResponse = z.infer<typeof eventActorSchema>;
export type EventResponse = z.infer<typeof eventSchema>;
export type EventsListResponse = z.infer<typeof eventsListResponseSchema>;
export type EventsStatsResponse = z.infer<typeof eventsStatsResponseSchema>;
