/**
 * The footprint reference campaign (docs/FOOTPRINT.md, owner decision 2026-11-01): a synthetic year
 * of weekly play driven through the real server code (`openRoom`, `joinRoom`, `submitCommands`,
 * `roomState`) on a disposable in-memory D1 with every migration applied. Never a real campaign.
 *
 * Shape: six characters and a party fund, 300 items, and 52 sessions. Each session starts, records
 * 24 coin transfers between characters (one ledger line each) and two party journal notes, then ends,
 * which archives it into campaign history. The measurements are what a new feature can grow: the
 * stored live campaign, the DM's and a player's synced views, and the stored archive per session.
 */
import { localAccountDb } from "./account-dev-db.mjs";

export const REFERENCE = Object.freeze({
  sessions: 52,
  characters: 6,
  items: 300,
  transfersPerSession: 24,
  notesPerSession: 2,
});

const CHARACTERS = ["a", "b", "c", "d", "e", "f"];

export async function measureReferenceCampaign({ sessions = REFERENCE.sessions } = {}) {
  const db = localAccountDb();
  const previousEnv = globalThis.__env__;
  globalThis.__env__ = { DB: db };
  // A fixed clock that advances 10 s per submission: timestamps (and so sizes) repeat exactly from
  // run to run, and the per-seat flood protection sees an ordinary pace of play.
  const realNow = Date.now;
  let clock = Date.parse("2026-01-03T18:00:00Z");
  Date.now = () => clock;
  try {
    const { openRoom, joinRoom, roomState, submitCommands } =
      await import("../src/lib/quire/cloud.server.ts");
    const { readStoredRoom } = await import("../cloudflare/room-storage.mjs");
    const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
    const { fromCopper } = await import("../src/lib/quire/money.ts");
    const { CURRENT_TABLETOP_PROTOCOL } = await import("../src/lib/quire/tabletop-protocol.ts");

    const table = tradeFixture();
    const names = { c: "Corin", d: "Dessa", e: "Edric", f: "Fenna" };
    for (const id of ["c", "d", "e", "f"])
      table.purses.push({ id, name: names[id], kind: "character", coins: fromCopper(100000) });
    for (let i = 0; i < REFERENCE.items; i++)
      table.holdings.push({
        id: `item-${i}`,
        name: `Reference item ${i}`,
        kind: "item",
        purseId: i % 7 === 6 ? "party" : CHARACTERS[i % CHARACTERS.length],
        quantity: 1 + (i % 3),
        unitCopper: 50 + (i % 40) * 25,
        notes: i % 5 ? "" : "Found in the reference dungeon.",
      });

    const dm = await openRoom({ name: "Footprint DM", table });
    const player = await joinRoom({ code: dm.code, purseId: "a", name: "Arden's player" });
    const protocol = CURRENT_TABLETOP_PROTOCOL;
    const as = (seat) => ({ code: dm.code, token: seat.token, tabletopProtocol: protocol });
    let n = 0;
    const submit = (commands) => {
      clock += 10_000;
      return submitCommands({ ...as(dm), batchId: `fp-batch-${++n}`, commands });
    };

    for (let s = 0; s < sessions; s++) {
      await submit([
        { id: `fp-start-${s}`, kind: "session", name: `Session ${s + 1}`, end: false },
      ]);
      await submit(
        Array.from({ length: REFERENCE.transfersPerSession }, (_, i) => ({
          id: `fp-give-${s}-${i}`,
          kind: "give",
          fromId: CHARACTERS[i % CHARACTERS.length],
          toId: CHARACTERS[(i + 1) % CHARACTERS.length],
          copper: 1 + ((s * 31 + i) % 90),
          holdingId: null,
          quantity: 0,
        })),
      );
      await submit(
        Array.from({ length: REFERENCE.notesPerSession }, (_, i) => ({
          id: `fp-note-${s}-${i}`,
          kind: "journal-note",
          title: `Session ${s + 1} note ${i + 1}`,
          text: "The party followed the river road and traded with the caravan at the ford. ".repeat(
            3,
          ),
          visibility: "party",
          purseId: "",
          reportIds: [],
        })),
      );
      await submit([{ id: `fp-end-${s}`, kind: "session", name: `Session ${s + 1}`, end: true }]);
    }

    const stored = await readStoredRoom(db, dm.code);
    const sectionBytes = Number(
      (
        await db
          .prepare(
            "SELECT COALESCE(SUM(length(body)),0) AS n FROM campaign_room_sections WHERE code=?",
          )
          .bind(dm.code)
          .first()
      ).n,
    );
    const archiveBytes = Number(
      (
        await db
          .prepare(
            "SELECT COALESCE((SELECT SUM(length(body)) FROM campaign_room_reports WHERE code=?),0) + COALESCE((SELECT SUM(length(body)) FROM campaign_room_report_parts WHERE code=?),0) AS n",
          )
          .bind(dm.code, dm.code)
          .first()
      ).n,
    );
    const dmView = await roomState(as(dm));
    const playerView = await roomState(as(player));
    return {
      sessions,
      liveStoredBytes: Buffer.byteLength(stored.body) + sectionBytes,
      dmViewBytes: Buffer.byteLength(JSON.stringify(dmView)),
      playerViewBytes: Buffer.byteLength(JSON.stringify(playerView)),
      archiveBytesPerSession: Math.round(archiveBytes / sessions),
    };
  } finally {
    Date.now = realNow;
    globalThis.__env__ = previousEnv;
    db.close?.();
  }
}

// `node --experimental-strip-types scripts/footprint-fixture.mjs` prints the measurements.
if (import.meta.url === `file://${process.argv[1]}`)
  console.log(JSON.stringify(await measureReferenceCampaign(), null, 2));
