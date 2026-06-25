/**
 * Navigation tools: projects, boards, columns.
 *
 * Read + safe writes only. Soft-delete (`deleted`) is intentionally NOT exposed
 * for these resources — the only reversible "remove" is on tasks (archive).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeApiRequest } from "../services/client.js";
import { toResult } from "../services/format.js";
import { includeDeletedShape, paginationShape, responseFormatShape } from "../schemas/common.js";
import type { Board, Column, Project } from "../types.js";
import {
  fmt,
  guard,
  makeListHandler,
  renderBoardLine,
  renderColumnLine,
  renderProjectLine,
  type ToolArgs,
} from "./helpers.js";

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE_NEW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const WRITE_UPD = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export function registerNavigationTools(server: McpServer): void {
  // ── Projects ───────────────────────────────────────────────────────────────
  server.registerTool(
    "yougile_list_projects",
    {
      title: "List YouGile projects",
      description:
        "List projects in the YouGile company. Projects are the top of the hierarchy " +
        "(project → boards → columns → tasks).\n\n" +
        "Args: title? (substring filter), include_deleted (default false), limit, offset, response_format.\n" +
        "Returns: { count, offset, has_more, next_offset?, projects: [{ id, title, deleted }] }.",
      inputSchema: {
        title: z.string().optional().describe("Filter projects whose title contains this substring."),
        ...includeDeletedShape,
        ...paginationShape,
        ...responseFormatShape,
      },
      annotations: RO,
    },
    makeListHandler<Project>({
      endpoint: "projects",
      itemKey: "projects",
      heading: "Projects",
      renderItem: renderProjectLine,
      buildParams: (a) => ({ title: a.title, includeDeleted: a.include_deleted }),
    }),
  );

  server.registerTool(
    "yougile_get_project",
    {
      title: "Get a YouGile project",
      description:
        "Fetch a single project by id.\nArgs: project_id, response_format.\nReturns the project object.",
      inputSchema: {
        project_id: z.string().min(1).describe("The project id."),
        ...responseFormatShape,
      },
      annotations: RO,
    },
    guard(async (a: ToolArgs) => {
      const project = await makeApiRequest<Project>(`projects/${a.project_id}`, "GET");
      return toResult({ project: project as unknown as Record<string, unknown> }, fmt(a.response_format), () =>
        renderProjectLine(project),
      );
    }),
  );

  server.registerTool(
    "yougile_create_project",
    {
      title: "Create a YouGile project",
      description:
        "Create a new project.\nArgs: title (required), users? (map of userId → role, e.g. \"admin\"/\"worker\").\n" +
        "Returns the created project id.",
      inputSchema: {
        title: z.string().min(1).describe("Project title."),
        users: z
          .record(z.string(), z.string())
          .optional()
          .describe('Optional map of userId → role (e.g. { "<userId>": "admin" }).'),
        ...responseFormatShape,
      },
      annotations: WRITE_NEW,
    },
    guard(async (a: ToolArgs) => {
      const body = { title: a.title, ...(a.users ? { users: a.users } : {}) };
      const result = await makeApiRequest<{ id: string }>("projects", "POST", body);
      return toResult({ created: result }, fmt(a.response_format), () => `Created project \`${result.id}\` — "${a.title}".`);
    }),
  );

  server.registerTool(
    "yougile_update_project",
    {
      title: "Update a YouGile project",
      description:
        "Rename a project or change its member roles. (Deletion is not supported by this server.)\n" +
        "Args: project_id, title?, users? (map userId → role).",
      inputSchema: {
        project_id: z.string().min(1).describe("The project id."),
        title: z.string().min(1).optional().describe("New title."),
        users: z.record(z.string(), z.string()).optional().describe("Map of userId → role to set."),
        ...responseFormatShape,
      },
      annotations: WRITE_UPD,
    },
    guard(async (a: ToolArgs) => {
      const body = {
        ...(a.title !== undefined ? { title: a.title } : {}),
        ...(a.users !== undefined ? { users: a.users } : {}),
      };
      await makeApiRequest(`projects/${a.project_id}`, "PUT", body);
      return toResult({ updated: a.project_id }, fmt(a.response_format), () => `Updated project \`${a.project_id}\`.`);
    }),
  );

  // ── Boards ─────────────────────────────────────────────────────────────────
  server.registerTool(
    "yougile_list_boards",
    {
      title: "List YouGile boards",
      description:
        "List boards, optionally within a project.\n" +
        "Args: title?, project_id?, include_deleted (default false), limit, offset, response_format.\n" +
        "Returns: { count, offset, has_more, next_offset?, boards: [{ id, title, projectId, deleted }] }.",
      inputSchema: {
        title: z.string().optional().describe("Filter boards whose title contains this substring."),
        project_id: z.string().optional().describe("Restrict to boards in this project."),
        ...includeDeletedShape,
        ...paginationShape,
        ...responseFormatShape,
      },
      annotations: RO,
    },
    makeListHandler<Board>({
      endpoint: "boards",
      itemKey: "boards",
      heading: "Boards",
      renderItem: renderBoardLine,
      buildParams: (a) => ({ title: a.title, projectId: a.project_id, includeDeleted: a.include_deleted }),
    }),
  );

  server.registerTool(
    "yougile_get_board",
    {
      title: "Get a YouGile board",
      description: "Fetch a single board by id.\nArgs: board_id, response_format.",
      inputSchema: { board_id: z.string().min(1).describe("The board id."), ...responseFormatShape },
      annotations: RO,
    },
    guard(async (a: ToolArgs) => {
      const board = await makeApiRequest<Board>(`boards/${a.board_id}`, "GET");
      return toResult({ board: board as unknown as Record<string, unknown> }, fmt(a.response_format), () =>
        renderBoardLine(board),
      );
    }),
  );

  server.registerTool(
    "yougile_create_board",
    {
      title: "Create a YouGile board",
      description:
        "Create a board inside a project.\nArgs: title (required), project_id (required).\nReturns the created board id.",
      inputSchema: {
        title: z.string().min(1).describe("Board title."),
        project_id: z.string().min(1).describe("Id of the project to create the board in."),
        ...responseFormatShape,
      },
      annotations: WRITE_NEW,
    },
    guard(async (a: ToolArgs) => {
      const result = await makeApiRequest<{ id: string }>("boards", "POST", {
        title: a.title,
        projectId: a.project_id,
      });
      return toResult({ created: result }, fmt(a.response_format), () => `Created board \`${result.id}\` — "${a.title}".`);
    }),
  );

  server.registerTool(
    "yougile_update_board",
    {
      title: "Update a YouGile board",
      description:
        "Rename a board or move it to another project. (Deletion is not supported by this server.)\n" +
        "Args: board_id, title?, project_id?.",
      inputSchema: {
        board_id: z.string().min(1).describe("The board id."),
        title: z.string().min(1).optional().describe("New title."),
        project_id: z.string().optional().describe("Move the board to this project id."),
        ...responseFormatShape,
      },
      annotations: WRITE_UPD,
    },
    guard(async (a: ToolArgs) => {
      const body = {
        ...(a.title !== undefined ? { title: a.title } : {}),
        ...(a.project_id !== undefined ? { projectId: a.project_id } : {}),
      };
      await makeApiRequest(`boards/${a.board_id}`, "PUT", body);
      return toResult({ updated: a.board_id }, fmt(a.response_format), () => `Updated board \`${a.board_id}\`.`);
    }),
  );

  // ── Columns ────────────────────────────────────────────────────────────────
  server.registerTool(
    "yougile_list_columns",
    {
      title: "List YouGile columns",
      description:
        "List columns, optionally within a board. Columns are the kanban stages where tasks live.\n" +
        "Args: title?, board_id?, include_deleted (default false), limit, offset, response_format.\n" +
        "Returns: { count, offset, has_more, next_offset?, columns: [{ id, title, boardId, color }] }.",
      inputSchema: {
        title: z.string().optional().describe("Filter columns whose title contains this substring."),
        board_id: z.string().optional().describe("Restrict to columns in this board."),
        ...includeDeletedShape,
        ...paginationShape,
        ...responseFormatShape,
      },
      annotations: RO,
    },
    makeListHandler<Column>({
      endpoint: "columns",
      itemKey: "columns",
      heading: "Columns",
      renderItem: renderColumnLine,
      buildParams: (a) => ({ title: a.title, boardId: a.board_id, includeDeleted: a.include_deleted }),
    }),
  );

  server.registerTool(
    "yougile_get_column",
    {
      title: "Get a YouGile column",
      description: "Fetch a single column by id.\nArgs: column_id, response_format.",
      inputSchema: { column_id: z.string().min(1).describe("The column id."), ...responseFormatShape },
      annotations: RO,
    },
    guard(async (a: ToolArgs) => {
      const column = await makeApiRequest<Column>(`columns/${a.column_id}`, "GET");
      return toResult({ column: column as unknown as Record<string, unknown> }, fmt(a.response_format), () =>
        renderColumnLine(column),
      );
    }),
  );

  server.registerTool(
    "yougile_create_column",
    {
      title: "Create a YouGile column",
      description:
        "Create a column inside a board.\nArgs: title (required), board_id (required), color? (integer 0–16 palette index).\n" +
        "Returns the created column id.",
      inputSchema: {
        title: z.string().min(1).describe("Column title."),
        board_id: z.string().min(1).describe("Id of the board to create the column in."),
        color: z.number().int().min(0).max(16).optional().describe("Color palette index (0–16)."),
        ...responseFormatShape,
      },
      annotations: WRITE_NEW,
    },
    guard(async (a: ToolArgs) => {
      const result = await makeApiRequest<{ id: string }>("columns", "POST", {
        title: a.title,
        boardId: a.board_id,
        ...(a.color !== undefined ? { color: a.color } : {}),
      });
      return toResult({ created: result }, fmt(a.response_format), () => `Created column \`${result.id}\` — "${a.title}".`);
    }),
  );

  server.registerTool(
    "yougile_update_column",
    {
      title: "Update a YouGile column",
      description:
        "Rename a column, recolor it, or move it to another board. (Deletion is not supported by this server.)\n" +
        "Args: column_id, title?, color?, board_id?.",
      inputSchema: {
        column_id: z.string().min(1).describe("The column id."),
        title: z.string().min(1).optional().describe("New title."),
        color: z.number().int().min(0).max(16).optional().describe("New color palette index (0–16)."),
        board_id: z.string().optional().describe("Move the column to this board id."),
        ...responseFormatShape,
      },
      annotations: WRITE_UPD,
    },
    guard(async (a: ToolArgs) => {
      const body = {
        ...(a.title !== undefined ? { title: a.title } : {}),
        ...(a.color !== undefined ? { color: a.color } : {}),
        ...(a.board_id !== undefined ? { boardId: a.board_id } : {}),
      };
      await makeApiRequest(`columns/${a.column_id}`, "PUT", body);
      return toResult({ updated: a.column_id }, fmt(a.response_format), () => `Updated column \`${a.column_id}\`.`);
    }),
  );
}
