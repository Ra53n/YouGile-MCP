/**
 * Shared YouGile API client.
 *
 * Single choke-point for authentication, timeouts, 429 backoff, error mapping,
 * list-envelope normalization and auto-pagination. Every tool composes this —
 * no tool should call axios directly.
 */

import axios, { AxiosError } from "axios";
import {
  DEFAULT_BASE_URL,
  MAX_AUTO_PAGINATE_ITEMS,
  MAX_PAGE_SIZE,
  RATE_LIMIT_BASE_BACKOFF_MS,
  RATE_LIMIT_MAX_RETRIES,
  REQUEST_TIMEOUT_MS,
} from "../constants.js";
import type { ListEnvelope } from "../types.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface YouGileConfig {
  apiKey: string;
  baseURL: string;
}

/** A user-facing error already formatted for the agent (safe to surface verbatim). */
export class YouGileError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "YouGileError";
    this.status = status;
  }
}

/**
 * Read configuration from the environment lazily, so importing this module does
 * not require the env to be set (used by tests and the get-key script paths).
 */
export function getConfig(): YouGileConfig {
  const apiKey = process.env.YOUGILE_API_KEY?.trim();
  if (!apiKey) {
    throw new YouGileError(
      "YOUGILE_API_KEY is not set. Generate a key in YouGile (Settings → API keys) " +
        "or run `npm run get-key`, then set it in the server's environment.",
    );
  }
  const baseURL = (process.env.YOUGILE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { apiKey, baseURL };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strip undefined/null query params so optional filters don't serialize as "undefined". */
function cleanParams(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Perform an authenticated request to the YouGile API.
 * Retries on HTTP 429 with backoff, then maps any error to an actionable message.
 */
export async function makeApiRequest<T>(
  endpoint: string,
  method: HttpMethod = "GET",
  body?: unknown,
  params?: Record<string, unknown>,
): Promise<T> {
  const { apiKey, baseURL } = getConfig();
  const url = `${baseURL}/${endpoint.replace(/^\/+/, "")}`;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const response = await axios.request<T>({
        method,
        url,
        data: body,
        params: cleanParams(params),
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });
      return response.data;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === 429 && attempt < RATE_LIMIT_MAX_RETRIES) {
        const retryAfter = retryAfterMs(error as AxiosError, attempt);
        attempt += 1;
        await sleep(retryAfter);
        continue;
      }
      throw toYouGileError(error);
    }
  }
}

function retryAfterMs(error: AxiosError, attempt: number): number {
  const header = error.response?.headers?.["retry-after"];
  if (header) {
    const seconds = Number(Array.isArray(header) ? header[0] : header);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  return RATE_LIMIT_BASE_BACKOFF_MS * Math.pow(2, attempt);
}

/** Map any thrown error to a YouGileError with an actionable, secret-free message. */
export function toYouGileError(error: unknown): YouGileError {
  if (error instanceof YouGileError) return error;

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const serverDetail = extractServerMessage(error.response?.data);
    switch (status) {
      case 400:
      case 422:
        return new YouGileError(
          `Invalid request${serverDetail ? `: ${serverDetail}` : "."} ` +
            "Check the field names/values against the tool schema.",
          status,
        );
      case 401:
        return new YouGileError(
          "Authentication failed (401). Your YOUGILE_API_KEY may be invalid or revoked — " +
            "generate a new one with `npm run get-key` and update the server environment.",
          status,
        );
      case 403:
        return new YouGileError(
          "Permission denied (403). The API key's account/company does not have access to this resource.",
          status,
        );
      case 404:
        return new YouGileError(
          "Not found (404). Verify the id — use the matching list_* tool (list_projects, list_boards, " +
            "list_columns, list_tasks) to discover valid ids.",
          status,
        );
      case 429:
        return new YouGileError(
          "Rate limit exceeded (429, ~50 requests/minute per company). Wait a moment and retry, " +
            "or narrow filters / lower `limit`.",
          status,
        );
      default:
        if (status && status >= 500) {
          return new YouGileError(`YouGile server error (${status}). Please retry shortly.`, status);
        }
    }
    if (error.code === "ECONNABORTED") {
      return new YouGileError("Request timed out contacting YouGile. Check connectivity and try again.");
    }
    if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      return new YouGileError(
        "Network error contacting YouGile. Check connectivity and the YOUGILE_BASE_URL value.",
      );
    }
    return new YouGileError(
      `YouGile request failed${status ? ` (status ${status})` : ""}${serverDetail ? `: ${serverDetail}` : "."}`,
      status,
    );
  }

  return new YouGileError(
    `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
  );
}

function extractServerMessage(data: unknown): string | undefined {
  if (!data) return undefined;
  if (typeof data === "string") return data.slice(0, 300);
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const msg = obj.message ?? obj.error ?? obj.detail;
    if (typeof msg === "string") return msg.slice(0, 300);
  }
  return undefined;
}

/** Read the array out of a list envelope, tolerant of `content` vs `data` vs bare array. */
export function extractListArray<T>(envelope: ListEnvelope<T> | T[] | undefined): T[] {
  if (!envelope) return [];
  if (Array.isArray(envelope)) return envelope;
  return envelope.content ?? envelope.data ?? [];
}

export interface PaginatedResult<T> {
  items: T[];
  fetched: number;
  hasMore: boolean;
  nextOffset: number;
}

/**
 * Auto-paginate a GET list endpoint up to a budget.
 * Stops when a page returns fewer than the page size, the item cap is hit, or
 * the estimated serialized size approaches `charBudget`.
 */
export async function paginateList<T>(
  endpoint: string,
  params: Record<string, unknown>,
  options: { startOffset?: number; pageSize?: number; maxItems?: number; charBudget?: number } = {},
): Promise<PaginatedResult<T>> {
  const pageSize = Math.min(options.pageSize ?? 50, MAX_PAGE_SIZE);
  const maxItems = options.maxItems ?? MAX_AUTO_PAGINATE_ITEMS;
  const charBudget = options.charBudget ?? Infinity;

  let offset = options.startOffset ?? 0;
  const items: T[] = [];
  let hasMore = false;

  while (items.length < maxItems) {
    const limit = Math.min(pageSize, maxItems - items.length);
    const envelope = await makeApiRequest<ListEnvelope<T>>(endpoint, "GET", undefined, {
      ...params,
      limit,
      offset,
    });
    const page = extractListArray<T>(envelope);
    items.push(...page);
    offset += page.length;

    const reportedNext = envelope?.paging?.next;
    const pageWasFull = page.length === limit;
    hasMore = Boolean(reportedNext) || pageWasFull;

    if (page.length < limit) {
      hasMore = false;
      break;
    }
    if (charBudget !== Infinity && estimateSize(items) > charBudget) {
      hasMore = true;
      break;
    }
  }

  return { items, fetched: items.length, hasMore, nextOffset: offset };
}

function estimateSize(items: unknown[]): number {
  try {
    return JSON.stringify(items).length;
  } catch {
    return items.length * 200;
  }
}
