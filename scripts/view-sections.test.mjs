// Section-aware room sync (tabletop protocol 11, sectioned storage step 3): per-seat projected
// sections, their authorization, delta transfer, the protocol 10 path and the client cache.
// Every case uses a disposable local D1 stand-in with every migration applied; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";

const db = localAccountDb();
globalThis.__env__ = { DB: db };
const { openRoom, joinRoom, roomState, pollRoom, submitCommands } = await import("../src/lib/quire/cloud.server.ts");
const { readRoom, updateRoom } = await import("../src/lib/quire/room-store.server.ts");
const { readJournal } = await import("../src/lib/quire/journal.ts");
const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
const { roomViewResponse, readViewSections, clearViewSectionCacheForTests } = await import("../src/lib/quire/view-sections.server.ts");
const { assembleViewTable, splitViewTable, VIEW_SECTION_CHUNK_ITEMS } = await import("../src/lib/quire/view-sections.ts");
const { createRoomSync } = await import("../src/lib/quire/room-sync.ts");
const { getRoomLoading, subscribeRoomLoading } = await import("../src/lib/quire/room-loading.ts");

const P11 = 11;
/** A shared campaign with two players, a long party chat and a long private whisper thread. */
async function campaign() {
  const dm = await openRoom({ name: "Sections DM", table: tradeFixture() });
  const a = await joinRoom({ code: dm.code, purseId: "a", name: "Player A" });
  const b = await joinRoom({ code: dm.code, purseId: "b", name: "Player B" });
  const room = await readRoom(dm.code);
  room.table.notes = [
    ...Array.from({ length: 6000 }, (_, i) => ({ id: `p-${i}`, at: i, from: "dm", to: "party", purseId: "", text: `Party line ${i}: the road north is long.` })),
    ...Array.from({ length: 600 }, (_, i) => ({ id: `w-${i}`, at: 2000 + i, from: "player", to: "dm", purseId: "b", text: `SECRET-B ${i}: Briar's private whisper to the DM.` })),
  ];
  const world = room.table.journal?.world ?? {};
  // Hidden NPCs (each with its NPC account): DM-only records players must never receive.
  room.table.purses.push(
    ...Array.from({ length: 12 }, (_, i) => ({ id: `hidden-${i}`, name: `HIDDEN-NPC Vexa ${i}`, kind: "character", control: "npc", coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } })),
  );
  room.table.journal = readJournal({
    ...room.table.journal,
    world: {
      ...world,
      npcs: [
        ...(world.npcs ?? []),
        ...Array.from({ length: 12 }, (_, i) => ({
          id: `hidden-${i}`,
          name: `HIDDEN-NPC Vexa ${i}`,
          description: "DM-ONLY " + "plot ".repeat(700),
          locationId: "port",
          visible: false,
          barterAllowed: false,
          controllerPurseId: null,
        })),
      ],
    },
  });
  assert.equal(room.table.journal.world.npcs.filter((n) => !n.visible).length, 12, "the hidden NPCs are kept");
  const base = room.revision;
  room.revision++;
  await updateRoom(room, base);
  return { dm, a: { code: dm.code, token: a.token }, b: { code: dm.code, token: b.token } };
}
const read = async (seat, have = []) => roomViewResponse(await roomState(seat), { tabletopProtocol: P11, viewSections: have });
/** Every section of a response, fetched as the seat itself. */
async function complete(seat, response) {
  const texts = new Map(Object.entries(response.viewSections.data));
  const wanted = [...new Set(response.viewSections.entries.map((e) => e.h))].filter((h) => !texts.has(h));
  while (wanted.length) {
    const got = await readViewSections({ ...seat, tabletopProtocol: P11, hashes: wanted });
    assert.deepEqual(got.missing, []);
    for (const [hash, text] of Object.entries(got.sections)) texts.set(hash, text);
    wanted.splice(0, wanted.length, ...wanted.filter((h) => !texts.has(h)));
  }
  return texts;
}

test("split and assembly are exact, and a long list is chunked so an append changes one chunk", async () => {
  const table = {
    ...tradeFixture(),
    notes: Array.from({ length: VIEW_SECTION_CHUNK_ITEMS * 2 + 7 }, (_, i) => ({ id: `n${i}`, text: `line ${i} é漢😀` })),
  };
  const split = await splitViewTable(table, "salt");
  assert.equal(split.table.notes, null);
  const chunks = split.entries.filter((e) => e.p.join(".") === "notes");
  assert.equal(chunks.length, 3);
  assert.deepEqual(assembleViewTable(split.table, split.entries, split.texts), table);
  const appended = await splitViewTable({ ...table, notes: [...table.notes, { id: "new", text: "one more" }] }, "salt");
  const before = new Set(split.entries.map((e) => e.h));
  assert.deepEqual(
    appended.entries.filter((e) => !before.has(e.h)).map((e) => [e.p.join("."), e.c]),
    [["notes", 2]],
    "only the last chunk changed",
  );
  assert.notDeepEqual((await splitViewTable(table, "other salt")).entries.map((e) => e.h), split.entries.map((e) => e.h));
  assert.throws(() => assembleViewTable(split.table, split.entries, new Map()), /not finished loading/);
  assert.throws(
    () => assembleViewTable(split.table, [{ p: ["__proto__"], h: "0".repeat(32), b: 2 }], new Map([["0".repeat(32), "{}"]])),
    /unreadable/,
  );
});

test("each seat gets a manifest of its own projection; the full table equals protocol 10's", async () => {
  clearViewSectionCacheForTests();
  const { dm, a, b } = await campaign();
  const views = {};
  for (const [name, seat] of Object.entries({ dm, a, b })) {
    const response = await read(seat);
    assert.ok(response.viewSections.entries.length > 0, `${name} receives a sectioned view`);
    assert.ok(response.table.notes === null, `${name}'s chat is sent as sections`);
    const texts = await complete(seat, response);
    const table = assembleViewTable(response.table, response.viewSections.entries, texts);
    // The old full-view path (protocol 10 clients, the bundled Android app) is unchanged and equal.
    const full = await roomViewResponse(await roomState(seat), { tabletopProtocol: 10 });
    assert.equal(full.viewSections, undefined);
    assert.deepEqual(table, full.table, `${name}'s assembled table is exactly the protocol 10 table`);
    views[name] = { response, texts, table };
  }
  // Hashes are per seat: no hash appears in two seats' manifests.
  const hashes = (name) => new Set(views[name].response.viewSections.entries.map((e) => e.h));
  for (const [x, y] of [["dm", "a"], ["dm", "b"], ["a", "b"]])
    assert.equal([...hashes(x)].filter((h) => hashes(y).has(h)).length, 0, `${x} and ${y} share no hash`);
  // Player A's sections hold neither Briar's whispers nor the hidden NPC.
  const aText = JSON.stringify([...views.a.texts.values()]) + JSON.stringify(views.a.response);
  assert.ok(!aText.includes("SECRET-B") && !aText.includes("HIDDEN-NPC") && !aText.includes("DM-ONLY"));
  assert.ok(JSON.stringify([...views.b.texts.values()]).includes("SECRET-B"), "Briar reads her own whispers");
  assert.ok(JSON.stringify([...views.dm.texts.values()]).includes("HIDDEN-NPC"), "the DM reads the hidden NPC");
});

test("a player cannot fetch the DM's or another player's sections, even with valid hashes", async () => {
  const { dm, a, b } = await campaign();
  for (const fresh of [true, false]) {
    // Without and with the isolate projection cache populated by the other seats' reads.
    if (fresh) clearViewSectionCacheForTests();
    const dmHashes = (await read(dm)).viewSections.entries.map((e) => e.h);
    const bHashes = (await read(b)).viewSections.entries.map((e) => e.h);
    const stolen = await readViewSections({ ...a, tabletopProtocol: P11, hashes: [...dmHashes, ...bHashes] });
    assert.deepEqual(stolen.sections, {}, "nothing is served");
    assert.equal(stolen.missing.length, new Set([...dmHashes, ...bHashes]).size);
  }
  // Seat checks are exactly a room read's.
  const hashes = (await read(a)).viewSections.entries.map((e) => e.h);
  await assert.rejects(readViewSections({ ...a, token: "not-a-seat", tabletopProtocol: P11, hashes }), /not seated/);
  await assert.rejects(readViewSections({ code: "NOPE", token: a.token, tabletopProtocol: P11, hashes }), /No table/);
  await assert.rejects(readViewSections({ ...a, tabletopProtocol: 10, hashes }), /Reload/);
  await assert.rejects(readViewSections({ ...a, tabletopProtocol: P11, hashes: ["../etc"] }), /Invalid/);
});

test("after a change only the changed sections are transferred", async () => {
  clearViewSectionCacheForTests();
  const { dm, a } = await campaign();
  const first = await read(a);
  const texts = await complete(a, first);
  const have = [...texts.keys()];
  // Unchanged room: a full read with everything held carries no section text.
  assert.deepEqual((await read(a, have)).viewSections.data, {});
  // The DM posts one party line: the next view carries only the last chat chunk.
  await submitCommands({ ...dm, batchId: "line", commands: [{ id: "line-1", kind: "message", to: "party", purseId: "", text: "A new party line" }] });
  const next = await pollRoom({ ...a, tabletopProtocol: P11, knownRevision: first.revision, knownSeatId: first.seatId });
  const changed = await roomViewResponse(next, { tabletopProtocol: P11, viewSections: have });
  const sent = Object.keys(changed.viewSections.data);
  const notes = changed.viewSections.entries.filter((e) => e.p.join(".") === "notes");
  assert.equal(sent.length, 1, "one section is sent");
  assert.equal(sent[0], notes.at(-1).h, "the last chat chunk");
  const sentChars = Object.values(changed.viewSections.data).join("").length;
  const fullChars = JSON.stringify((await roomViewResponse(await roomState(a), { tabletopProtocol: 10 })).table).length;
  assert.ok(sentChars * 5 < fullChars, `${sentChars} of ${fullChars} characters sent`);
  for (const [hash, text] of Object.entries(changed.viewSections.data)) texts.set(hash, text);
  const table = assembleViewTable(changed.table, changed.viewSections.entries, texts);
  assert.ok(table.notes.some((n) => n.id === "line-1"));
});

test("the client cache: assembled views, only missing sections fetched, cleared on seat or campaign change", async () => {
  clearViewSectionCacheForTests();
  const { dm, a, b } = await campaign();
  const fetched = [];
  const sync = createRoomSync({
    readSections: async ({ data }) => {
      fetched.push(...data.hashes);
      return readViewSections(data);
    },
    fullRead: async ({ data }) => roomViewResponse(await roomState(data), data),
  });
  // As for a campaign larger than the inline budget: the response carries no section text.
  const withheld = (response) => (response.viewSections ? { ...response, viewSections: { ...response.viewSections, data: {} } } : response);
  const pull = sync.roomRead(async ({ data }) => withheld(await roomViewResponse(await roomState(data), data)));
  const poll = sync.roomRead(async ({ data }) => {
    const result = await pollRoom(data);
    return "table" in result ? roomViewResponse(result, data) : result;
  });
  const progress = [];
  const stop = subscribeRoomLoading(() => progress.push(getRoomLoading()));
  const view = await pull({ data: { ...a, tabletopProtocol: P11 } });
  stop();
  assert.equal(view.viewSections, undefined, "callers receive a complete view");
  const full = await roomViewResponse(await roomState(a), { tabletopProtocol: 10 });
  assert.deepEqual(view.table, full.table);
  assert.ok(fetched.length > 0, "sections beyond the inline budget are fetched");
  assert.ok(progress.some((p) => p && p.loadedBytes > 0) && progress.at(-1) === null, "loading progress is reported, then cleared");
  const aHashes = sync.viewSectionCacheForTests().hashes;
  assert.ok(aHashes.length > 0);
  // A second read fetches nothing; an unchanged poll is passed through.
  fetched.length = 0;
  await pull({ data: { ...a, tabletopProtocol: P11 } });
  assert.equal(fetched.length, 0);
  const unchanged = await poll({ data: { ...a, tabletopProtocol: P11, knownRevision: view.revision, knownSeatId: view.seatId } });
  assert.equal(unchanged.unchanged, true);
  // Another seat (or campaign) replaces the cache: nothing of seat A is kept or sent.
  await pull({ data: { ...b, tabletopProtocol: P11 } });
  assert.ok(!sync.viewSectionCacheForTests().key.includes(a.token));
  const bHeld = new Set(sync.viewSectionCacheForTests().hashes);
  assert.equal(aHashes.filter((h) => bHeld.has(h)).length, 0, "no section of seat A is held for seat B");
  assert.deepEqual(sync.heldSections(a), [], "seat A starts empty again");
  await pull({ data: { ...dm, tabletopProtocol: P11 } });
  assert.equal(sync.heldSections(b).length, 0);
  sync.clearViewSectionCache();
  assert.deepEqual(sync.viewSectionCacheForTests(), { key: "", hashes: [] });
  // Protocol 10 callers bypass sync entirely.
  const legacy = await sync.roomRead(async ({ data }) => roomViewResponse(await roomState(data), data))({ data: { ...a, tabletopProtocol: 10 } });
  assert.deepEqual(legacy.table, full.table);
});

test("a room that changes while sections load is read again; the result is consistent", async () => {
  clearViewSectionCacheForTests();
  const { dm, a } = await campaign();
  let raced = 0;
  const sync = createRoomSync({
    readSections: async ({ data }) => {
      if (raced++ === 0)
        await submitCommands({ ...dm, batchId: "race", commands: [{ id: "race-1", kind: "message", to: "party", purseId: "", text: "Racing line" }] });
      return readViewSections(data);
    },
    fullRead: async ({ data }) => roomViewResponse(await roomState(data), data),
  });
  // Make the first view fetch: hold nothing and use a response whose inline data is withheld.
  const pull = sync.roomRead(async ({ data }) => {
    const response = await roomViewResponse(await roomState(data), data);
    return response.viewSections ? { ...response, viewSections: { ...response.viewSections, data: {} } } : response;
  });
  const view = await pull({ data: { ...a, tabletopProtocol: P11 } });
  const full = await roomViewResponse(await roomState(a), { tabletopProtocol: 10 });
  assert.equal(view.revision, full.revision);
  assert.deepEqual(view.table, full.table);
  assert.ok(view.table.notes.some((n) => n.id === "race-1"));
});
