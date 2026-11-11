// Site-wide storage guard (audit 2026-11-10 H2, owner decision 2026-11-11). Sign-up is open and
// every account may keep up to 60 MB of online backups and 30 MB of characters, so about 70 full
// accounts would pass the 5 GB of D1 storage the plan includes. Once the newest hourly Cloudflare
// usage reading (the one behind the Field monitor's "Database storage" check) puts the database at
// or past STORAGE_GUARD_BYTES, new account backups and character uploads are refused; playing,
// campaign saves, reading, downloading and removing are never affected. The Database storage check
// turns red at the same level, which is the owner's alert.
//
// The request path reads one indexed row (the newest cloudflare-usage log entry); it never
// measures the database itself. A missing, failed or stale (over two hours) reading does not
// block: the guard fails open, and the usage log already reports the gap.
import { latestUsage } from "./monitor-journal.mjs";
import { STORAGE_GUARD_BYTES, storageBytes } from "./monitor-model.mjs";

/** `{ state: "refusing" | "open" | "unknown", bytes, checkedAt }` from the newest usage reading. */
export async function storageGuard(db, now = Date.now()) {
  const usage = await latestUsage(db, now);
  const bytes = storageBytes(usage);
  if (bytes === null) return { state: "unknown", bytes: null, checkedAt: usage?.checkedAt ?? null };
  return {
    state: bytes >= STORAGE_GUARD_BYTES ? "refusing" : "open",
    bytes,
    checkedAt: usage.checkedAt ?? null,
  };
}

export const STORAGE_GUARD_MESSAGE =
  "Lootsplitter's online storage is nearly full, so new online backups and character uploads are paused. Your device data has not changed: keep a device backup for now. Playing and campaign saves are not affected, and the site owner has been alerted.";

/** Throws a 507 account error while the guard is refusing uploads. */
export async function assertStorageOpen(db, now = Date.now()) {
  if ((await storageGuard(db, now)).state === "refusing")
    throw Object.assign(new Error(STORAGE_GUARD_MESSAGE), { status: 507 });
}
