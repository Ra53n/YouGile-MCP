/**
 * Register every tool on the MCP server.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerNavigationTools } from "./navigation.js";
import { registerTaskTools } from "./tasks.js";
import { registerCommentTools } from "./comments.js";
import { registerUserTools } from "./users.js";
import { registerStickerTools } from "./stickers.js";
import { registerWorkflowTools } from "./workflow.js";

export function registerAll(server: McpServer): void {
  registerNavigationTools(server);
  registerTaskTools(server);
  registerCommentTools(server);
  registerUserTools(server);
  registerStickerTools(server);
  registerWorkflowTools(server);
}
