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
type StoredCopy = { value: RevokedRecovery; key?: string; legacyKey?: string; guest: boolean };
const copies: StoredCopy[] = [];
const PREFIX = "quire.account-recovery.v1.";
const LEGACY = "lootsplit.revoked-recovery:";
const CHECK = "lootsplit.legacy-recovery-check.v1";
let lastCheck: { owner: string; keys: string[] } | null = null;

function legacyKeys() {
  if (typeof localStorage === "undefined") return [];
  return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    .filter((key): key is string => !!key?.startsWith(LEGACY))
    .sort();
}
function matchesLegacy(copy: StoredCopy, key: string) {
  try {
    const original = JSON.parse(localStorage.getItem(key)!);
    return (
      original &&
      (!original.userId || original.userId === copy.value.userId) &&
      original.code === copy.value.code &&
      (original.seatId || "") === copy.value.seatId &&
      (original.batchId || "") === copy.value.batchId &&
      JSON.stringify(original.commands) === JSON.stringify(copy.value.commands)
    );
  } catch {
    return false;
  }
}
/** An account-scoped check result is feedback, never an ownership grant. */
export function legacyRecoveryChecked() {
  const owner = verifiedOwner();
  if (!owner) return false;
  let check = lastCheck;
  try {
    if (!check || check.owner !== owner)
      check = JSON.parse(sessionStorage.getItem(CHECK) || "null");
  } catch {
    /* The in-document result remains available if session storage is blocked. */
  }
  return (
    !!check && check.owner === owner && JSON.stringify(check.keys) === JSON.stringify(legacyKeys())
  );
}

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
        copies.push({
          key,
          guest: false,
          value,
          ...(typeof value.legacySourceKey === "string" && value.legacySourceKey.startsWith(LEGACY)
            ? { legacyKey: value.legacySourceKey }
            : {}),
        });
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
  if (copy.legacyKey && matchesLegacy(copy, copy.legacyKey))
    localStorage.removeItem(copy.legacyKey);
  if (copy.key && copy.key !== copy.legacyKey) localStorage.removeItem(copy.key);
  copies.splice(index, 1);
}
export function legacyRecoveryCount() {
  loadOwnedCopies();
  return legacyKeys().filter(
    (key) =>
      !copies.some(
        (c) => (c.legacyKey === key || c.key === key) && eligible(c) && matchesLegacy(c, key),
      ),
  ).length;
}
/** An authenticated library proves account/campaign ownership, never names. */
export function authorizeLegacyRecovery(
  owner: string,
  members: Array<{ code: string; role: string | null }>,
) {
  if (owner !== verifiedOwner()) throw Error("Sign in before verifying older recovery copies.");
  const permitted = new Set(members.filter((m) => m.role === "dm").map((m) => m.code));
  let verified = 0,
    durable = true;
  const keys = legacyKeys();
  for (const key of keys) {
    const existing = copies.find((c) => (c.legacyKey === key || c.key === key) && eligible(c));
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
        legacyKey: key,
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
      // Store only the approved token-free projection, retaining the original
      // legacy bytes. The existing account gate protects this durable copy.
      const ownedKey = `${PREFIX}account-${owner}-legacy-${encodeURIComponent(key)}`;
      try {
        localStorage.setItem(ownedKey, JSON.stringify({ ...copy.value, legacySourceKey: key }));
        copy.key = ownedKey;
      } catch {
        durable = false;
      }
      if (existing) Object.assign(existing, copy);
      else copies.push(copy);
      verified++;
    } catch {
      /* Keep unverified/unreadable records unchanged for device recovery. */
    }
  }
  lastCheck = { owner, keys };
  try {
    sessionStorage.setItem(CHECK, JSON.stringify(lastCheck));
  } catch {
    /* Reporting remains available in this document; no permission is widened. */
  }
  return { verified, remaining: legacyRecoveryCount(), durable };
}
