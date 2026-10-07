import type { Command } from "./commands.ts";

export type ResumeSession = {
  code: string;
  token: string;
  seatId: string;
  role: "dm" | "player";
  purseIds: string[];
  revision: number;
  pending: Command[];
  batchId: string;
};
type Identity = Pick<ResumeSession, "code" | "token" | "seatId" | "role">;
type Recovery = { session: ResumeSession; reason: string };
export type ResumeRecovery = {
  id: string;
  code: string;
  seatId: string;
  role: "dm" | "player";
  batchId: string;
  revision: number;
  commands: Command[];
  exportedAt: number;
  reason: string;
};

/** A stored role or command ID alone is never authority to replay a device queue. */
export function sameResumeSeat(a: Identity, b: Identity): boolean {
  return a.code === b.code && a.token === b.token && a.seatId === b.seatId && a.role === b.role;
}
export function readResumeSession(raw: string | null): ResumeSession | null {
  if (!raw) return null;
  let value;
  try { value = JSON.parse(raw); } catch {
    throw Error("This device's campaign connection could not be read. Its saved data has not been changed.");
  }
  if (!value || (Array.isArray(value.pending) && value.pending.length === 0)) return null;
  if (
    !Array.isArray(value.pending) ||
    !value.pending.every((c: { id?: unknown; kind?: unknown } | null) => c && typeof c.id === "string" && typeof c.kind === "string") ||
    ![value.code, value.token, value.seatId, value.batchId].every((v: unknown) => typeof v === "string" && v.length > 0) ||
    !["dm", "player"].includes(value.role)
  ) throw Error("This device's unsynced actions need recovery. The original connection and actions have been kept.");
  return value as ResumeSession;
}
function prefix(a: Command[], b: Command[]) {
  return a.length <= b.length && a.every((command, i) => JSON.stringify(command) === JSON.stringify(b[i]));
}

/** Read-only plan: acknowledge only the verified seat, never submit or end a turn. */
export function planAccountResume(
  identity: Identity,
  target: ResumeSession | null,
  current: ResumeSession | null,
  remote: { acknowledged: string[]; draft: string },
) {
  if (current?.pending.length && !sameResumeSeat(current, identity))
    throw Error("Submit or export and resolve your current unsynced actions before switching campaigns or seats.");
  if (target?.pending.length && target.code !== identity.code)
    throw Error("This device connection belongs to a different campaign. Its actions have been kept.");
  const acknowledged = new Set(remote.acknowledged);
  const remaining = (s: ResumeSession) => s.pending.filter(c => !acknowledged.has(c.id));
  const draft = JSON.parse(remote.draft) as Command[];
  if (!Array.isArray(draft)) throw Error("The server draft could not be read. Device actions have been kept.");
  const serverPending = draft.filter(c => !acknowledged.has(c.id));
  const recoveries: Recovery[] = [];
  const compatible = target && sameResumeSeat(target, identity) ? target : null;
  if (target?.pending.length && !compatible)
    recoveries.push({ session: target, reason: "Actions from an earlier seat were kept separately, not replayed with new permissions." });
  // The active queue takes precedence. Never overwrite a second device-cache queue.
  const source = current?.pending.length ? current : compatible;
  const pending = source ? remaining(source) : [];
  if (compatible && compatible !== source && remaining(compatible).length && !prefix(remaining(compatible), pending))
    recoveries.push({ session: compatible, reason: "A separate device queue was kept for review rather than merged automatically." });
  if (pending.length && serverPending.length && !prefix(pending, serverPending) && !prefix(serverPending, pending)) {
    recoveries.push({ session: source!, reason: "Device actions differ from the server-saved draft. Both were preserved; the server draft was reopened." });
    return { pending: serverPending, batchId: crypto.randomUUID(), recoveries };
  }
  return {
    pending: pending.length >= serverPending.length ? pending : serverPending,
    // With no receipts, keep the original retry identity for an ambiguous response.
    // Any acknowledged portion may belong to a completed batch: use a fresh batch
    // for its remainder while retaining each command ID for server deduplication.
    batchId: pending.length && source && pending.length === source.pending.length ? source.batchId : crypto.randomUUID(),
    recoveries,
  };
}
const recoveryPrefix = (userId: string, code: string) =>
  `lootsplit.account-recovery.v1:${encodeURIComponent(userId)}:${encodeURIComponent(code)}:`;
type ReadStorage = Pick<Storage, "length" | "key" | "getItem">;

export function readResumeRecoveries(storage: ReadStorage, userId: string, code: string): ResumeRecovery[] {
  const rows: ResumeRecovery[] = [];
  const prefix = recoveryPrefix(userId, code);
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const row = JSON.parse(storage.getItem(key) || "null");
      if (row?.code === code && Array.isArray(row.commands)) rows.push(row);
    } catch { /* Keep unreadable records intact, never delete during a read. */ }
  }
  return rows.sort((a, b) => b.exportedAt - a.exportedAt);
}

/** Write recoveries BEFORE replacing a connection. Quota failure must abort the resume. No credentials are exported. */
export function saveResumeRecoveries(
  storage: ReadStorage & Pick<Storage, "setItem">,
  userId: string,
  code: string,
  recoveries: Recovery[],
) {
  const existing = readResumeRecoveries(storage, userId, code);
  for (const { session, reason } of recoveries) {
    if (existing.some(row => row.seatId === session.seatId && row.batchId === session.batchId && JSON.stringify(row.commands) === JSON.stringify(session.pending))) continue;
    const row: ResumeRecovery = {
      id: crypto.randomUUID(), code, seatId: session.seatId, role: session.role,
      batchId: session.batchId, revision: session.revision, commands: session.pending,
      exportedAt: Date.now(), reason,
    };
    storage.setItem(recoveryPrefix(userId, code) + row.id, JSON.stringify(row));
    existing.push(row);
  }
}
