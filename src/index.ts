#!/usr/bin/env node
/**
 * YouGile MCP server — entry point.
 *
 * Transport is selected by the TRANSPORT env var:
 *   - stdio (default): local subprocess for Claude Desktop / Cursor.
 *   - http:            remote Streamable HTTP server (see src/http.ts).
 *
 * NOTE: in stdio mode all logging MUST go to stderr — stdout carries the
 * MCP protocol stream.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { buildServer } from "./server.js";
import { startHttpServer } from "./http.js";

function requireApiKey(): void {
  if (!process.env.YOUGILE_API_KEY?.trim()) {
    console.error(
      "ERROR: YOUGILE_API_KEY is not set.\n" +
        "Generate a key with `npm run get-key` (or in YouGile → Settings → API keys), " +
        "then set it in this process's environment.",
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  requireApiKey();

  const transport = (process.env.TRANSPORT || "stdio").toLowerCase();
  if (transport === "http") {
    await startHttpServer();
    return;
  }

  const server = buildServer();
  const stdio = new StdioServerTransport();
  await server.connect(stdio);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running (stdio)`);
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
