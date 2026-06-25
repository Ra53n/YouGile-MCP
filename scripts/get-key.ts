#!/usr/bin/env tsx
/**
 * One-time helper to obtain a YouGile API key from your login + password.
 *
 *   npm run get-key
 *
 * Your password is sent ONLY to YouGile (never stored, never written to disk).
 * The script prints the API key plus ready-to-paste client config snippets.
 */

import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";

const DEFAULT_BASE_URL = "https://ru.yougile.com/api-v2";
const baseURL = (process.env.YOUGILE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, (a) => resolve(a.trim())));
}

function askHidden(query: string): Promise<string> {
  if (!process.stdin.isTTY) {
    process.stdout.write("(warning: input is not a TTY — password will be visible)\n");
    return ask(query);
  }
  return new Promise((resolve) => {
    const rlAny = rl as unknown as { _writeToOutput: (s: string) => void };
    const original = rlAny._writeToOutput;
    let shown = false;
    rlAny._writeToOutput = () => {
      if (!shown) {
        process.stdout.write(query);
        shown = true;
      }
    };
    rl.question(query, (answer) => {
      rlAny._writeToOutput = original;
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

interface Company {
  id: string;
  name?: string;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const obj = data as { content?: T[]; data?: T[] };
    return obj.content ?? obj.data ?? [];
  }
  return [];
}

async function main(): Promise<void> {
  console.log("\n=== YouGile API key helper ===");
  console.log(`API base URL: ${baseURL}`);
  console.log("Your password is sent only to YouGile and is never stored.\n");

  const login = await ask("YouGile login (email): ");
  const password = await askHidden("Password: ");
  if (!login || !password) {
    console.error("Login and password are required.");
    process.exit(1);
  }

  // 1) List companies for these credentials.
  let companies: Company[];
  try {
    const res = await axios.post(`${baseURL}/auth/companies`, { login, password }, { timeout: 30000 });
    companies = asArray<Company>(res.data);
  } catch (error) {
    fail("Could not list companies", error);
    return;
  }

  if (!companies.length) {
    console.error("No companies found for this account.");
    process.exit(1);
  }

  // 2) Pick a company.
  let company: Company;
  if (companies.length === 1) {
    company = companies[0];
    console.log(`\nUsing company: ${company.name ?? "(unnamed)"} (${company.id})`);
  } else {
    console.log("\nCompanies:");
    companies.forEach((c, i) => console.log(`  ${i + 1}. ${c.name ?? "(unnamed)"} — ${c.id}`));
    const choice = Number.parseInt(await ask(`Select company [1-${companies.length}]: `), 10);
    if (!Number.isInteger(choice) || choice < 1 || choice > companies.length) {
      console.error("Invalid selection.");
      process.exit(1);
    }
    company = companies[choice - 1];
  }

  // 3) Create (or fetch) an API key for that company.
  let apiKey: string | undefined;
  try {
    const res = await axios.post(
      `${baseURL}/auth/keys`,
      { login, password, companyId: company.id },
      { timeout: 30000 },
    );
    apiKey = extractKey(res.data);
  } catch (error) {
    fail("Could not create an API key", error);
    return;
  }

  if (!apiKey) {
    console.error("The API responded without a usable key. Raw response logged above.");
    process.exit(1);
  }

  printResult(apiKey);
  rl.close();
}

function extractKey(data: unknown): string | undefined {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const obj = data as { key?: string; id?: string };
    return obj.key ?? obj.id;
  }
  return undefined;
}

function printResult(apiKey: string): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distEntry = path.resolve(here, "..", "dist", "index.js");

  const localConfig = {
    mcpServers: {
      yougile: {
        command: "npx",
        args: ["-y", "yougile-mcp-server"],
        env: { YOUGILE_API_KEY: apiKey, YOUGILE_BASE_URL: baseURL },
      },
    },
  };

  console.log("\n──────────────────────────────────────────────");
  console.log("API key (keep this secret):\n");
  console.log(`  ${apiKey}\n`);
  console.log("Add to your local .env:");
  console.log(`  YOUGILE_API_KEY=${apiKey}`);
  console.log(`  YOUGILE_BASE_URL=${baseURL}\n`);

  console.log("Claude Desktop (claude_desktop_config.json) / Cursor (mcp.json) — local stdio:");
  console.log(JSON.stringify(localConfig, null, 2));

  console.log("\nAlternative (run the built file directly instead of npx):");
  console.log(`  "command": "node", "args": ["${distEntry}"]`);
  console.log("\nFor a remote HTTP deployment, connect via mcp-remote — see README.md.");
  console.log("──────────────────────────────────────────────\n");
}

function fail(prefix: string, error: unknown): never {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 401) {
      console.error(`${prefix}: login or password is incorrect (401).`);
    } else {
      console.error(`${prefix}: ${status ?? ""} ${JSON.stringify(error.response?.data ?? error.message)}`);
    }
  } else {
    console.error(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
  }
  rl.close();
  process.exit(1);
}

main().catch((error) => {
  console.error("Unexpected error:", error instanceof Error ? error.message : error);
  rl.close();
  process.exit(1);
});
