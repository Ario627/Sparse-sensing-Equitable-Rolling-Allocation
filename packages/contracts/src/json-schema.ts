import { z } from "zod";

export type JsonSchemaTarget = "draft-2020-12" | "openapi-3.0";

export interface JsonSchemaOptions {
  readonly target?: JsonSchemaTarget;
  readonly io?: "input" | "output";
}

export function toJsonSchema(
    schema: z.ZodType,
    options: JsonSchemaOptions = {},
): Record<string, unknown> {
    return z.toJSONSchema(schema, {
        target: options.target ?? "draft-2020-12",
        io: options.io ?? "input",
    }) as Record<string, unknown>;
}