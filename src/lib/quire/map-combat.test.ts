import assert from "node:assert/strict";
import test from "node:test";
import { finishMapEncounter } from "../encounters/map-transition.ts";
import { mapCombatBindingSchema } from "./map-combat-schema.ts";
import { projectMapCombat } from "./map-combat.ts";
import { emptyCloudTable, type CloudSeat } from "./cloud.ts";
import { campaignMapSchema } from "./world-schema.ts";
import { applyCommand } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { projectRecord } from "./session-records.ts";
import { tableForProtocol } from "./tabletop-protocol.ts";
const binding = mapCombatBindingSchema.parse({
  id: "transition",
  encounterId: "encounter",
  encounterRevision: 0,
  mapId: "battle",
  returnMapId: "town",
  returnCamera: { x: 0.4, y: 0.3, zoom: 2 },
  mode: "theatre",
  phase: "prepared",
  showPlayers: true,
  scaleConfirmed: false,
});
const dm: CloudSeat = { id: "dm", name: "DM", token: "dm", role: "dm", purseIds: [] },
  player: CloudSeat = { ...dm, id: "player", role: "player" };
const map = (id: string) =>
  campaignMapSchema.parse({
    id,
    name: id,
    locationId: null,
    image: "data:image/png;base64,YQ==",
    visible: true,
    anchors: [],
    markers: [],
  });
const fixture = () => ({
  ...emptyCloudTable(),
  journal: readJournal({ world: { maps: [map("town"), map("battle")] } }),
});
test("lost start response and failed activation recover the same encounter once", async () => {
  let starts = 0,
    activations = 0;
  const row = {
    id: "encounter",
    code: "device",
    revision: 0,
    status: "draft",
    body: { name: "Private", round: 1, activeId: "secret" },
  };
  const ops = {
    read: async () => ({ ...row }),
    start: async () => {
      starts++;
      row.status = "active";
      row.revision++;
      throw Error("lost response");
    },
    activate: async () => {
      activations++;
      if (activations === 1) throw Error("activation failed");
    },
    guard: () => {},
  };
  await assert.rejects(finishMapEncounter(binding, "device", ops), /activation failed/);
  await finishMapEncounter(binding, "device", ops);
  assert.equal(starts, 1);
  assert.equal(activations, 2);
});
test("changed drafts and foreign campaigns cannot start or activate through a stale transition", async () => {
  let actions = 0;
  const row = {
      id: "encounter",
      code: "other",
      revision: 0,
      status: "draft",
      body: { name: "Private", round: 0, activeId: "" },
    },
    ops = {
      read: async () => row,
      start: async () => {
        actions++;
      },
      activate: async () => {
        actions++;
      },
      guard: () => {},
    };
  await assert.rejects(finishMapEncounter(binding, "device", ops), /current campaign/);
  row.code = "device";
  row.revision = 2;
  await assert.rejects(finishMapEncounter(binding, "device", ops), /changed after review/);
  assert.equal(actions, 0);
});
test("prepared bindings persist, share only presentation, and return without economic or encounter side effects", () => {
  const t = fixture(),
    prepare = {
      id: "prepare",
      kind: "map-combat-transition" as const,
      before: null,
      binding,
      beforeSession: null,
    };
  assert.throws(() => applyCommand(t, player, prepare), /DM|Dungeon Master/i);
  const prepared = applyCommand(t, dm, prepare);
  assert.deepEqual(prepared.journal!.world!.combat, binding);
  assert.equal(prepared.journal!.world!.tabletop, undefined);
  assert.throws(
    () =>
      applyCommand(prepared, dm, {
        id: "remove-return",
        kind: "map-save",
        mapId: "town",
        before: prepared.journal!.world!.maps[0],
        map: null,
      }),
    /Return from/,
  );
  const active = applyCommand(prepared, dm, {
      ...prepare,
      id: "activate",
      before: binding,
      binding: { ...binding, phase: "active" },
    }),
    world = active.journal!.world!;
  assert.equal(world.tabletop!.activeMapId, "battle");
  const shared = projectRecord(active, player);
  assert.equal(shared.journal!.world!.combat, undefined);
  assert.deepEqual(shared.journal!.world!.tabletop!.presentation, {
    id: "transition",
    mapId: "battle",
    mode: "theatre",
  });
  for (const protocol of [0, 1]) {
    const old = tableForProtocol(active, protocol);
    assert.equal(old.journal!.world!.combat, undefined);
    assert.equal(old.journal!.world!.tabletop?.presentation, undefined);
  }
  const returned = applyCommand(active, dm, {
    id: "return",
    kind: "map-combat-transition",
    before: world.combat!,
    binding: null,
    beforeSession: world.tabletop!,
  });
  assert.equal(returned.journal!.world!.combat, undefined);
  assert.equal(returned.journal!.world!.tabletop!.activeMapId, "town");
  assert.deepEqual(returned.ledger, t.ledger);
  assert.deepEqual(returned.holdings, t.holdings);
  assert.equal(returned.journal!.market, t.journal.market);
});
test("HUD shares only a revealed projected token identity, round and lifecycle", () => {
  const battle = map("battle");
  battle.tokens = [
    {
      id: "visible",
      kind: "creature",
      label: "Known scout",
      encounterId: "encounter",
      combatantId: "one",
      column: 0,
      row: 0,
      visibility: "party",
    },
    {
      id: "hidden",
      kind: "creature",
      label: "Secret dragon",
      encounterId: "encounter",
      combatantId: "two",
      column: 1,
      row: 0,
      visibility: "dm",
    },
  ];
  const privateRow = {
    status: "active",
    body: { round: 2, activeId: "two", notes: "Private tactics", hp: 99, loot: "Secret artifact" },
  };
  assert.deepEqual(projectMapCombat(battle, "encounter", privateRow), {
    mapId: "battle",
    status: "active",
    round: 2,
  });
  privateRow.body.activeId = "one";
  assert.equal(projectMapCombat(battle, "encounter", privateRow).activeTokenId, "visible");
  battle.tokens = [];
  assert.equal(projectMapCombat(battle, "encounter", privateRow).activeTokenId, undefined);
});
