import { assertLinkedSeatActive } from "../../../cloudflare/members.mjs";
import { readRoomAccess } from "./room-store.server.ts";
type Statement = { bind(...values: unknown[]): Statement; first<T>(): Promise<T | null> };
type Database = { prepare(sql: string): Statement };
/**
 * Guest seats remain supported; linked seats also honor the account's restrictions.
 * Server functions resolve the account from the current request; plain server routes (the
 * room image GET) pass their request explicitly.
 */
export async function guardMemberSeat(input: unknown, request?: { url: string; headers: Headers }) {
  const db = (globalThis as typeof globalThis & { __env__?: { DB?: Database } }).__env__?.DB;
  const data = input as { code?: string; token?: string };
  if (!db || !data.code || !data.token) return;
  const room = await readRoomAccess(data.code);
  const seat = room?.seats?.find((s: { token: string }) => s.token === data.token);
  if (room && seat?.role === "dm") {
    const userId = await currentAccountId(request);
    const linked = await db
      .prepare("SELECT user_id FROM library_members WHERE code=? AND seat_id=?")
      .bind(room.code, seat.id)
      .first<{ user_id: string }>();
    const owner = room.ownerId || linked?.user_id;
    if (!userId || (owner && userId !== owner))
      throw Error("Sign in to the account that owns this campaign.");
  }
  await assertLinkedSeatActive(db, data.code.trim().toUpperCase(), data.token, seat || null);
}

/** Resolve optional signed-in identity from the request, never from a supplied user ID. */
export async function currentAccountId(
  request?: { url: string; headers: Headers },
): Promise<string | undefined> {
  const env = (globalThis as typeof globalThis & { __env__?: any }).__env__;
  if (!env?.DB || !env?.ACCOUNT_SECRET || !env?.ACCOUNT_ORIGIN) return undefined;
  if (request) return accountIdForRequest(env, request);
  const { getRequest } = await import("@tanstack/react-start/server");
  return accountIdForRequest(env, getRequest());
}

/** Session lookup for the host this request reached: the primary origin or an approved legacy origin
 * (ACCOUNT_LEGACY_ORIGINS). Any other host, including one named only by forwarded headers, resolves no account. */
export async function accountIdForRequest(
  env: { DB: any; ACCOUNT_SECRET: string; ACCOUNT_ORIGIN: string; ACCOUNT_LEGACY_ORIGINS?: string },
  request: { url: string; headers: Headers },
): Promise<string | undefined> {
  const { accountRequestOrigin } = await import("../deployment/origins.mjs");
  let origin: string;
  try {
    origin = accountRequestOrigin(env, request.url);
  } catch {
    return undefined;
  }
  const { accountAuth } = await import("../../../cloudflare/accounts.mjs");
  const session = await accountAuth({ ...env, ACCOUNT_ORIGIN: origin }).api.getSession({ headers: request.headers });
  if (!session) return undefined;
  const row = await env.DB.prepare("SELECT status,ban_until FROM member_access WHERE user_id=?")
    .bind(session.user.id)
    .first();
  if (
    row?.status === "revoked" ||
    (row?.status === "banned" && (!row.ban_until || row.ban_until > Date.now()))
  )
    throw Error("Account access is restricted.");
  return session.user.id;
}
