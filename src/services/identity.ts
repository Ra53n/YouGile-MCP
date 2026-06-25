/**
 * Resolve the "current user" for `my_tasks` / `overdue_tasks(assigned_to:"me")`.
 *
 * The YouGile v2 API key is company-scoped and does not always expose a caller
 * identity, so we resolve in order: YOUGILE_USER_ID env → a /users/me probe
 * (cached) → an actionable error telling the user how to find their id.
 */

import { makeApiRequest, YouGileError } from "./client.js";

let cachedUserId: string | undefined;

export async function resolveCurrentUserId(): Promise<string> {
  const fromEnv = process.env.YOUGILE_USER_ID?.trim();
  if (fromEnv) return fromEnv;
  if (cachedUserId) return cachedUserId;

  try {
    const me = await makeApiRequest<{ id?: string }>("users/me", "GET");
    if (me?.id) {
      cachedUserId = me.id;
      return me.id;
    }
  } catch {
    // Endpoint may not exist on this deployment — fall through to guidance.
  }

  throw new YouGileError(
    "Cannot determine the current user. Set the YOUGILE_USER_ID environment variable " +
      "(find your id with yougile_list_users filtered by your email), or pass an explicit user id.",
  );
}
