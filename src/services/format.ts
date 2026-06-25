/**
 * Response formatting helpers shared by all tools (DRY).
 *
 * Tools return either human-readable Markdown or machine-readable JSON, both
 * derived from the same structured object, truncated to CHARACTER_LIMIT.
 */

import { CHARACTER_LIMIT } from "../constants.js";
import type { Deadline } from "../types.js";

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

/** Shape accepted by the MCP SDK as a tool result (structurally compatible). */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  /** The SDK's CallToolResult is a passthrough object with an index signature. */
  [key: string]: unknown;
}

/** Truncate a string to the character budget with a clear notice. */
export function truncateText(text: string, limit = CHARACTER_LIMIT): string {
  if (text.length <= limit) return text;
  return (
    text.slice(0, limit) +
    `\n\n… [truncated: response exceeded ${limit} characters — narrow filters, lower \`limit\`, ` +
    "or use `offset` to page through results]"
  );
}

/**
 * Build a tool result from a structured object plus a Markdown renderer.
 * `structured` is always attached as structuredContent for programmatic clients.
 */
export function toResult(
  structured: Record<string, unknown>,
  format: ResponseFormat,
  renderMarkdown: () => string,
): ToolResult {
  const text =
    format === ResponseFormat.JSON
      ? truncateText(JSON.stringify(structured, null, 2))
      : truncateText(renderMarkdown());
  return { content: [{ type: "text", text }], structuredContent: structured };
}

/** Build an error tool result (surfaced to the agent, not a protocol error). */
export function toError(message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
}

/** Build a simple text-only result. */
export function toText(text: string, structured?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: truncateText(text) }], structuredContent: structured };
}

/** Format a YouGile ms-epoch timestamp as a readable UTC string, or "—". */
export function formatTimestamp(ms?: number | null): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  } catch {
    return String(ms);
  }
}

/** Human-readable rendering of a deadline object. */
export function humanizeDeadline(deadline?: Deadline | null): string {
  if (!deadline || !deadline.deadline) return "—";
  return formatTimestamp(deadline.deadline);
}

/** Whole-day difference between a timestamp and a reference (positive = in the past). */
export function daysAgo(ms: number, asOf: number): number {
  return Math.floor((asOf - ms) / 86_400_000);
}

/** Standard pagination metadata block for list results. */
export interface PaginationMeta {
  count: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
}

export function paginationMeta(count: number, offset: number, hasMore: boolean, nextOffset: number): PaginationMeta {
  return {
    count,
    offset,
    has_more: hasMore,
    ...(hasMore ? { next_offset: nextOffset } : {}),
  };
}
