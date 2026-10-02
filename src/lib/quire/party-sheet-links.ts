/** Device-only references to account sheets; never copies sheets, coins, or inventory. */
export type PartySheetLink = { sheetId: string; purseId: string };
type LinkStorage = Pick<Storage, "getItem" | "setItem">;
const prefix = "lootsplit.party-sheets.v1.";
const changed = "lootsplit:character-sheet-change";
const signalKey = "lootsplit.character-sheet-change.v1";
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256;
function storageKey(ownerId: string, campaignId: string) {
  if (!validId(ownerId) || !validId(campaignId))
    throw new Error("Open your account and campaign first.");
  return `${prefix}${encodeURIComponent(ownerId)}.${encodeURIComponent(campaignId)}`;
}
export function readPartySheetLinks(
  ownerId: string,
  campaignId: string,
  storage: LinkStorage = localStorage,
): PartySheetLink[] {
  if (!ownerId || !campaignId) return [];
  try {
    const value: unknown = JSON.parse(storage.getItem(storageKey(ownerId, campaignId)) || "[]");
    if (!Array.isArray(value)) return [];
    const purses = new Set<string>(),
      sheets = new Set<string>();
    return value
      .filter((row): row is PartySheetLink => {
        if (
          !row ||
          !validId(row.sheetId) ||
          !validId(row.purseId) ||
          purses.has(row.purseId) ||
          sheets.has(row.sheetId)
        )
          return false;
        purses.add(row.purseId);
        sheets.add(row.sheetId);
        return true;
      })
      .map(({ sheetId, purseId }) => ({ sheetId, purseId }));
  } catch {
    return [];
  }
}
export function writePartySheetLink(
  ownerId: string,
  campaignId: string,
  sheetId: string,
  purseId: string,
  controlledPurseIds: string[],
  storage: LinkStorage = localStorage,
) {
  if (!validId(sheetId)) throw new Error("Choose a saved character sheet.");
  if (purseId && (!validId(purseId) || !controlledPurseIds.includes(purseId)))
    throw new Error("Choose a character controlled by your current campaign seat.");
  const links = readPartySheetLinks(ownerId, campaignId, storage);
  if (purseId && links.some((link) => link.purseId === purseId && link.sheetId !== sheetId))
    throw new Error("That campaign character already has a linked sheet. Unlink it first.");
  const next = links.filter((link) => link.sheetId !== sheetId);
  if (purseId) next.push({ sheetId, purseId });
  storage.setItem(storageKey(ownerId, campaignId), JSON.stringify(next));
  return next;
}
export function announceSheetChange() {
  if (typeof window === "undefined") return;
  // Storage events refresh another Lootsplit tab; the custom event refreshes this one.
  try {
    localStorage.setItem(signalKey, crypto.randomUUID());
  } catch {
    /* Poll/focus still refresh. */
  }
  window.dispatchEvent(new Event(changed));
}
export function subscribeSheetChanges(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === signalKey || event.key?.startsWith(prefix)) listener();
  };
  window.addEventListener(changed, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener("storage", storage);
  };
}
