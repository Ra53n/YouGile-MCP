/**
 * Reusable Zod fragments composed into per-tool input shapes.
 *
 * The MCP SDK's `registerTool` expects `inputSchema` as a ZodRawShape (a plain
 * object of Zod fields), so these are exported as spreadable shape fragments.
 */

import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";
import { ResponseFormat } from "../services/format.js";

/** limit / offset for list tools. */
export const paginationShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe(`Maximum items to return (1–${MAX_PAGE_SIZE}, default ${DEFAULT_PAGE_SIZE}).`),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of items to skip, for pagination (default 0)."),
};

/** response_format selector for any data-returning tool. */
export const responseFormatShape = {
  response_format: z
    .nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' (human-readable, default) or 'json' (full structured data)."),
};

/** include_deleted flag shared by most list endpoints. */
export const includeDeletedShape = {
  include_deleted: z
    .boolean()
    .default(false)
    .describe("Include deleted/archived items in results (default false)."),
};

/** Nested deadline object accepted by task create/update. */
export const deadlineSchema = z
  .object({
    deadline: z.number().int().describe("Deadline timestamp in ms since epoch."),
    start_date: z.number().int().optional().describe("Optional start timestamp in ms since epoch."),
    with_time: z.boolean().optional().describe("Whether the deadline includes a time of day."),
  })
  .strict();

/** Nested time-tracking object accepted by task create/update. */
export const timeTrackingSchema = z
  .object({
    plan: z.number().optional().describe("Planned hours."),
    work: z.number().optional().describe("Worked/spent hours."),
  })
  .strict();

/** Map a tool's snake_case deadline to the API's camelCase shape. */
export function toApiDeadline(
  d?: { deadline: number; start_date?: number; with_time?: boolean },
): Record<string, unknown> | undefined {
  if (!d) return undefined;
  return {
    deadline: d.deadline,
    ...(d.start_date !== undefined ? { startDate: d.start_date } : {}),
    ...(d.with_time !== undefined ? { withTime: d.with_time } : {}),
  };
}

/** Map a tool's snake_case time-tracking to the API's shape. */
export function toApiTimeTracking(
  t?: { plan?: number; work?: number },
): Record<string, unknown> | undefined {
  if (!t) return undefined;
  return { ...(t.plan !== undefined ? { plan: t.plan } : {}), ...(t.work !== undefined ? { work: t.work } : {}) };
}
