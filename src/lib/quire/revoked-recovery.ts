import type { Command } from "./commands.ts";

export type RevokedRecovery = {
  id: string;
  code: string;
  seatId: string;
  batchId: string;
  commands: Command[];
  exportedAt: number;
  userId?: string;
  separateSeat: true;
  revoked: true;
};
type StoredCopy = { value: RevokedRecovery; key?: string; guest: boolean };
const copies: StoredCopy[] = [];
const PREFIX = "quire.account-recovery.v1.";
const LEGACY = "lootsplit.revoked-recovery:";

function verifiedOwner() {
  return typeof sessionStorage === "undefined"
    ? null
    : sessionStorage.getItem("lootsplit.verified-account");
}
function eligible(copy: StoredCopy) {
  return copy.guest || (!!copy.value.userId && copy.value.userId === verifiedOwner());
}
function loadOwnedCopies() {
  const owner = verifiedOwner();
  if (!owner || typeof localStorage === "undefined") return;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (!key.startsWith(PREFIX) || copies.some((c) => c.key === key)) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key)!);
      if (
        value.revoked &&
        value.userId === owner &&
        typeof value.id === "string" &&
        typeof value.code === "string" &&
        typeof value.seatId === "string" &&
        typeof value.batchId === "string" &&
        Array.isArray(value.commands)
      )
        copies.push({ key, guest: false, value });
    } catch {
      /* Preserve unreadable copies without displaying private content. */
    }
  }
}

/** Revoke transport separately. Never store or export its bearer token. */
export function rememberRevokedRecovery(
  session: { code: string; seatId: string; batchId: string; pending: Command[]; userId?: string },
  ephemeral: boolean,
) {
  // The author of an offline queue cannot change merely because authentication
  // changes before its rejected request returns. Unknown legacy DM ownership
  // uses the verification affordance; anonymous guests remain anonymous.
  const owner = session.userId;
  const value: RevokedRecovery = {
    id: crypto.randomUUID(),
    code: session.code,
    seatId: session.seatId,
    batchId: session.batchId,
    commands: structuredClone(session.pending),
    exportedAt: Date.now(),
    ...(owner ? { userId: owner } : {}),
    separateSeat: true,
    revoked: true,
  };
  const key = ephemeral
    ? undefined
    : owner
      ? `${PREFIX}account-${owner}-${value.code}.${value.seatId}.${value.batchId}.${value.id}`
      : `${LEGACY}${value.code}:${value.id}`;
  // Preserve the memory copy even if durable storage is unavailable/full.
  const copy: StoredCopy = { value, guest: ephemeral && !owner };
  copies.push(copy);
  if (key) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      copy.key = key;
    } catch {
      // Revoked credentials must still detach when storage is full. The memory
      // recovery/export and document-close warning remain available.
    }
  }
  return value.id;
}
export function revokedRecoverySummaries() {
  loadOwnedCopies();
  return copies
    .filter(eligible)
    .map(({ value }) => ({ id: value.id, code: value.code, pending: value.commands.length }));
}
export function hasRevokedMemoryWork() {
  return copies.some((c) => !c.key && c.value.commands.length > 0);
}
export function revokedRecoveryCopy(id: string): RevokedRecovery {
  loadOwnedCopies();
  const copy = copies.find((c) => c.value.id === id && eligible(c));
  if (!copy) throw Error("Sign in to the account that owns this recovery copy.");
  // A loaded/older record may include extra fields; only approved token-free
  // recovery fields leave the document.
  const { code, seatId, batchId, commands, exportedAt, userId } = copy.value;
  return {
    id,
    code,
    seatId,
    batchId,
    commands,
    exportedAt,
    ...(userId ? { userId } : {}),
    separateSeat: true,
    revoked: true,
  };
}
export function discardRevokedRecovery(id: string) {
  loadOwnedCopies();
  const index = copies.findIndex((c) => c.value.id === id && eligible(c));
  if (index === -1) throw Error("Sign in to the account that owns this recovery copy.");
  const copy = copies[index]!;
  if (copy.key) localStorage.removeItem(copy.key);
  copies.splice(index, 1);
}
export function legacyRecoveryCount() {
  if (typeof localStorage === "undefined") return 0;
  return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(
    (key) => key?.startsWith(LEGACY) && !copies.some((c) => c.key === key && eligible(c)),
  ).length;
}
/** An authenticated library proves account/campaign ownership, never names. */
export function authorizeLegacyRecovery(
  owner: string,
  members: Array<{ code: string; role: string | null }>,
) {
  if (owner !== verifiedOwner()) throw Error("Sign in before verifying older recovery copies.");
  const permitted = new Set(members.filter((m) => m.role === "dm").map((m) => m.code));
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (!key.startsWith(LEGACY)) continue;
    const existing = copies.find((c) => c.key === key);
    if (existing?.value.userId) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key)!);
      if (
        (value.userId && value.userId !== owner) ||
        !permitted.has(value.code) ||
        !Array.isArray(value.commands)
      )
        continue;
      const copy: StoredCopy = {
        key,
        guest: false,
        value: {
          id: `legacy:${key}`,
          code: value.code,
          seatId: value.seatId || "",
          batchId: value.batchId || "",
          commands: value.commands,
          exportedAt: value.exportedAt || Date.now(),
          userId: owner,
          separateSeat: true,
          revoked: true,
        },
      };
      if (existing) Object.assign(existing, copy);
      else copies.push(copy);
    } catch {
      /* Keep unverified/unreadable records unchanged for device recovery. */
    }
  }
}
