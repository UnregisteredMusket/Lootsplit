/**
 * The footprint reference campaign (docs/FOOTPRINT.md, owner decision 2026-11-01): a synthetic year
 * of weekly play driven through the real server code (`openRoom`, `joinRoom`, `submitCommands`,
 * `roomState`) on a disposable in-memory D1 with every migration applied. Never a real campaign.
 *
 * Shape: six characters and a party fund, 300 items, and 52 sessions. Each session starts, records
 * 24 coin transfers between characters (one ledger line each) and two party journal notes, then ends,
 * which archives it into campaign history. The measurements are what a new feature can grow: the
 * stored live campaign, the DM's and a player's synced views, and the stored archive per session.
 *
 * World features (audit 2026-11-10, F6): three shops of 20 lines at the port, a settlement profile,
 * three factions controlling those shops (two revealed) with a renown change for every character
 * each session, two 20-item shop lists, and every fourth session a new market event and a stock
 * swap at the first shop. So growth in factions, settlements, shop lists or market events moves
 * these measurements too.
 */
import { localAccountDb } from "./account-dev-db.mjs";

export const REFERENCE = Object.freeze({
  sessions: 52,
  characters: 6,
  items: 300,
  transfersPerSession: 24,
  notesPerSession: 2,
  shops: 3,
  linesPerShop: 20,
  factions: 3,
  shopLists: 2,
  /** A market event and a stock swap every this many sessions. */
  worldEvery: 4,
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
    const { defaultFactionDraft } = await import("../src/lib/quire/factions.ts");
    const { listFingerprint, shopListsOf, stockFingerprint } = await import(
      "../src/lib/quire/shop-lists.ts"
    );

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

    const shopIds = Array.from({ length: REFERENCE.shops }, (_, i) => `fp-shop-${i}`);
    for (const [i, id] of shopIds.entries()) {
      table.shops.push({
        id,
        name: `Reference shop ${i + 1}`,
        keeper: "Keeper",
        place: "",
        notes: "",
        sellRate: 1,
        buyRate: 0.5,
        wealth: "modest",
        category: "general",
        priceScale: 1,
        locationId: "port",
      });
      for (let j = 0; j < REFERENCE.linesPerShop; j++)
        table.stock.push({
          id: `${id}-line-${j}`,
          shopId: id,
          name: `Reference good ${i}-${j}`,
          copper: 100 + j * 15,
          baseCopper: 100 + j * 15,
          quantity: j % 4 ? 5 + j : null,
          notes: j % 5 ? "" : "A staple of the port market.",
          rarity: "common",
          category: "general",
        });
    }

    const dm = await openRoom({ name: "Footprint DM", table });
    const player = await joinRoom({ code: dm.code, purseId: "a", name: "Arden's player" });
    const protocol = CURRENT_TABLETOP_PROTOCOL;
    const as = (seat) => ({ code: dm.code, token: seat.token, tabletopProtocol: protocol });
    let n = 0;
    const submit = (commands) => {
      clock += 10_000;
      return submitCommands({ ...as(dm), batchId: `fp-batch-${++n}`, commands });
    };

    // World features set up once: a settlement, factions, shop lists.
    await submit([
      {
        id: "fp-settlement",
        kind: "settlement-profile",
        locationId: "port",
        before: null,
        profile: { tier: "small-city", population: "about 9,000" },
      },
      ...Array.from({ length: REFERENCE.factions }, (_, i) => ({
        id: `fp-faction-${i}`,
        kind: "faction-save",
        factionId: `fp-faction-${i}`,
        revision: null,
        faction: {
          ...defaultFactionDraft(),
          name: `Reference guild ${i + 1}`,
          description: "Merchants who set the port's prices. ".repeat(4),
          note: "Secretly owes the harbour master.",
          controls: { locationIds: [], shopIds: [shopIds[i]] },
        },
      })),
      ...Array.from({ length: REFERENCE.factions - 1 }, (_, i) => ({
        id: `fp-faction-reveal-${i}`,
        kind: "faction-visibility",
        factionId: `fp-faction-${i}`,
        revision: 0,
        hidden: false,
      })),
      ...Array.from({ length: REFERENCE.shopLists }, (_, i) => ({
        id: `fp-list-${i}`,
        kind: "shop-list-save",
        listId: `fp-list-${i}`,
        before: null,
        list: {
          name: i ? "Summer goods" : "Winter goods",
          items: Array.from({ length: REFERENCE.linesPerShop }, (_, j) => ({
            name: `${i ? "Summer" : "Winter"} good ${j}`,
            copper: 80 + j * 20,
            baseCopper: 80 + j * 20,
            quantity: j % 3 ? 4 + j : null,
            notes: "",
            rarity: "common",
          })),
        },
      })),
    ]);

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
      await submit([
        {
          id: `fp-renown-${s}`,
          kind: "faction-renown",
          factionId: `fp-faction-${s % REFERENCE.factions}`,
          characters: CHARACTERS.map((characterId, i) => ({
            characterId,
            delta: ((s + i) % 5) - 2 || 1,
          })),
          reason: `Session ${s + 1} dealings`,
        },
      ]);
      if (s % REFERENCE.worldEvery === 0) {
        const view = (await roomState(as(dm))).table;
        const k = s / REFERENCE.worldEvery;
        const list = shopListsOf(view.journal).lists.find(
          (l) => l.id === `fp-list-${k % REFERENCE.shopLists}`,
        );
        await submit([
          {
            id: `fp-event-${s}`,
            kind: "market-event",
            eventId: `fp-event-${s}`,
            before: null,
            after: {
              id: `fp-event-${s}`,
              name: `Reference event ${k + 1}`,
              scope: { kind: "shop", shopId: shopIds[k % REFERENCE.shops] },
              permille: 900 + (k % 5) * 100,
              startDay: s * 7,
              endDay: s * 7 + 14,
              note: "Caravans are late.",
            },
          },
          {
            id: `fp-swap-${s}`,
            kind: "shop-list-swap",
            shopId: shopIds[0],
            listId: list.id,
            before: stockFingerprint(view.stock, shopIds[0]),
            listBefore: listFingerprint(list),
            savedName: `Reference shop 1 stock before ${list.name}, session ${s + 1}`,
          },
        ]);
      }
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
    const journal = dmView.table.journal ?? {};
    return {
      sessions,
      // What the world features stored, so the test can tell they were played.
      world: {
        factions: (journal.factions ?? []).length,
        standing: (journal.factions ?? []).reduce((n, f) => n + Object.keys(f.standing ?? {}).length, 0),
        settlements: Object.keys(journal.settlements?.places ?? {}).length,
        shopLists: shopListsOf(journal).lists.length,
        marketEvents: (journal.marketEvents ?? []).length,
      },
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
