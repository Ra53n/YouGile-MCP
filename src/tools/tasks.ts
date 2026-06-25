/**
 * Task tools: list / get / create / update / move / complete / archive.
 *
 * Read + safe writes. The strongest mutation is archive (archived:true) or
 * complete (completed:true) — both reversible. No hard delete.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeApiRequest } from "../services/client.js";
import { fmt, guard, makeListHandler, renderTaskDetail, renderTaskLine, type ToolArgs } from "./helpers.js";
import { toResult } from "../services/format.js";
import {
  deadlineSchema,
  includeDeletedShape,
  paginationShape,
  responseFormatShape,
  timeTrackingSchema,
  toApiDeadline,
  toApiTimeTracking,
} from "../schemas/common.js";
import type { Task } from "../types.js";

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE_NEW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const WRITE_UPD = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

/** Build the API task body from validated snake_case args (create or update). */
function buildTaskBody(a: ToolArgs): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (a.title !== undefined) body.title = a.title;
  if (a.column_id !== undefined) body.columnId = a.column_id;
  if (a.description !== undefined) body.description = a.description;
  if (a.assigned !== undefined) body.assigned = a.assigned;
  if (a.color !== undefined) body.color = a.color;
  if (a.completed !== undefined) body.completed = a.completed;
  if (a.archived !== undefined) body.archived = a.archived;
  const deadline = toApiDeadline(a.deadline as never);
  if (deadline) body.deadline = deadline;
  const tt = toApiTimeTracking(a.time_tracking as never);
  if (tt) body.timeTracking = tt;
  return body;
}

async function getTask(id: string): Promise<Task> {
  return makeApiRequest<Task>(`tasks/${id}`, "GET");
}

export function registerTaskTools(server: McpServer): void {
  server.registerTool(
    "yougile_list_tasks",
    {
      title: "List / search YouGile tasks",
      description:
        "List tasks with optional filters. This is the main task-discovery tool.\n\n" +
        "Args: title? (substring), column_id?, assigned_to? (user id), sticker_id?, sticker_state_id?, " +
        "include_deleted (default false), limit, offset, response_format.\n" +
        "Returns: { count, offset, has_more, next_offset?, tasks: [{ id, title, columnId, completed, archived, deadline, idTaskProject }] }.\n" +
        "Tip: get column ids from yougile_list_columns and user ids from yougile_list_users.",
      inputSchema: {
        title: z.string().optional().describe("Filter tasks whose title contains this substring."),
        column_id: z.string().optional().describe("Restrict to tasks in this column."),
        assigned_to: z.string().optional().describe("Restrict to tasks assigned to this user id."),
        sticker_id: z.string().optional().describe("Restrict to tasks carrying this sticker id."),
        sticker_state_id: z.string().optional().describe("Restrict to a specific sticker state id."),
        ...includeDeletedShape,
        ...paginationShape,
        ...responseFormatShape,
      },
      annotations: RO,
    },
    makeListHandler<Task>({
      endpoint: "task-list",
      itemKey: "tasks",
      heading: "Tasks",
      renderItem: renderTaskLine,
      buildParams: (a) => ({
        title: a.title,
        columnId: a.column_id,
        assignedTo: a.assigned_to,
        stickerId: a.sticker_id,
        stickerStateId: a.sticker_state_id,
        includeDeleted: a.include_deleted,
      }),
    }),
  );

  server.registerTool(
    "yougile_get_task",
    {
      title: "Get a YouGile task",
      description:
        "Fetch one task with full details (description, assignees, deadline, stickers, time tracking).\n" +
        "Args: task_id, response_format.",
      inputSchema: { task_id: z.string().min(1).describe("The task id."), ...responseFormatShape },
      annotations: RO,
    },
    guard(async (a: ToolArgs) => {
      const task = await getTask(a.task_id as string);
      return toResult({ task: task as unknown as Record<string, unknown> }, fmt(a.response_format), () =>
        renderTaskDetail(task),
      );
    }),
  );

  server.registerTool(
    "yougile_create_task",
    {
      title: "Create a YouGile task",
      description:
        "Create a task. Place it in a column with column_id (get ids from yougile_list_columns).\n\n" +
        "Args: title (required), column_id?, description?, assigned? (array of user ids), " +
        "deadline? ({ deadline: ms, start_date?: ms, with_time?: bool }), " +
        "time_tracking? ({ plan?: hours, work?: hours }), color? (e.g. 'task-red').\n" +
        "Returns the created task id.",
      inputSchema: {
        title: z.string().min(1).describe("Task title."),
        column_id: z.string().optional().describe("Column to place the task in."),
        description: z.string().optional().describe("Task description / body text."),
        assigned: z.array(z.string()).optional().describe("Array of user ids to assign."),
        deadline: deadlineSchema.optional().describe("Deadline object with ms-epoch timestamps."),
        time_tracking: timeTrackingSchema.optional().describe("Planned/worked hours."),
        color: z.string().optional().describe("Task color, e.g. 'task-red', 'task-green'."),
        ...responseFormatShape,
      },
      annotations: WRITE_NEW,
    },
    guard(async (a: ToolArgs) => {
      const result = await makeApiRequest<{ id: string }>("tasks", "POST", buildTaskBody(a));
      return toResult({ created: result }, fmt(a.response_format), () => `Created task \`${result.id}\` — "${a.title}".`);
    }),
  );

  server.registerTool(
    "yougile_update_task",
    {
      title: "Update a YouGile task",
      description:
        "Update arbitrary fields of a task. Only the fields you pass are changed.\n\n" +
        "Args: task_id (required) + any of: title?, description?, column_id? (moves the task), " +
        "assigned?, deadline?, time_tracking?, color?, completed?, archived?.\n" +
        "For simple intents prefer yougile_move_task / yougile_complete_task / yougile_archive_task.",
      inputSchema: {
        task_id: z.string().min(1).describe("The task id."),
        title: z.string().min(1).optional().describe("New title."),
        description: z.string().optional().describe("New description."),
        column_id: z.string().optional().describe("Move the task to this column id."),
        assigned: z.array(z.string()).optional().describe("Replace the assignee list with these user ids."),
        deadline: deadlineSchema.optional().describe("Set/replace the deadline."),
        time_tracking: timeTrackingSchema.optional().describe("Set planned/worked hours."),
        color: z.string().optional().describe("Task color, e.g. 'task-red'."),
        completed: z.boolean().optional().describe("Mark complete (true) or incomplete (false)."),
        archived: z.boolean().optional().describe("Archive (true) or unarchive (false)."),
        ...responseFormatShape,
      },
      annotations: WRITE_UPD,
    },
    guard(async (a: ToolArgs) => {
      const body = buildTaskBody(a);
      delete (body as Record<string, unknown>).task_id;
      await makeApiRequest(`tasks/${a.task_id}`, "PUT", body);
      return toResult({ updated: a.task_id }, fmt(a.response_format), () => `Updated task \`${a.task_id}\`.`);
    }),
  );

  server.registerTool(
    "yougile_move_task",
    {
      title: "Move a YouGile task to a column",
      description:
        "Move a task to a different column (e.g. drag it to 'In progress' or 'Done').\n" +
        "Args: task_id, column_id (get ids from yougile_list_columns).",
      inputSchema: {
        task_id: z.string().min(1).describe("The task id."),
        column_id: z.string().min(1).describe("Destination column id."),
        ...responseFormatShape,
      },
      annotations: WRITE_UPD,
    },
    guard(async (a: ToolArgs) => {
      await makeApiRequest(`tasks/${a.task_id}`, "PUT", { columnId: a.column_id });
      return toResult({ moved: a.task_id, column_id: a.column_id }, fmt(a.response_format), () =>
        `Moved task \`${a.task_id}\` to column \`${a.column_id}\`.`,
      );
    }),
  );

  server.registerTool(
    "yougile_complete_task",
    {
      title: "Complete a YouGile task",
      description:
        "Mark a task complete (or reopen it). Reversible.\nArgs: task_id, completed (default true).",
      inputSchema: {
        task_id: z.string().min(1).describe("The task id."),
        completed: z.boolean().default(true).describe("true = mark done (default), false = reopen."),
        ...responseFormatShape,
      },
      annotations: WRITE_UPD,
    },
    guard(async (a: ToolArgs) => {
      const completed = a.completed === undefined ? true : Boolean(a.completed);
      await makeApiRequest(`tasks/${a.task_id}`, "PUT", { completed });
      return toResult({ task_id: a.task_id, completed }, fmt(a.response_format), () =>
        `Task \`${a.task_id}\` marked ${completed ? "complete" : "incomplete"}.`,
      );
    }),
  );

  server.registerTool(
    "yougile_archive_task",
    {
      title: "Archive a YouGile task",
      description:
        "Archive a task (or restore it). This is the strongest removal this server supports — it is " +
        "reversible and does NOT permanently delete the task.\nArgs: task_id, archived (default true).",
      inputSchema: {
        task_id: z.string().min(1).describe("The task id."),
        archived: z.boolean().default(true).describe("true = archive (default), false = restore."),
        ...responseFormatShape,
      },
      annotations: WRITE_UPD,
    },
    guard(async (a: ToolArgs) => {
      const archived = a.archived === undefined ? true : Boolean(a.archived);
      await makeApiRequest(`tasks/${a.task_id}`, "PUT", { archived });
      return toResult({ task_id: a.task_id, archived }, fmt(a.response_format), () =>
        `Task \`${a.task_id}\` ${archived ? "archived" : "restored"}.`,
      );
    }),
  );
}
