// Split the party screens (phase 2): what the Groups panel, merge dialog and player card show,
// and the Here sheet and place cards following the viewer's group.
import "./commands.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { projectRecord } from "./session-records.ts";
import { hereSheet, partyAt, mapServiceAllowed } from "./place-hub.ts";
import { partyGroupsFingerprint } from "./party-groups.ts";
import { characterPosition } from "./character-position.ts";
import { awayFromParty, groupSummaries, groupWhere, mergeBlock, outerPlace, placeLabel, playerGroupView } from "./party-groups-ui.ts";
import { alex, dm, partyFixture, run, sam, splitFixture } from "./test-fixtures/party-groups.ts";

const rows = (sheet: ReturnType<typeof hereSheet>) =>
  sheet.mode === "here" ? sheet.rows.map((r) => r.reference.id).sort() : [];

test("summaries: names, letters, places, members (hidden ones for the DM only) and shops", () => {
  const t = splitFixture();
  const forDm = groupSummaries(t, dm);
  assert.deepEqual(
    forDm.map((g) => [g.ref, g.name, g.letter, g.colour, g.where]),
    [
      ["main", "Harbour watch", "A", "green", "Saltmarsh · Harbour ward"],
      ["riders", "Ironhold riders", "B", "blue", "Ironhold"],
    ],
  );
  assert.deepEqual(forDm[1]!.members.map((p) => p.id).sort(), ["kettle", "maud", "tamsin"]);
  assert.equal(forDm[1]!.hiddenMembers, 1);
  assert.equal(forDm[0]!.shops, 1);
  assert.equal(forDm[1]!.shops, 1);
  const forSam = groupSummaries(projectRecord(t, sam), sam);
  assert.equal(forSam[1]!.members.some((p) => p.id === "maud"), false);
  assert.equal(forSam[1]!.hiddenMembers, 0);
  assert.equal(placeLabel(t, "undercroft"), "Ironhold · The Undercroft");
});

test("player view: their group first; a hidden group reads Elsewhere", () => {
  let t = splitFixture();
  t = run(t, { kind: "party-group-edit", before: partyGroupsFingerprint(t), groupId: "riders", name: "Ironhold riders", colour: "blue", hidden: true } as never);
  const forSam = projectRecord(t, sam);
  const view = playerGroupView(forSam, sam);
  assert.deepEqual(view.mine.map((g) => g.ref), ["main"]);
  assert.equal(view.others[0]!.where, "Elsewhere");
  assert.equal(groupWhere(projectRecord(t, alex), "riders"), "Ironhold");
  assert.deepEqual(playerGroupView(projectRecord(t, alex), alex).mine.map((g) => g.ref), ["riders"]);
});

test("merge readiness mirrors the engine", () => {
  let t = splitFixture();
  assert.match(mergeBlock(t, ["main", "riders"]), /same place. Harbour watch is at Saltmarsh · Harbour ward; Ironhold riders is at Ironhold/);
  t = run(t, { kind: "party-location", before: "harbour", locationId: "ironhold" } as never);
  t = run(t, { kind: "party-location", groupId: "riders", before: "ironhold", locationId: "undercroft" } as never);
  assert.equal(mergeBlock(t, ["main", "riders"]), "");
  assert.equal(outerPlace(t, ["riders", "main"]), "ironhold");
  const pending = run(t, { kind: "downtime-plan", name: "Rest", days: 1 } as never);
  assert.match(mergeBlock(pending, ["main", "riders"]), /pending downtime/);
});

test("away from the party lists downtime and own-position characters, not location NPCs", () => {
  let t = splitFixture();
  t = run(t, {
    kind: "character-downtime-start",
    purseId: "kettle",
    before: characterPosition(t, t.purses.find((p) => p.id === "kettle")!),
    name: "Tracking",
    days: 2,
    locationId: null,
  } as never);
  assert.deepEqual(awayFromParty(t).map((p) => p.id), ["kettle"]);
});

test("the Here sheet shows the viewer's group's place; place cards say which group is here", () => {
  const t = splitFixture();
  const samSheet = hereSheet(projectRecord(t, sam), { ...sam, shopIds: undefined });
  const alexSheet = hereSheet(projectRecord(t, alex), { ...alex, shopIds: undefined });
  assert.equal(samSheet.mode === "here" && samSheet.locationName, "Harbour ward");
  assert.equal(alexSheet.mode === "here" && alexSheet.locationName, "Ironhold");
  assert.ok(rows(samSheet).includes("chandlery"));
  assert.ok(!rows(samSheet).includes("armoury"));
  assert.ok(rows(alexSheet).includes("armoury"));
  assert.ok(rows(alexSheet).includes("durra"));
  assert.ok(!rows(alexSheet).includes("chandlery"));
  // The DM sees each group's sheet on request (main by default, as before).
  assert.equal((hereSheet(t, dm) as { locationName: string }).locationName, "Harbour ward");
  assert.equal((hereSheet(t, dm, undefined, "riders") as { locationName: string }).locationName, "Ironhold");
  assert.equal(partyAt(t, "ironhold"), false);
  assert.equal(partyAt(t, "ironhold", ["riders"]), true);
  assert.equal(mapServiceAllowed(projectRecord(t, alex), { kind: "shop", id: "armoury" }, alex), true);
  assert.equal(mapServiceAllowed(projectRecord(t, sam), { kind: "npc", id: "durra" }, sam), false);
});

test("a whole party's Here sheet is unchanged", () => {
  const t = partyFixture();
  assert.deepEqual(rows(hereSheet(projectRecord(t, sam), sam)), ["chandlery", "garrick", "ilse", "shed"]);
  assert.equal(partyAt(t, "saltmarsh"), true);
});
