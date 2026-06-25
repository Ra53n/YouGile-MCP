/**
 * Comment tools: read and post messages in a task's chat thread.
 * The chat id equals the task id in YouGile.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CHARACTER_LIMIT } from "../constants.js";
import { makeApiRequest, paginateList } from "../services/client.js";
import { paginationMeta, toResult } from "../services/format.js";
import { paginationShape, responseFormatShape } from "../schemas/common.js";
import type { ChatMessage } from "../types.js";
import { fmt, guard, renderMessageLine, type ToolArgs } from "./helpers.js";

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE_NEW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

export function registerCommentTools(server: McpServer): void {
  server.registerTool(
    "yougile_get_task_comments",
    {
      title: "Get a YouGile task's comments",
      description:
        "Read the comment/chat thread of a task (chat id = task id).\n" +
        "Args: task_id, text? (substring filter), since? (ms-epoch, only newer), limit, offset, response_format.\n" +
        "Returns: { count, offset, has_more, next_offset?, messages: [{ id, fromUserId, text, timestamp }] }.",
      inputSchema: {
        task_id: z.string().min(1).describe("The task id (used as the chat id)."),
        text: z.string().optional().describe("Only messages containing this substring."),
        since: z.number().int().optional().describe("Only messages newer than this ms-epoch timestamp."),
        ...paginationShape,
        ...responseFormatShape,
      },
      annotations: RO,
    },
    guard(async (a: ToolArgs) => {
      const limit = typeof a.limit === "number" ? a.limit : 50;
      const offset = typeof a.offset === "number" ? a.offset : 0;
      const { items, hasMore, nextOffset } = await paginateList<ChatMessage>(
        `chats/${a.task_id}/messages`,
        { text: a.text, since: a.since },
        { startOffset: offset, pageSize: limit, maxItems: limit, charBudget: CHARACTER_LIMIT },
      );
      const meta = paginationMeta(items.length, offset, hasMore, nextOffset);
      return toResult({ ...meta, messages: items }, fmt(a.response_format), () => {
        const lines = [`# Comments on task \`${a.task_id}\` (${items.length}${hasMore ? "+" : ""})`, ""];
        if (!items.length) lines.push("_No comments._");
        for (const m of items) lines.push(renderMessageLine(m));
        return lines.join("\n");
      });
    }),
  );

  server.registerTool(
    "yougile_add_task_comment",
    {
      title: "Comment on a YouGile task",
      description:
        "Post a comment/message to a task's chat thread.\nArgs: task_id, text (required).\nReturns the created message id.",
      inputSchema: {
        task_id: z.string().min(1).describe("The task id (used as the chat id)."),
        text: z.string().min(1).describe("The comment text to post."),
        ...responseFormatShape,
      },
      annotations: WRITE_NEW,
    },
    guard(async (a: ToolArgs) => {
      const result = await makeApiRequest<{ id: string }>(`chats/${a.task_id}/messages`, "POST", {
        text: a.text,
      });
      return toResult({ created: result, task_id: a.task_id }, fmt(a.response_format), () =>
        `Posted comment \`${result.id}\` on task \`${a.task_id}\`.`,
      );
    }),
  );
}
