import { assertLinkedSeatActive } from "../../../cloudflare/members.mjs";
type Statement = { bind(...values: unknown[]): Statement; first<T>(): Promise<T | null> };
type Database = { prepare(sql: string): Statement };
/** Guest seats remain supported; linked seats also honor the account's restrictions. */
export async function guardMemberSeat(input: unknown) {
  const db = (globalThis as typeof globalThis & { __env__?: { DB?: Database } }).__env__?.DB;
  const data = input as { code?: string; token?: string };
  if (!db || !data.code || !data.token) return;
  const roomRow = await db
    .prepare("SELECT body FROM campaign_rooms WHERE code=?")
    .bind(data.code.trim().toUpperCase())
    .first<{ body: string }>();
  const room = roomRow ? JSON.parse(roomRow.body) : null;
  const seat = room?.seats?.find((s: { token: string }) => s.token === data.token);
  if (seat?.role === "dm") {
    const userId = await currentAccountId();
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
export async function currentAccountId(): Promise<string | undefined> {
  const env = (globalThis as typeof globalThis & { __env__?: any }).__env__;
  if (!env?.DB || !env?.ACCOUNT_SECRET || !env?.ACCOUNT_ORIGIN) return undefined;
  const { getRequest } = await import("@tanstack/react-start/server");
  const { accountAuth } = await import("../../../cloudflare/accounts.mjs");
  const session = await accountAuth(env).api.getSession({ headers: getRequest().headers });
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
