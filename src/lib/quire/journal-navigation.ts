import type { EncounterLootProvenance, Journal } from "./journal.ts";

type Entry = NonNullable<Journal["entries"]>[number];
type Reader = { role: "dm" | "player"; purseIds: string[] };
export const journalEntryHref = (id: string) =>
  `/features/journal#journal-entry-${encodeURIComponent(id)}`;
export const sessionRecordHref = (id: string) =>
  `/features/journal#journal-session-${encodeURIComponent(id)}`;

/** Deep links identify records; they never grant access or guess historical associations. */
export function journalDestination(hash: string): { kind: "entry" | "session"; id: string } | null {
  const match = /^#?journal-(entry|session)-(.+)$/.exec(hash);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[2]);
    return id.length > 0 && id.length <= 150 ? { kind: match[1] as "entry" | "session", id } : null;
  } catch {
    return null;
  }
}

export function authorizedJournalEntries(entries: Entry[], reader: Reader): Entry[] {
  return entries.filter(
    (entry) =>
      entry.visibility === "party" ||
      (reader.role === "dm"
        ? entry.visibility === "dm"
        : entry.visibility === "player" && reader.purseIds.includes(entry.purseId)),
  );
}

export function sessionChronicleEntries(
  entries: Entry[],
  reader: Reader,
  sessionId: string,
): Entry[] {
  return authorizedJournalEntries(entries, reader).filter(
    (entry) =>
      entry.provenance?.kind === "encounter-loot" && entry.provenance.sessionId === sessionId,
  );
}

export type ReceiptScope = {
  role: "dm" | "player";
  joined: boolean;
  roomRole: "dm" | "player";
  code: string;
  ownedDevice: boolean;
};
export type ReceiptDetail = {
  id: string;
  code: string;
  status: string;
  award: null | { receiptId: string };
};

export function canReadEncounterReceipt(provenance: EncounterLootProvenance, scope: ReceiptScope) {
  return (
    scope.role === "dm" &&
    (provenance.encounterId.startsWith("local-")
      ? !scope.joined && scope.ownedDevice
      : scope.joined && scope.roomRole === "dm" && !!scope.code)
  );
}

export function confirmedReceiptHref(
  provenance: EncounterLootProvenance,
  detail: ReceiptDetail,
  scope: ReceiptScope,
): string | null {
  return canReadEncounterReceipt(provenance, scope) &&
    detail.id === provenance.encounterId &&
    detail.status === "awarded" &&
    detail.award?.receiptId === provenance.receiptId &&
    detail.code === (scope.joined ? scope.code : "device")
    ? `/encounters?encounter=${encodeURIComponent(detail.id)}`
    : null;
}
