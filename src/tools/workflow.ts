/**
 * High-value workflow/analytics tools: board_summary, my_tasks, overdue_tasks.
 * All read-only; they compose the lower-level list endpoints.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CHARACTER_LIMIT } from "../constants.js";
import { paginateList } from "../services/client.js";
import { resolveCurrentUserId } from "../services/identity.js";
import { daysAgo, humanizeDeadline, toResult } from "../services/format.js";
import { paginationShape, responseFormatShape } from "../schemas/common.js";
import type { Column, Task } from "../types.js";
import { fmt, guard, renderTaskLine, type ToolArgs } from "./helpers.js";

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const MAX_SCAN = 1000; // safety cap on tasks scanned for analytics

function isOverdue(task: Task, asOf: number): boolean {
  const due = task.deadline?.deadline;
  return Boolean(due) && (due as number) < asOf && task.completed !== true && task.archived !== true;
}

async function fetchTasks(params: Record<string, unknown>): Promise<{ items: Task[]; hasMore: boolean }> {
  const { items, hasMore } = await paginateList<Task>("task-list", params, {
    pageSize: 200,
    maxItems: MAX_SCAN,
    charBudget: CHARACTER_LIMIT * 4, // larger internal budget; final output is truncated separately
  });
  return { items, hasMore };
}

export function registerWorkflowTools(server: McpServer): void {
  server.registerTool(
    "yougile_board_summary",
    {
      title: "Summarize a YouGile board",
      description:
        "Per-column rollup for a board: task counts (total / open / completed / overdue) for each column " +
        "plus a board total. Great for a quick status overview.\n" +
        "Args: board_id (required), include_archived (default false), response_format.\n" +
        "Returns: { board_id, columns: [{ id, title, total, open, completed, overdue }], totals }.",
      inputSchema: {
        board_id: z.string().min(1).describe("The board id to summarize."),
        include_archived: z.boolean().default(false).describe("Count archived tasks too (default false)."),
        ...responseFormatShape,
      },
      annotations: RO,
    },
    guard(async (a: ToolArgs) => {
      const asOf = Date.now();
      const includeArchived = Boolean(a.include_archived);
      const { items: columns } = await paginateList<Column>(
        "columns",
        { boardId: a.board_id },
        { pageSize: 200, maxItems: 500 },
      );

      const perColumn = await Promise.all(
        columns.map(async (col) => {
          const { items: tasks } = await fetchTasks({ columnId: col.id });
          const visible = includeArchived ? tasks : tasks.filter((t) => t.archived !== true);
          const completed = visible.filter((t) => t.completed === true).length;
          const overdue = visible.filter((t) => isOverdue(t, asOf)).length;
          return {
            id: col.id,
            title: col.title ?? "(untitled)",
            total: visible.length,
            open: visible.length - completed,
            completed,
            overdue,
          };
        }),
      );

      const totals = perColumn.reduce(
        (acc, c) => ({
          total: acc.total + c.total,
          open: acc.open + c.open,
          completed: acc.completed + c.completed,
          overdue: acc.overdue + c.overdue,
        }),
        { total: 0, open: 0, completed: 0, overdue: 0 },
      );

      return toResult({ board_id: a.board_id, columns: perColumn, totals }, fmt(a.response_format), () => {
        const lines = [
          `# Board summary \`${a.board_id}\``,
          "",
          `**Totals:** ${totals.total} tasks · ${totals.open} open · ${totals.completed} done · ${totals.overdue} overdue`,
          "",
          "| Column | Total | Open | Done | Overdue |",
          "| --- | ---: | ---: | ---: | ---: |",
        ];
        for (const c of perColumn) {
          lines.push(`| ${c.title} | ${c.total} | ${c.open} | ${c.completed} | ${c.overdue} |`);
        }
        return lines.join("\n");
      });
    }),
  );

  server.registerTool(
    "yougile_my_tasks",
    {
      title: "List my YouGile tasks",
      description:
        "Tasks assigned to the current user (see YOUGILE_USER_ID). By default only open (incomplete) tasks.\n" +
        "Args: include_completed (default false), column_id?, limit, offset, response_format.\n" +
        "If the current user can't be resolved, returns guidance to set YOUGILE_USER_ID.",
      inputSchema: {
        include_completed: z.boolean().default(false).describe("Include completed tasks (default false)."),
        column_id: z.string().optional().describe("Restrict to a single column."),
        ...paginationShape,
        ...responseFormatShape,
      },
      annotations: RO,
    },
    guard(async (a: ToolArgs) => {
      const userId = await resolveCurrentUserId();
      const limit = typeof a.limit === "number" ? a.limit : 50;
      const offset = typeof a.offset === "number" ? a.offset : 0;
      const { items, hasMore, nextOffset } = await paginateList<Task>(
        "task-list",
        { assignedTo: userId, columnId: a.column_id },
        { startOffset: offset, pageSize: limit, maxItems: limit, charBudget: CHARACTER_LIMIT },
      );
      const filtered = a.include_completed ? items : items.filter((t) => t.completed !== true);
      return toResult(
        {
          user_id: userId,
          count: filtered.length,
          offset,
          has_more: hasMore,
          ...(hasMore ? { next_offset: nextOffset } : {}),
          tasks: filtered,
        },
        fmt(a.response_format),
        () => {
          const lines = [`# My tasks (${filtered.length}${hasMore ? "+" : ""}) — user \`${userId}\``, ""];
          if (!filtered.length) lines.push("_No matching tasks._");
          for (const t of filtered) lines.push(renderTaskLine(t));
          return lines.join("\n");
        },
      );
    }),
  );

  server.registerTool(
    "yougile_overdue_tasks",
    {
      title: "List overdue YouGile tasks",
      description:
        "Tasks past their deadline and not completed/archived (deadline < as_of). Sorted most-overdue first.\n" +
        "Args: assigned_to? ('me' or a user id), board_id? (scope to one board), as_of? (ms-epoch, default now), " +
        "limit, offset, response_format.",
      inputSchema: {
        assigned_to: z.string().optional().describe("'me' (uses YOUGILE_USER_ID) or a specific user id."),
        board_id: z.string().optional().describe("Restrict to tasks on this board."),
        as_of: z.number().int().optional().describe("Reference timestamp in ms-epoch (default: now)."),
        ...paginationShape,
        ...responseFormatShape,
      },
      annotations: RO,
    },
    guard(async (a: ToolArgs) => {
      const asOf = typeof a.as_of === "number" ? a.as_of : Date.now();
      const limit = typeof a.limit === "number" ? a.limit : 50;
      const offset = typeof a.offset === "number" ? a.offset : 0;

      let assignedTo: string | undefined;
      if (a.assigned_to === "me") assignedTo = await resolveCurrentUserId();
      else if (typeof a.assigned_to === "string") assignedTo = a.assigned_to;

      // Gather candidate tasks. If board_id is given, scope via that board's columns.
      let candidates: Task[] = [];
      let scanTruncated = false;
      if (typeof a.board_id === "string") {
        const { items: columns } = await paginateList<Column>(
          "columns",
          { boardId: a.board_id },
          { pageSize: 200, maxItems: 500 },
        );
        for (const col of columns) {
          const { items, hasMore } = await fetchTasks({ columnId: col.id, assignedTo });
          candidates.push(...items);
          scanTruncated = scanTruncated || hasMore;
        }
      } else {
        const { items, hasMore } = await fetchTasks({ assignedTo });
        candidates = items;
        scanTruncated = hasMore;
      }

      const overdue = candidates
        .filter((t) => isOverdue(t, asOf))
        .sort((x, y) => (x.deadline?.deadline ?? 0) - (y.deadline?.deadline ?? 0));

      const page = overdue.slice(offset, offset + limit);
      const hasMore = offset + limit < overdue.length;

      return toResult(
        {
          as_of: asOf,
          total_overdue: overdue.length,
          count: page.length,
          offset,
          has_more: hasMore,
          ...(hasMore ? { next_offset: offset + limit } : {}),
          scan_truncated: scanTruncated,
          tasks: page,
        },
        fmt(a.response_format),
        () => {
          const lines = [`# Overdue tasks (${overdue.length})`, ""];
          if (scanTruncated) lines.push(`_Note: scan hit the ${MAX_SCAN}-task cap; some tasks may be missing._`, "");
          if (!page.length) lines.push("_No overdue tasks._");
          for (const t of page) {
            const due = t.deadline?.deadline ?? 0;
            lines.push(`${renderTaskLine(t)} — ${daysAgo(due, asOf)}d overdue (due ${humanizeDeadline(t.deadline)})`);
          }
          if (hasMore) lines.push("", `_More overdue tasks — use offset=${offset + limit}._`);
          return lines.join("\n");
        },
      );
    }),
  );
}
