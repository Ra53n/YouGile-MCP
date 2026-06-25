/**
 * Shared helpers and renderers for tool handlers (DRY).
 */

import { CHARACTER_LIMIT } from "../constants.js";
import { paginateList, toYouGileError } from "../services/client.js";
import {
  formatTimestamp,
  humanizeDeadline,
  paginationMeta,
  ResponseFormat,
  toError,
  toResult,
  type ToolResult,
} from "../services/format.js";
import type {
  Board,
  ChatMessage,
  Column,
  Project,
  Sticker,
  Task,
  User,
} from "../types.js";

/** Loose alias for validated tool arguments (the SDK supplies the concrete shape). */
export type ToolArgs = Record<string, unknown>;

function num(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function fmt(value: unknown): ResponseFormat {
  return value === ResponseFormat.JSON ? ResponseFormat.JSON : ResponseFormat.MARKDOWN;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build a standard list-tool handler: maps filters → query params, auto-paginates
 * one page up to `limit`, and renders Markdown or JSON with pagination metadata.
 */
export function makeListHandler<T>(cfg: {
  endpoint: string;
  itemKey: string;
  buildParams: (args: ToolArgs) => Record<string, unknown>;
  renderItem: (item: T) => string;
  heading: string;
}): (args: ToolArgs) => Promise<ToolResult> {
  return async (args: ToolArgs): Promise<ToolResult> => {
    try {
      const limit = num(args.limit, 50);
      const offset = num(args.offset, 0);
      const format = fmt(args.response_format);
      const params = cfg.buildParams(args);

      const { items, hasMore, nextOffset } = await paginateList<T>(cfg.endpoint, params, {
        startOffset: offset,
        pageSize: limit,
        maxItems: limit,
        charBudget: CHARACTER_LIMIT,
      });

      const meta = paginationMeta(items.length, offset, hasMore, nextOffset);
      const structured: Record<string, unknown> = { ...meta, [cfg.itemKey]: items };

      return toResult(structured, format, () => {
        const lines = [`# ${cfg.heading} (${items.length}${hasMore ? "+" : ""})`, ""];
        if (!items.length) lines.push("_No results._");
        for (const item of items) lines.push(cfg.renderItem(item));
        if (hasMore) lines.push("", `_More results available — call again with offset=${nextOffset}._`);
        return lines.join("\n");
      });
    } catch (error) {
      return toError(toYouGileError(error).message);
    }
  };
}

/** Wrap a mutating/single-item handler with uniform error handling. */
export function guard(
  fn: (args: ToolArgs) => Promise<ToolResult>,
): (args: ToolArgs) => Promise<ToolResult> {
  return async (args: ToolArgs): Promise<ToolResult> => {
    try {
      return await fn(args);
    } catch (error) {
      return toError(toYouGileError(error).message);
    }
  };
}

export { num, fmt, capitalize };

// ── Markdown renderers ───────────────────────────────────────────────────────

export function renderProjectLine(p: Project): string {
  return `- **${p.title ?? "(untitled)"}** (\`${p.id}\`)${p.deleted ? " — _deleted_" : ""}`;
}

export function renderBoardLine(b: Board): string {
  return `- **${b.title ?? "(untitled)"}** (\`${b.id}\`)${b.projectId ? ` — project \`${b.projectId}\`` : ""}${b.deleted ? " — _deleted_" : ""}`;
}

export function renderColumnLine(c: Column): string {
  return `- **${c.title ?? "(untitled)"}** (\`${c.id}\`)${c.deleted ? " — _deleted_" : ""}`;
}

export function renderUserLine(u: User): string {
  const name = u.realName ?? u.name ?? "(no name)";
  return `- **${name}** — ${u.email ?? "no email"} (\`${u.id}\`)${u.isAdmin ? " — admin" : ""}`;
}

export function renderTaskLine(t: Task): string {
  const flags: string[] = [];
  if (t.completed) flags.push("✓ done");
  if (t.archived) flags.push("archived");
  if (t.deadline?.deadline) flags.push(`due ${humanizeDeadline(t.deadline)}`);
  const suffix = flags.length ? ` — ${flags.join(", ")}` : "";
  const shortId = t.idTaskProject ? ` [${t.idTaskProject}]` : "";
  return `- **${t.title ?? "(untitled)"}**${shortId} (\`${t.id}\`)${suffix}`;
}

export function renderTaskDetail(t: Task): string {
  const lines = [
    `# ${t.title ?? "(untitled)"}${t.idTaskProject ? ` [${t.idTaskProject}]` : ""}`,
    `- **id**: \`${t.id}\``,
    `- **column**: ${t.columnId ? `\`${t.columnId}\`` : "—"}`,
    `- **status**: ${t.completed ? "completed" : "open"}${t.archived ? ", archived" : ""}`,
    `- **deadline**: ${humanizeDeadline(t.deadline)}`,
  ];
  if (t.assigned?.length) lines.push(`- **assigned**: ${t.assigned.map((a) => `\`${a}\``).join(", ")}`);
  if (t.stickers && Object.keys(t.stickers).length) {
    lines.push(`- **stickers**: ${Object.entries(t.stickers).map(([k, v]) => `\`${k}\`=\`${v}\``).join(", ")}`);
  }
  if (t.timeTracking) {
    lines.push(`- **time**: plan ${t.timeTracking.plan ?? "—"}h / work ${t.timeTracking.work ?? "—"}h`);
  }
  if (t.description) lines.push("", "## Description", t.description);
  return lines.join("\n");
}

export function renderStickerDetail(s: Sticker): string {
  const lines = [`- **${s.name ?? "(unnamed)"}** (\`${s.id}\`)${s.deleted ? " — _deleted_" : ""}`];
  for (const state of s.states ?? []) {
    lines.push(`    - state **${state.name ?? "(unnamed)"}** (\`${state.id}\`)${state.color ? ` — ${state.color}` : ""}`);
  }
  return lines.join("\n");
}

export function renderMessageLine(m: ChatMessage): string {
  const who = m.fromUserId ? `\`${m.fromUserId}\`` : "system";
  const when = formatTimestamp(m.timestamp);
  const text = (m.text ?? "").replace(/\s+/g, " ").trim();
  return `- **${who}** · ${when}${m.deleted ? " · _deleted_" : ""}\n  ${text || "_(empty)_"}`;
}
