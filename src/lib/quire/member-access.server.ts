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
