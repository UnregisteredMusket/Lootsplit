// "Preview as player" (docs/FEATURE-INVENTORY.md, "Preview as player"): the DM's read-only preview of one seat.
// - Parity: the device preview, computed from the DM's own copy with `seatView`, equals the table
//   the server's `view()` sends that seat, for a room with hidden NPCs, DM-only ledger lines,
//   other players' private purses, hidden quest objectives, fog and unrevealed map places.
// - Records the DM may not read itself (player-to-player messages) never enter the preview.
// - Read-only: a command, a device save or a room write attempted during preview is refused
//   and changes nothing; leaving restores the DM seat; only a DM can start a preview.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands } from "./cloud.server.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type Command } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { questsOf } from "./quests.ts";
import { campaignMapSchema } from "./world-schema.ts";
import { canonicalJson } from "./canonical-json.ts";
import { seatView } from "./player-view.ts";
import {
  PreviewReadOnlyError,
  assertNotPreviewing,
  getPreview,
  previewScreenAllowed,
  previewSeatOf,
  startPreview,
  stopPreview,
} from "./player-preview.ts";
import { DM_SEAT, getSeat, setSeat } from "./table.ts";
import {
  applyCloudTable,
  economySnapshot,
  economyView,
  executeLocalCommand,
} from "./economy.ts";
import { getChatSnapshot, postNotes, refreshChat } from "./chat.ts";
import { saveHandouts } from "./handouts.ts";
import { quireDb } from "./db.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of ["0001_campaign_rooms.sql", "0024_campaign_room_receipts.sql", "0026_campaign_room_sections.sql", "0029_campaign_room_report_parts.sql", "0030_campaign_room_archive_keys.sql", "0003_accounts.sql", "0007_character_play.sql", "0008_encounters.sql"])
  sql.exec(readFileSync(new URL(`../../../cloudflare/migrations/${file}`, import.meta.url), "utf8"));
(globalThis as any).__env__ = {
  DB: {
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(query: string) {
      let values: any[] = [];
      return {
        bind(...args: any[]) {
          values = args;
          return this;
        },
        async all() {
          if (query.includes("FROM play_characters")) return { results: [] };
          return { results: sql.prepare(query).all(...values) };
        },
        async first() {
          return sql.prepare(query).get(...values) ?? null;
        },
        async run() {
          return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } };
        },
      };
    },
  },
};

const coins = (gp = 0) => ({ cp: 0, sp: 0, ep: 0, gp, pp: 0 });
const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const grid = { columns: 10, rows: 10, feetPerTile: 5, diagonal: "equal" as const, x: 0, y: 0, width: 1, height: 1 };
const map = (id: string, extra: Record<string, unknown> = {}) =>
  campaignMapSchema.parse({
    id,
    name: id,
    image: "data:image/png;base64,YQ==",
    locationId: "town",
    visible: true,
    type: "city",
    anchors: [],
    markers: [
      { id: `${id}-public`, visibility: "party", x: 0.5, y: 0.5, label: "Inn", description: "" },
      { id: `${id}-secret`, visibility: "dm", x: 0.6, y: 0.6, label: "Smugglers' cellar", description: "DM only" },
    ],
    ...extra,
  });

/** Party fund, three party players, one player character away, a visible NPC and a hidden one. */
function campaign(): CloudTable {
  let t: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      { id: "fund", name: "Party fund", kind: "party", coins: coins(50) },
      { id: "aria", name: "Aria", kind: "character", coins: coins(11) },
      { id: "bram", name: "Bram", kind: "character", coins: coins(22) },
      { id: "cass", name: "Cass", kind: "character", coins: coins(33) },
      { id: "mirelle", name: "Mirelle", kind: "character", coins: coins(44) },
      { id: "hollin", name: "Hollin", kind: "character", control: "npc", nonParty: true, coins: coins(900) },
      { id: "spy", name: "The Spy", kind: "character", control: "npc", nonParty: true, coins: coins(777) },
    ],
    holdings: [
      { id: "h-aria", purseId: "aria", name: "Rope", kind: "item", quantity: 1, unitCopper: 100, notes: "" },
      { id: "h-spy", purseId: "spy", name: "Forged seal", kind: "item", quantity: 1, unitCopper: 5000, notes: "" },
      { id: "h-mirelle", purseId: "mirelle", name: "Letter", kind: "item", quantity: 1, unitCopper: 0, notes: "" },
    ] as CloudTable["holdings"],
    ledger: [
      { id: "l-aria", at: 1, purseId: "aria", shopId: null, summary: "Advance", copper: 400 },
      { id: "l-fund", at: 2, purseId: "fund", shopId: null, summary: "Bounty", copper: 5000 },
      { id: "l-spy", at: 3, purseId: "spy", shopId: null, summary: "Bribe from the duke", copper: 70000 },
      { id: "l-hollin", at: 4, purseId: "hollin", shopId: null, summary: "Hollin's takings", copper: 9000 },
      { id: "l-mirelle", at: 5, purseId: "mirelle", shopId: null, summary: "Mirelle's private sale", copper: 300 },
    ],
    notes: [
      { id: "n-party", at: 10, from: "dm", to: "party", purseId: "", text: "Welcome." },
      { id: "n-aria", at: 11, from: "dm", to: "dm", purseId: "aria", text: "Aria, you hear a whisper." },
      { id: "n-bram", at: 12, from: "dm", to: "dm", purseId: "bram", text: "Bram, the spy is your cousin." },
    ],
    journal: readJournal({
      market: {
        currentLocationId: "town",
        locations: [
          { id: "region", name: "Vale", kind: "region", parentId: null, description: "" },
          { id: "town", name: "Harrowgate", kind: "town", parentId: "region", description: "" },
          { id: "market", name: "Night market", kind: "area", parentId: "town", description: "" },
          { id: "ford", name: "Fenwick Ford", kind: "town", parentId: "region", description: "" },
        ],
      },
      sessions: [{ id: "s1", name: "Session 1", startedAt: 1 }],
      world: {
        characterPositions: [{ purseId: "mirelle", inParty: false, locationId: "ford", visible: true, sheetVisible: true }],
        npcs: [
          { id: "hollin", name: "Hollin", description: "", locationId: "town", visible: true, barterAllowed: false, controllerPurseId: null },
          { id: "spy", name: "The Spy", description: "Works for the duke", locationId: "town", visible: false, barterAllowed: false, controllerPurseId: null },
        ],
        maps: [
          map("city"),
          map("vault", { visible: false }),
          map("dungeon", {
            grid,
            tokens: [
              { id: "t-aria", label: "Aria", kind: "character", entityId: "aria", column: 1, row: 1, visibility: "party", vision: { enabled: true, rangeFeet: 25, darkvisionFeet: 0 } },
              { id: "t-spy", label: "Spy", kind: "character", entityId: "spy", column: 8, row: 8, visibility: "dm" },
            ],
            tabletop: {
              vision: "party",
              ambientLight: true,
              fog: {
                enabled: true,
                base: "concealed",
                shapes: [{ id: "left", kind: "rectangle", reveal: true, a: { x: 0, y: 0 }, b: { x: 0.5, y: 1 } }],
              },
            },
          }),
        ],
      },
    }),
  };
  const run = (cmd: Command) => (t = applyCommand(t, dmSeat, cmd));
  const rev = () => questsOf(t).find((q) => q.id === "q1")!.revision;
  run({
    id: "q1",
    kind: "quest-save",
    questId: null,
    revision: null,
    quest: {
      title: "Hollin's Missing Mare",
      summary: "Find the mare.",
      giverNpcId: "hollin",
      locationIds: ["market"],
      markers: [{ mapId: "city", markerId: "city-public" }],
      areas: [],
      objectives: [
        { id: "o-search", text: "Search the market", locationId: "market" },
        { id: "o-secret", text: "Learn that the spy stole her", hidden: true },
      ],
      rewardText: "40 gp",
      dmNotes: "The spy took her.",
    },
  });
  run({ id: "r1", kind: "quest-reveal", questId: "q1", revision: rev(), audience: { kind: "party" }, message: true });
  run({ id: "log1", kind: "quest-log", questId: "q1", revision: rev(), text: "Hollin is lying.", shared: false });
  run({ id: "log2", kind: "quest-log", questId: "q1", revision: rev(), text: "Tracks lead east.", shared: true });
  run({ id: "q2", kind: "quest-save", questId: null, revision: null, quest: { title: "The duke's plot", summary: "Secret", locationIds: [], markers: [], areas: [], objectives: [], rewardText: "", dmNotes: "Never revealed" } });
  return t;
}

const DM_ONLY = ["Forged seal", "Bribe from the duke", "Hollin's takings", "Works for the duke", "Smugglers' cellar", "Never revealed", "The spy took her", "Hollin is lying", "Learn that the spy stole her"];
/** Private to one seat: only that seat's preview may hold it. */
const PRIVATE: Record<string, string[]> = {
  Aria: ["Aria, you hear a whisper."],
  Bram: ["Bram, the spy is your cousin"],
  Mirelle: ["Mirelle's private sale", "Letter"],
};

async function sharedRoom() {
  const dm = await openRoom({ name: "Preview DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const bram = await joinRoom({ code: dm.code, purseId: "bram", name: "Bram" });
  const mirelle = await joinRoom({ code: dm.code, purseId: "mirelle", name: "Mirelle" });
  return { dm, aria, bram, mirelle };
}

test("parity: the device preview of a seat equals the server's view() table for that seat", async () => {
  const { dm, aria, bram, mirelle } = await sharedRoom();
  // What the DM's device holds: the DM's own view of the room.
  const dmView = await roomState(dm);
  for (const [name, joined] of [["Aria", aria], ["Bram", bram], ["Mirelle", mirelle]] as const) {
    const server = await roomState({ code: dm.code, token: joined.token });
    // The app previews a character: the seat that holds it (its seat ID is not needed, because
    // seat-addressed records are never on the DM's device; see the second test).
    const preview = seatView(dmView.table, { purseIds: joined.purseIds });
    assert.equal(canonicalJson(preview), canonicalJson(server.table), `${name}: preview differs from the server view`);
    const text = JSON.stringify(preview);
    for (const secret of DM_ONLY) assert.ok(!text.includes(secret), `${name}'s preview holds DM-only "${secret}"`);
    for (const [owner, secrets] of Object.entries(PRIVATE))
      for (const secret of secrets)
        assert.equal(text.includes(secret), owner === name, `${name}'s preview and ${owner}'s private "${secret}"`);
    // The fogged map reaches the preview projected (no fog shapes), the hidden map not at all.
    const maps = preview.journal?.world?.maps ?? [];
    assert.deepEqual(maps.map((m) => m.id).sort(), ["city", "dungeon"]);
    assert.deepEqual(maps.find((m) => m.id === "dungeon")?.tabletop?.fog?.shapes, []);
    assert.ok(!maps.some((m) => m.tokens?.some((t) => t.id === "t-spy")));
    // Hidden objectives stay out; the hidden NPC and the other seat's private purse too.
    const quests = questsOf(preview);
    assert.deepEqual(quests.map((q) => q.id), ["q1"]);
    assert.deepEqual(quests[0].objectives.map((o) => o.id), ["o-search"]);
    assert.ok(!(preview.journal?.world?.npcs ?? []).some((n) => n.id === "spy"));
    assert.ok(!preview.purses.some((p) => p.id === "spy"), "hidden NPC purse");
  }
  // The DM's own view still holds everything (nothing was projected in place).
  assert.ok(JSON.stringify(dmView.table).includes("Bribe from the duke"));
});

test("parity: player-to-player messages the DM cannot read never enter the preview", async () => {
  const { dm, aria, bram } = await sharedRoom();
  await submitCommands({
    code: dm.code,
    token: aria.token,
    batchId: "whisper",
    commands: [{ id: "whisper-1", kind: "message", to: "player", recipientId: "bram", purseId: "aria", text: "Meet me at midnight." }],
  });
  const dmView = await roomState(dm);
  const server = await roomState({ code: dm.code, token: bram.token });
  const preview = seatView(dmView.table, { purseIds: bram.purseIds });
  // The preview is the server view less what the DM itself may not read: never more.
  const dmReadable = new Set(dmView.table.notes.map((n) => n.id));
  assert.deepEqual(
    preview.notes.map((n) => n.id),
    server.table.notes.filter((n) => dmReadable.has(n.id)).map((n) => n.id),
  );
  assert.ok(!JSON.stringify(preview).includes("Meet me at midnight"));
  const { notes: _p, ...previewRest } = preview;
  const { notes: _s, ...serverRest } = server.table;
  assert.equal(canonicalJson(previewRest), canonicalJson(serverRest));
});

test("read-only: a command attempted during preview is refused and changes nothing", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const before = canonicalJson(await economySnapshot());
  startPreview({ name: "Aria", purseIds: ["aria"] });
  try {
    assert.equal(getSeat().role, "player");
    assert.deepEqual(getSeat().purseIds, ["aria"]);
    assert.throws(() => assertNotPreviewing(), PreviewReadOnlyError);
    await assert.rejects(
      executeLocalCommand({ id: "preview-give", kind: "give", fromId: "aria", toId: "bram", copper: 100, holdingId: null, quantity: 0 } as never),
      (error: Error) => error instanceof PreviewReadOnlyError && /read-only/.test(error.message),
    );
    await assert.rejects(
      executeLocalCommand({ id: "preview-coins", kind: "set-coins", purseId: "aria", before: coins(11), coins: coins(999) } as never),
      PreviewReadOnlyError,
    );
    // Any device save, whichever screen tries it: this campaign's database refuses read-write.
    await assert.rejects(postNotes([{ from: "player", to: "party", purseId: "aria", text: "Hello" }]), PreviewReadOnlyError);
    await assert.rejects(saveHandouts([{ id: "x", title: "Leak", text: "x" }]), PreviewReadOnlyError);
    const db = await quireDb();
    assert.throws(() => db.transaction(["meta"], "readwrite"), PreviewReadOnlyError);
    assert.doesNotThrow(() => db.transaction(["meta"], "readonly"));
    // A seat change (a save of this device's role) is refused too.
    assert.throws(() => setSeat({ ...getSeat(), role: "player" }), PreviewReadOnlyError);
    // The app reads the player view while previewing.
    const viewed = await economyView();
    const text = JSON.stringify(viewed) + JSON.stringify(await economySnapshot());
    for (const secret of ["Forged seal", "Bribe from the duke", "Works for the duke", "Never revealed"])
      assert.ok(!text.includes(secret), `economyView during preview holds "${secret}"`);
    // The chat shows the previewed seat's messages only (a refresh does not bring the DM's back).
    await refreshChat();
    const shown = getChatSnapshot().map((n) => n.id);
    assert.ok(shown.includes("n-aria") && shown.includes("n-party"));
    assert.ok(!shown.includes("n-bram"), "another player's whisper in the preview chat");
  } finally {
    stopPreview();
  }
  assert.equal(getPreview(), null);
  assert.equal(getSeat().role, "dm");
  assert.equal(canonicalJson(await economySnapshot()), before, "the campaign changed during preview");
  await refreshChat();
  assert.ok(getChatSnapshot().some((n) => n.id === "n-bram"), "the DM's chat is back after Stop preview");
  // The same command works again once the preview has stopped.
  await executeLocalCommand({ id: "after-preview", kind: "set-coins", purseId: "aria", before: coins(11), coins: coins(12) } as never);
  assert.equal((await economySnapshot()).purses.find((p) => p.id === "aria")?.coins.gp, 12);
});

test("read-only: every room write of the shared-room client is refused during preview", () => {
  // room-transport.ts imports the server functions, which need the app's bundler; check its source:
  // every write it exports goes through `refusedInPreview`, and reads are the only bare exports.
  const source = readFileSync(new URL("./room-transport.ts", import.meta.url), "utf8");
  for (const write of ["closeCloudTable", "joinCloudTable", "openCloudTable", "setCloudPace", "skipCloudTurn", "submitCloudCommands", "nameCloudRoom", "manageCloudRoom"])
    assert.match(source, new RegExp(`export const ${write} = refusedInPreview\\(`), write);
  assert.match(source, /export \{ previewCloudTable, readCloudHistory \};/);
  // The poll applies nothing while a preview runs.
  const client = readFileSync(new URL("./cloud-client.ts", import.meta.url), "utf8");
  const refresh = client.indexOf("async function refresh(conditional = false) {");
  assert.ok(refresh > 0);
  assert.ok(client.slice(refresh, refresh + 400).includes("if (playerPreviewActive()) return;"));
  // Nothing is queued during a preview (a queued action would be sent after it ends).
  for (const name of ["export async function queueCommand(", "export async function queueCommandBatch(", "export function runSharedMutation("]) {
    const at = client.indexOf(name);
    assert.ok(at > 0, name);
    assert.ok(client.slice(at, at + 400).includes("if (playerPreviewActive()) return Promise.reject(new PreviewReadOnlyError());"), name);
  }
  // A chat message never enters the outbox during a preview.
  const chat = readFileSync(new URL("../../components/share-chat.tsx", import.meta.url), "utf8");
  const send = chat.indexOf("  function send() {");
  assert.ok(send > 0 && chat.slice(send, send + 400).includes("if (previewActive()) {"));
});

test("screens: only the player's main screens are previewed", () => {
  for (const path of ["/", "/party", "/characters", "/share", "/maps/", "/features/journal", "/features/quests"])
    assert.ok(previewScreenAllowed(path), path);
  for (const path of ["/market", "/shop/x", "/encounters", "/settings", "/account", "/library", "/features/review", "/features/economy", "/player-display"])
    assert.ok(!previewScreenAllowed(path), path);
});

test("read-only: only a DM seat can start a preview, and the preview seat is never saved", () => {
  setSeat({ role: "player", purseIds: ["aria"], shopIds: [], openedAt: 1 });
  assert.throws(() => startPreview({ name: "Bram", purseIds: ["bram"] }), /Only the DM/);
  assert.equal(getPreview(), null);
  setSeat(DM_SEAT);
  startPreview({ name: "Bram", purseIds: ["bram"] });
  assert.equal(previewSeatOf(getPreview())?.role, "player");
  stopPreview();
  assert.equal(getSeat().role, "dm");
});
