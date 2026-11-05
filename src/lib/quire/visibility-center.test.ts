// "What players can see" (visibility-center.ts): the page's switches send exactly the command
// their original control sends (same builder, same `before` check), players can't reach the page,
// and the hidden counts are right on a fixture. Disposable in-memory data only.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type Command, type CommandInput } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { projectRecord } from "./session-records.ts";
import { fromCopper } from "./money.ts";
import { readWorld } from "./world-schema.ts";
import { referencePolicy } from "./reference-access.ts";
import { featureScreens, safeReturn } from "./feature-navigation.ts";
import { paletteActions, paletteScreens } from "./command-palette.ts";
import {
  blackMarketCommand,
  companionFundsCommand,
  markupDisplayCommand,
  previewCharacters,
  readSession,
  referencePolicyCommand,
  sessionSwitchCommand,
  visibilityCenter,
  type VisibilityArea,
} from "./visibility-center.ts";

const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const aria: CloudSeat = { id: "a", token: "", name: "Aria", role: "player", purseIds: ["aria"] };
const image = "data:image/png;base64,AAAA";
let n = 0;
const run = (t: CloudTable, input: CommandInput, seat = dm) =>
  applyCommand(t, seat, { ...input, id: `vis-${++n}` } as Command);

export function fixture(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "aria", name: "Aria Thorne", kind: "character", coins: fromCopper(1000) },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: fromCopper(1000) },
      { id: "spy", name: "The Spy", kind: "character", control: "npc", nonParty: true, coins: fromCopper(77) },
      { id: "guide", name: "Guide", kind: "character", control: "npc", nonParty: true, coins: fromCopper(5) },
    ],
    holdings: [
      { id: "rope", purseId: "aria", name: "Rope", kind: "item", quantity: 1, unitCopper: 10, notes: "" },
      {
        id: "orb",
        purseId: "aria",
        name: "Orb of Doom",
        kind: "item",
        quantity: 1,
        unitCopper: 99999,
        notes: "",
        unidentified: { name: "Glass ball" },
      },
    ] as CloudTable["holdings"],
    shops: [
      { id: "bm", name: "Back room", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "general", priceScale: 1, blackMarket: true },
      { id: "inn", name: "Inn", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "general", priceScale: 1, merchantPurse: 500 },
      { id: "fair", name: "Fair", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "general", priceScale: 1, merchantPurse: 500, showPurse: true },
    ] as CloudTable["shops"],
    journal: readJournal({
      market: {
        currentLocationId: "town",
        locations: [
          { id: "vale", name: "Vale", kind: "region", parentId: null, description: "" },
          { id: "town", name: "Harrowgate", kind: "town", parentId: "vale", description: "" },
        ],
      },
      entries: [
        { id: "e1", at: 1, authorId: "dm", purseId: "", visibility: "dm", title: "Plot", text: "The duke did it", reportIds: [] },
        { id: "e2", at: 2, authorId: "dm", purseId: "", visibility: "party", title: "Arrival", text: "", reportIds: [] },
      ],
      quests: {
        quests: [
          { id: "q1", title: "Draft", status: "active", audience: { kind: "none" }, summary: "", createdAt: 1, updatedAt: 1, revision: 0, log: [{ id: "l1", text: "secret", shared: false, at: 1 }] },
          {
            id: "q2",
            title: "Open",
            status: "active",
            audience: { kind: "party" },
            summary: "",
            createdAt: 1,
            updatedAt: 1,
            revision: 0,
            objectives: [
              { id: "o1", text: "Seen", state: "open" },
              { id: "o2", text: "Unseen", state: "open", hidden: true },
              { id: "o3", text: "Also unseen", state: "open", hidden: true },
            ],
            log: [{ id: "l2", text: "shared", shared: true, at: 1 }],
          },
        ],
      },
      world: {
        characterPositions: [
          { purseId: "bram", inParty: true, locationId: null, visible: false, sheetVisible: true },
          { purseId: "guide", inParty: false, locationId: "town", visible: true, sheetVisible: false },
        ],
        npcs: [
          { id: "spy", name: "The Spy", description: "", locationId: "town", visible: false, barterAllowed: false, controllerPurseId: null },
          { id: "guide", name: "Guide", description: "", locationId: "town", visible: true, barterAllowed: false, controllerPurseId: null },
        ],
        maps: [
          {
            id: "open",
            name: "Town map",
            image,
            locationId: "town",
            visible: true,
            anchors: [],
            markers: [
              { id: "m1", label: "Lair", description: "", x: 0.1, y: 0.1, visibility: "dm" },
              { id: "m2", label: "Gate", description: "", x: 0.2, y: 0.2, visibility: "party" },
            ],
            connected: {
              links: [{ id: "s1", targetMapId: "vault", label: "Down", x: 0.3, y: 0.3, visibility: "dm" }],
              placements: [
                { id: "p1", record: { kind: "npc", id: "guide" }, x: 0.4, y: 0.4, visibility: "party", style: "portrait" },
                { id: "p2", record: { kind: "npc", id: "spy" }, x: 0.5, y: 0.5, visibility: "dm" },
              ],
            },
          },
          { id: "vault", name: "DM vault", image, locationId: null, visible: false, anchors: [], markers: [] },
        ],
      },
    }),
  };
}

const count = (areas: VisibilityArea[], id: string) =>
  areas.flatMap((a) => a.counts).find((c) => c.id === id)?.count;
const toggle = (areas: VisibilityArea[], id: string) =>
  areas.flatMap((a) => a.switches).find((s) => s.id === id)!;

test("builders: each sends the command its original control sent, with the same before", () => {
  const t = fixture();
  const world = readWorld(t.journal!.world);
  // The literal each original control built before this change (black-market.tsx,
  // location-npcs.tsx, map-follow-view.tsx, map-session-bar.tsx, reference-controls.tsx).
  assert.deepEqual(blackMarketCommand(t.journal), { kind: "black-market", before: false, active: true });
  assert.deepEqual(markupDisplayCommand(t.journal), { kind: "black-market-markup", before: "descriptions", display: "percentages" });
  assert.deepEqual(companionFundsCommand(t.journal), {
    kind: "companion-funds-visibility",
    before: world.companionFundsVisible ?? false,
    visible: !world.companionFundsVisible,
  });
  const session = readSession(t.journal);
  for (const key of ["followView", "playerBrowsing", "tvEnabled"] as const)
    assert.deepEqual(sessionSwitchCommand(t.journal, key), {
      kind: "tabletop-session",
      before: t.journal!.world?.tabletop ?? null,
      session: { ...session, [key]: !session[key] },
    });
  const policy = referencePolicy(t.journal!.referenceAccess);
  assert.deepEqual(referencePolicyCommand(t.journal, { enabled: false }), {
    kind: "reference-policy",
    before: policy,
    policy: { ...policy, enabled: false },
  });
});

test("the page's switches are those builders, and the originals use the same builders", () => {
  const t = fixture();
  const areas = visibilityCenter(t);
  assert.deepEqual(toggle(areas, "black-market").command, blackMarketCommand(t.journal));
  assert.deepEqual(toggle(areas, "black-market-markup").command, markupDisplayCommand(t.journal));
  assert.deepEqual(toggle(areas, "companion-funds").command, companionFundsCommand(t.journal));
  assert.deepEqual(toggle(areas, "follow-view").command, sessionSwitchCommand(t.journal, "followView"));
  assert.deepEqual(toggle(areas, "tv-display").command, sessionSwitchCommand(t.journal, "tvEnabled"));
  assert.deepEqual(toggle(areas, "reference-enabled").command, referencePolicyCommand(t.journal, { enabled: false }));
  assert.deepEqual(
    toggle(areas, "reference-encounters").command,
    referencePolicyCommand(t.journal, { allowDuringEncounters: true }),
  );
  // Restricting browsing applies only to an active scene, as in the map session bar.
  assert.equal(toggle(areas, "player-browsing").command, undefined);
  const active = run(t, { kind: "tabletop-session", before: null, session: { ...readSession(t.journal), activeMapId: "open" } });
  assert.deepEqual(
    toggle(visibilityCenter(active), "player-browsing").command,
    sessionSwitchCommand(active.journal, "playerBrowsing"),
  );
  const source = (f: string) => readFileSync(new URL(`../../components/${f}`, import.meta.url), "utf8");
  assert.match(source("black-market.tsx"), /input=\{blackMarketCommand\(journal\)\}/);
  assert.match(source("black-market.tsx"), /input=\{markupDisplayCommand\(journal\)\}/);
  assert.match(source("location-npcs.tsx"), /input=\{companionFundsCommand\(t\.journal\)\}/);
  assert.match(source("map-follow-view.tsx"), /sessionSwitchCommand\(table\.journal, "followView"\)/);
  assert.match(source("map-session-bar.tsx"), /sessionSwitchCommand\(table\.journal, "playerBrowsing"\)/);
  assert.match(source("map-session-bar.tsx"), /sessionSwitchCommand\(table\.journal, "tvEnabled"\)/);
  assert.match(source("reference-controls.tsx"), /referencePolicyCommand\(economy\.journal, change\)/);
});

test("shared engine: every switch flips its setting, a stale before is refused, players are refused", () => {
  let t = fixture();
  const ids = ["black-market", "black-market-markup", "companion-funds", "follow-view", "tv-display", "reference-enabled", "reference-encounters"];
  for (const id of ids) {
    const before = toggle(visibilityCenter(t), id);
    assert.throws(() => run(t, before.command!, aria), /Only the DM can/, `${id}: a player was allowed`);
    const next = run(t, before.command!);
    const after = toggle(visibilityCenter(next), id);
    assert.equal(after.on, !before.on, `${id} did not flip`);
    // The same command again (a new ID) carries the old `before`: refused, nothing changes.
    assert.throws(() => run(next, before.command!), /changed\. (Refresh|Review)/, `${id}: a stale before was accepted`);
    t = next;
  }
});

test("device: the switch runs the same command on the device with the same result", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(fixture());
  const input = toggle(visibilityCenter(fixture()), "black-market").command!;
  const shared = applyCommand(fixture(), dm, { ...input, id: "vis-device-1" } as Command);
  await executeLocalCommand({ ...input, id: "vis-device-1" });
  await executeLocalCommand({ ...input, id: "vis-device-1" });
  const local = await economySnapshot();
  assert.equal(readWorld(local.journal!.world).blackMarketActive, readWorld(shared.journal!.world).blackMarketActive);
  assert.equal(readWorld(local.journal!.world).blackMarketActive, true);
  assert.equal(local.journal!.events.filter((e) => e.id.startsWith("vis-device-1")).length, 1, "a retry applies once");
});

test("counts: every hidden record type is counted on the fixture", () => {
  const areas = visibilityCenter(fixture());
  const expected: Record<string, number> = {
    "hidden-characters": 1, // Bram
    "hidden-npcs": 1, // The Spy
    "private-npc-sheets": 2, // Guide (set) and The Spy (an away NPC defaults to private)
    "hidden-groups": 0,
    "black-market-vendors": 1,
    "hidden-merchant-purses": 1, // Inn (Fair shows its purse)
    "hidden-exchanges": 0,
    "private-maps": 1,
    "fogged-maps": 0,
    "dm-markers": 1,
    "dm-tokens": 0,
    "dm-pins": 2, // one pin, one scene link
    "portrait-pins": 1,
    "dm-templates": 0,
    "quest-drafts": 1,
    "hidden-objectives": 2,
    "dm-quest-lines": 1,
    "dm-journal": 1,
    unidentified: 1,
  };
  for (const [id, value] of Object.entries(expected)) assert.equal(count(areas, id), value, id);
  assert.deepEqual(previewCharacters(fixture()).map((c) => c.name), ["Aria Thorne", "Bram Ironfoot"]);
});

test("old data: an empty campaign lists every area with zero counts and default states", () => {
  const areas = visibilityCenter(emptyCloudTable());
  assert.ok(areas.flatMap((a) => a.counts).every((c) => c.count === 0));
  assert.equal(toggle(areas, "black-market").state, "Hidden");
  assert.equal(toggle(areas, "black-market-markup").state, "Descriptions");
  assert.equal(toggle(areas, "reference-enabled").state, "Allowed");
});

test("players: the page is DM-only and a player's projection carries no hidden records", () => {
  assert.equal(featureScreens.visibility.dm, true);
  assert.equal(safeReturn("/features/visibility"), "/features/visibility");
  assert.ok(!paletteScreens(false).some((e) => e.href === "/features/visibility"));
  assert.ok(!paletteActions(false, false).some((e) => e.href === "/features/visibility"));
  assert.ok(paletteScreens(true).some((e) => e.href === "/features/visibility"));
  assert.ok(paletteActions(true, false).some((e) => e.href === "/features/visibility"));
  const route = readFileSync(new URL("../../routes/features.$feature.tsx", import.meta.url), "utf8");
  assert.match(route, /screen\.dm && !dm\) \? \(\s*<p>This screen is available to the campaign DM\.<\/p>/);
  // The counts come only from the DM's full table: a player's own view holds none of them.
  const player = visibilityCenter(projectRecord(fixture(), aria));
  for (const id of ["hidden-npcs", "private-maps", "dm-markers", "dm-pins", "quest-drafts", "hidden-objectives", "dm-quest-lines", "dm-journal"])
    assert.equal(count(player, id), 0, `${id} reached a player's projection`);
});
