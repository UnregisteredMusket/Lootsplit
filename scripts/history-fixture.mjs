/**
 * Synthetic large-campaign history for storage tests and the memory measurement
 * (scripts/room-memory-measure.mjs). Shaped like the largest measured campaign (2026-10-28,
 * read-only production measurement): the live ledger is the biggest part, then chat, then
 * journal notes, plus archived sessions whose snapshots are full tables. Never a real campaign.
 */

/** Ledger lines, chat lines and journal notes adding up to about `target` stored bytes. */
export function grow(room, target, options = {}) {
  const per = (share, size) => Math.round((target * share) / size);
  const prefix = options.prefix ?? "";
  const purse = (i) => (i % 3 === 0 ? "party" : i % 3 === 1 ? "a" : "b");
  room.table.ledger = Array.from({ length: per(0.55, 200) }, (_, i) => ({
    id: `${prefix}l-${i}`,
    at: 1_700_000_000_000 + i,
    purseId: purse(i),
    shopId: null,
    summary: `Bought supplies ${i}: rope, lantern oil and rations`,
    copper: -1 - (i % 97),
    transactionType: "purchase",
  }));
  room.table.notes = Array.from({ length: per(0.25, 160) }, (_, i) => ({
    id: `${prefix}n-${i}`,
    at: 1_700_000_000_000 + i,
    from: i % 5 ? "player" : "dm",
    to: i % 7 ? "party" : "dm",
    purseId: i % 5 ? "a" : "",
    text: `Session chatter ${i}: the caravan moves north at dawn.`,
  }));
  room.table.journal.entries = Array.from({ length: per(0.2, 600) }, (_, i) => ({
    id: `${prefix}e-${i}`,
    at: 1_700_000_000_000 + i,
    authorId: "dm",
    purseId: "",
    visibility: i % 4 ? "party" : "dm",
    title: `Entry ${i}`,
    text: `${i % 4 ? "Lore" : "DM-SECRET"} `.repeat(100),
    reportIds: [],
  }));
  return room;
}

/**
 * `count` archived sessions of about `bytes` each, appended to the room's reports (the snapshot is
 * the table with its own session ledger and chat, as `archiveSession` writes it).
 */
export function archiveSessions(room, count, bytes, seatIds) {
  const reports = (room.table.journal.reports ??= []);
  for (let s = 0; s < count; s++) {
    const snapshot = structuredClone(room.table);
    delete snapshot.journal.reports;
    snapshot.journal.entries = [];
    const lines = Math.round((bytes * 0.7) / 200);
    snapshot.ledger = Array.from({ length: lines }, (_, i) => ({
      id: `s${s}-l-${i}`,
      at: 1_600_000_000_000 + s * 1e6 + i,
      purseId: i % 2 ? "a" : "party",
      shopId: null,
      // Every tenth line is a plain adjustment, which Undo can reverse (memory of Undo of an
      // archived line: room-memory-measure.mjs `undo-archived`).
      summary: i % 10 ? `Session ${s} purchase ${i}: rope, lantern oil and rations` : `Session ${s} adjust ${i}: rope, lantern oil and rations`,
      copper: -1 - (i % 97),
      transactionType: i % 10 ? "purchase" : "adjustment",
    }));
    snapshot.notes = Array.from({ length: Math.round((bytes * 0.3) / 160) }, (_, i) => ({
      id: `s${s}-n-${i}`,
      at: 1_600_000_000_000 + s * 1e6 + i,
      from: "dm",
      to: "party",
      purseId: "",
      text: `Session ${s} chatter ${i}: the caravan moves north at dawn.`,
    }));
    reports.push({ id: `session-${s}`, name: `Session ${s + 1}`, at: 1_600_000_000_000 + s * 1e6, seatIds, snapshot: JSON.stringify(snapshot) });
  }
  return room;
}
