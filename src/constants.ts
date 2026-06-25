/**
 * Shared constants for the YouGile MCP server.
 */

/** Default YouGile REST API v2 base URL (RU region). Override via YOUGILE_BASE_URL. */
export const DEFAULT_BASE_URL = "https://ru.yougile.com/api-v2";

/** Maximum number of characters in a single tool text response before truncation. */
export const CHARACTER_LIMIT = 25000;

/** Default page size for list endpoints. */
export const DEFAULT_PAGE_SIZE = 50;

/** Maximum page size YouGile accepts on list endpoints. */
export const MAX_PAGE_SIZE = 1000;

/** Hard cap on how many items auto-pagination will accumulate for one tool call. */
export const MAX_AUTO_PAGINATE_ITEMS = 1000;

/** Per-request network timeout in milliseconds. */
export const REQUEST_TIMEOUT_MS = 30000;

/** Number of retries when the API returns HTTP 429 (rate limit). */
export const RATE_LIMIT_MAX_RETRIES = 3;

/** Base backoff (ms) used when no Retry-After header is present (doubles each retry). */
export const RATE_LIMIT_BASE_BACKOFF_MS = 1000;

/** Server identity reported to MCP clients. */
export const SERVER_NAME = "yougile-mcp-server";
export const SERVER_VERSION = "1.0.0";
