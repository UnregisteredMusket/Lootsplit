type Statement = { bind(...values: unknown[]): Statement; first<T>(): Promise<T | null> };
type Database = { prepare(sql: string): Statement };
/** Guest seats remain supported; linked seats also honor the account's restrictions. */
export async function guardMemberSeat(input: unknown) {
  const db = (globalThis as typeof globalThis & { __env__?: { DB?: Database } }).__env__?.DB;
  const data = input as { code?: string; token?: string };
  if (!db || !data.code || !data.token) return;
  const row = await db
    .prepare(
      "SELECT a.status,a.ban_until FROM library_members m JOIN member_access a ON a.user_id=m.user_id WHERE m.code=? AND m.token=?",
    )
    .bind(data.code.trim().toUpperCase(), data.token)
    .first<{ status: string; ban_until: number | null }>();
  if (
    row?.status === "revoked" ||
    (row?.status === "banned" && (!row.ban_until || row.ban_until > Date.now()))
  )
    throw new Error("This campaign seat belongs to a restricted account.");
}

/** Resolve optional signed-in identity from the request, never from a supplied user ID. */
export async function currentAccountId(): Promise<string | undefined> {
  const env = (globalThis as typeof globalThis & {__env__?: any}).__env__;
  if (!env?.DB || !env?.ACCOUNT_SECRET || !env?.ACCOUNT_ORIGIN) return undefined;
  const { getRequest } = await import("@tanstack/react-start/server");
  const { accountAuth } = await import("../../../cloudflare/accounts.mjs");
  const session = await accountAuth(env).api.getSession({ headers: getRequest().headers });
  if (!session) return undefined;
  const row = await env.DB.prepare("SELECT status,ban_until FROM member_access WHERE user_id=?").bind(session.user.id).first();
  if (row?.status === "revoked" || (row?.status === "banned" && (!row.ban_until || row.ban_until > Date.now())))
    throw Error("Account access is restricted.");
  return session.user.id;
}
