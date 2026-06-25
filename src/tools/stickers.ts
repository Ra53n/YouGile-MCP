/**
 * Sticker tools: list/create label (string) stickers, list sprint stickers,
 * and attach/detach sticker states on a task with MERGE semantics.
 *
 * IMPORTANT: on a task, `stickers` is an object map { stickerId: stateId }, not
 * an array. set_task_stickers reads the current map, merges, and writes it back
 * so other stickers are never dropped.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeApiRequest } from "../services/client.js";
import { toError, toResult } from "../services/format.js";
import { includeDeletedShape, paginationShape, responseFormatShape } from "../schemas/common.js";
import type { Sticker, Task } from "../types.js";
import { fmt, guard, makeListHandler, renderStickerDetail, type ToolArgs } from "./helpers.js";

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE_NEW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const WRITE_UPD = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export function registerStickerTools(server: McpServer): void {
  server.registerTool(
    "yougile_list_string_stickers",
    {
      title: "List YouGile string (label) stickers",
      description:
        "List custom string stickers (labels) and their states. Use this to discover sticker ids and " +
        "state ids before tagging a task with yougile_set_task_stickers.\n" +
        "Args: name?, board_id?, include_deleted (default false), limit, offset, response_format.\n" +
        "Returns: { count, ..., string_stickers: [{ id, name, states: [{ id, name, color }] }] }.",
      inputSchema: {
        name: z.string().optional().describe("Filter by sticker name substring."),
        board_id: z.string().optional().describe("Restrict to stickers used on this board."),
        ...includeDeletedShape,
        ...paginationShape,
        ...responseFormatShape,
      },
      annotations: RO,
    },
    makeListHandler<Sticker>({
      endpoint: "string-stickers",
      itemKey: "string_stickers",
      heading: "String stickers",
      renderItem: renderStickerDetail,
      buildParams: (a) => ({ name: a.name, boardId: a.board_id, includeDeleted: a.include_deleted }),
    }),
  );

  server.registerTool(
    "yougile_list_sprint_stickers",
    {
      title: "List YouGile sprint stickers",
      description:
        "List sprint stickers and their states.\nArgs: name?, board_id?, include_deleted, limit, offset, response_format.",
      inputSchema: {
        name: z.string().optional().describe("Filter by sticker name substring."),
        board_id: z.string().optional().describe("Restrict to stickers used on this board."),
        ...includeDeletedShape,
        ...paginationShape,
        ...responseFormatShape,
      },
      annotations: RO,
    },
    makeListHandler<Sticker>({
      endpoint: "sprint-stickers",
      itemKey: "sprint_stickers",
      heading: "Sprint stickers",
      renderItem: renderStickerDetail,
      buildParams: (a) => ({ name: a.name, boardId: a.board_id, includeDeleted: a.include_deleted }),
    }),
  );

  server.registerTool(
    "yougile_get_string_sticker",
    {
      title: "Get a YouGile string sticker",
      description: "Fetch one string sticker (incl. its states) by id.\nArgs: sticker_id, response_format.",
      inputSchema: { sticker_id: z.string().min(1).describe("The string sticker id."), ...responseFormatShape },
      annotations: RO,
    },
    guard(async (a: ToolArgs) => {
      const sticker = await makeApiRequest<Sticker>(`string-stickers/${a.sticker_id}`, "GET");
      return toResult({ sticker: sticker as unknown as Record<string, unknown> }, fmt(a.response_format), () =>
        renderStickerDetail(sticker),
      );
    }),
  );

  server.registerTool(
    "yougile_create_string_sticker",
    {
      title: "Create a YouGile string sticker",
      description:
        "Create a string sticker (a label definition) with one or more states.\n" +
        "Args: name (required), states? (array of { name, color? }), icon?.\nReturns the created sticker id.",
      inputSchema: {
        name: z.string().min(1).describe("Sticker name."),
        states: z
          .array(z.object({ name: z.string().min(1), color: z.string().optional() }).strict())
          .optional()
          .describe("Initial states, e.g. [{ name: 'High', color: 'red' }]."),
        icon: z.string().optional().describe("Optional icon identifier."),
        ...responseFormatShape,
      },
      annotations: WRITE_NEW,
    },
    guard(async (a: ToolArgs) => {
      const body: Record<string, unknown> = { name: a.name };
      if (Array.isArray(a.states)) body.states = a.states;
      if (a.icon !== undefined) body.icon = a.icon;
      const result = await makeApiRequest<{ id: string }>("string-stickers", "POST", body);
      return toResult({ created: result }, fmt(a.response_format), () => `Created string sticker \`${result.id}\` — "${a.name}".`);
    }),
  );

  server.registerTool(
    "yougile_set_task_stickers",
    {
      title: "Set stickers on a YouGile task",
      description:
        "Attach or detach sticker states on a task, MERGING into its existing stickers (other stickers " +
        "are preserved).\n\n" +
        "Args: task_id, set? (map of stickerId → stateId to attach), remove? (array of stickerId to detach).\n" +
        "Provide at least one of set/remove. Discover ids with yougile_list_string_stickers.",
      inputSchema: {
        task_id: z.string().min(1).describe("The task id."),
        set: z
          .record(z.string(), z.string())
          .optional()
          .describe('Map of stickerId → stateId to attach, e.g. { "<stickerId>": "<stateId>" }.'),
        remove: z.array(z.string()).optional().describe("Sticker ids to detach from the task."),
        ...responseFormatShape,
      },
      annotations: WRITE_UPD,
    },
    guard(async (a: ToolArgs) => {
      const set = (a.set as Record<string, string> | undefined) ?? {};
      const remove = (a.remove as string[] | undefined) ?? [];
      if (!Object.keys(set).length && !remove.length) {
        return toError("Provide at least one of `set` (stickers to attach) or `remove` (stickers to detach).");
      }
      const task = await makeApiRequest<Task>(`tasks/${a.task_id}`, "GET");
      const merged: Record<string, string> = { ...(task.stickers ?? {}) };
      for (const [stickerId, stateId] of Object.entries(set)) merged[stickerId] = stateId;
      for (const stickerId of remove) merged[stickerId] = "-"; // "-" detaches in the YouGile API
      await makeApiRequest(`tasks/${a.task_id}`, "PUT", { stickers: merged });
      return toResult({ task_id: a.task_id, stickers: merged }, fmt(a.response_format), () =>
        `Updated stickers on task \`${a.task_id}\` (attached ${Object.keys(set).length}, detached ${remove.length}).`,
      );
    }),
  );
}
