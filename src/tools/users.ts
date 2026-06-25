/**
 * User / employee tools (read-only).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeApiRequest } from "../services/client.js";
import { toResult } from "../services/format.js";
import { paginationShape, responseFormatShape } from "../schemas/common.js";
import type { User } from "../types.js";
import { fmt, guard, makeListHandler, renderUserLine, type ToolArgs } from "./helpers.js";

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export function registerUserTools(server: McpServer): void {
  server.registerTool(
    "yougile_list_users",
    {
      title: "List YouGile users",
      description:
        "List employees/users in the company. Use this to find a user's id (e.g. your own, to set " +
        "YOUGILE_USER_ID) before assigning tasks or filtering by assignee.\n" +
        "Args: email? (filter), project_id? (members of a project), limit, offset, response_format.\n" +
        "Returns: { count, offset, has_more, next_offset?, users: [{ id, realName, email, isAdmin }] }.",
      inputSchema: {
        email: z.string().optional().describe("Filter by email (exact/substring per API)."),
        project_id: z.string().optional().describe("Restrict to members of this project."),
        ...paginationShape,
        ...responseFormatShape,
      },
      annotations: RO,
    },
    makeListHandler<User>({
      endpoint: "users",
      itemKey: "users",
      heading: "Users",
      renderItem: renderUserLine,
      buildParams: (a) => ({ email: a.email, projectId: a.project_id }),
    }),
  );

  server.registerTool(
    "yougile_get_user",
    {
      title: "Get a YouGile user",
      description: "Fetch one user by id.\nArgs: user_id, response_format.",
      inputSchema: { user_id: z.string().min(1).describe("The user id."), ...responseFormatShape },
      annotations: RO,
    },
    guard(async (a: ToolArgs) => {
      const user = await makeApiRequest<User>(`users/${a.user_id}`, "GET");
      return toResult({ user: user as unknown as Record<string, unknown> }, fmt(a.response_format), () =>
        renderUserLine(user),
      );
    }),
  );
}
