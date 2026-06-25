/**
 * Streamable HTTP transport (stateless JSON) for remote deployment.
 *
 * Security model: bind to 127.0.0.1 (front with a TLS reverse proxy such as
 * Caddy), require a bearer token (MCP_AUTH_TOKEN) on /mcp, and optionally enable
 * DNS-rebinding protection via MCP_PUBLIC_HOST. The YouGile API key stays in the
 * server environment and is never exposed to clients.
 */

import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { buildServer } from "./server.js";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function jsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

function requireBearer(expected: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!provided || !safeEqual(provided, expected)) {
      jsonRpcError(res, 401, -32001, "Unauthorized: missing or invalid bearer token.");
      return;
    }
    next();
  };
}

export async function startHttpServer(): Promise<void> {
  const token = process.env.MCP_AUTH_TOKEN?.trim();
  if (!token) {
    console.error(
      "ERROR: TRANSPORT=http requires MCP_AUTH_TOKEN to be set (the bearer token clients must send).\n" +
        "Generate one with: openssl rand -hex 32",
    );
    process.exit(1);
  }

  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const publicHost = process.env.MCP_PUBLIC_HOST?.trim();

  // Accept both the bare host (as a TLS proxy on :443 forwards it) and the
  // host:port form (useful for direct/local access on a non-standard port).
  const allowedHosts = publicHost
    ? Array.from(new Set([publicHost, publicHost.includes(":") ? publicHost : `${publicHost}:${port}`]))
    : undefined;

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION });
  });

  app.post("/mcp", requireBearer(token), async (req: Request, res: Response) => {
    // Stateless: a fresh server + transport per request (no shared sessions,
    // no request-id collisions across clients).
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      ...(allowedHosts ? { enableDnsRebindingProtection: true, allowedHosts } : {}),
    });

    res.on("close", () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request error:", error instanceof Error ? error.message : error);
      if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal server error.");
    }
  });

  // Streamable HTTP GET (SSE) / DELETE are not used in stateless JSON mode.
  app.all("/mcp", (_req: Request, res: Response) => {
    jsonRpcError(res, 405, -32000, "Method not allowed. Use POST for stateless JSON requests.");
  });

  app.listen(port, "127.0.0.1", () => {
    console.error(
      `${SERVER_NAME} v${SERVER_VERSION} listening on http://127.0.0.1:${port}/mcp (TRANSPORT=http)` +
        (publicHost ? ` · allowed host: ${publicHost}` : " · DNS-rebinding protection OFF (set MCP_PUBLIC_HOST)"),
    );
  });
}
