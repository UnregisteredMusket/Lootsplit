import test from "node:test";
import assert from "node:assert/strict";
import { emptyCloudTable, readCloudTable, type CloudTable, type CloudSeat } from "./cloud.ts";
import { applyCommand, type CommandInput } from "./commands.ts";
import { readJournal, preserveJournalMetadata } from "./journal.ts";
import { fromCopper } from "./money.ts";
import { blankSheet } from "../characters/model.mjs";
import { readDowntimeActivities } from "./downtime-activities-schema.ts";
import {
  downtimeRemaining,
  trainingCounters,
  previewActivityWindow,
} from "./downtime-activities.ts";
import { projectRecord } from "./session-records.ts";
const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = {
  id: "player",
  token: "",
  name: "Player",
  role: "player",
  purseIds: ["hero"],
};
let serial = 0;
const act = (t: CloudTable, cmd: CommandInput, seat = dm) =>
  applyCommand(t, seat, { ...cmd, id: `hours-${++serial}` });
function fixture(withSheet = true): CloudTable {
  const hero = { ...blankSheet(), name: "Hero", level: 5, classes: "Fighter 5" };
  const npc = { ...blankSheet(), name: "Pupil", level: 3, classes: "Fighter 3" };
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hero", name: "Hero", kind: "character", coins: fromCopper(10000), sheet: hero },
      { id: "other", name: "Other", kind: "character", coins: fromCopper(20000) },
      {
        id: "npc",
        name: "Pupil",
        kind: "character",
        control: "npc",
        coins: fromCopper(3000),
        ...(withSheet ? { sheet: npc } : {}),
      },
      { id: "party", name: "Party", kind: "party", coins: fromCopper(4000) },
    ],
    journal: readJournal(undefined),
  };
}
function advance(t: CloudTable, days = 1) {
  t = act(t, { kind: "downtime-plan", days, name: "Training break" });
  return act(t, {
    kind: "downtime-apply",
    downtimeId: t.journal!.finance!.downtime.at(-1)!.id,
    endSession: false,
  });
}
function propose(
  t: CloudTable,
  hours = 8,
  category: "martial" | "academic" | "profession" = "martial",
  className = "",
) {
  return act(
    t,
    {
      kind: "downtime-training",
      windowId: t.journal!.downtimeActivities!.windows.at(-1)!.id,
      trainerId: "hero",
      npcId: "npc",
      category,
      topic: "Drills",
      description: "Practice together",
      className,
      minutes: hours * 60,
    },
    player,
  );
}
function decide(t: CloudTable, approve = true, note = "") {
  const r = t.journal!.downtimeActivities!.requests.at(-1)!;
  return act(t, { kind: "downtime-training-review", requestId: r.id, before: r, approve, note });
}
test("approved days create individual 16-hour resources; categories share one budget and training changes no characters", () => {
  let t = advance(fixture(), 2);
  const before = structuredClone({
    purses: t.purses,
    holdings: t.holdings,
    sheets: t.sheets,
    ledger: t.ledger,
  });
  const state = () => t.journal!.downtimeActivities!,
    window = state().windows[0].id;
  assert.equal(downtimeRemaining(state(), window, "hero"), 32 * 60);
  assert.equal(
    state().windows[0].budgets.some((b) => b.purseId === "party"),
    false,
  );
  t = decide(propose(t, 8));
  t = decide(propose(t, 12, "academic"));
  t = decide(propose(t, 12, "profession"));
  assert.equal(downtimeRemaining(state(), window, "hero"), 0);
  assert.equal(downtimeRemaining(state(), window, "npc"), 0);
  assert.throws(() => propose(t, 1), /Insufficient/);
  assert.deepEqual(
    { purses: t.purses, holdings: t.holdings, sheets: t.sheets, ledger: t.ledger },
    before,
  );
  assert.equal(
    trainingCounters(state()).reduce((n, c) => n + c.lifetimeDays, 0),
    4,
  );
});
test("requests reserve both participants' hours; rejection and cancellation release only pending reservations", () => {
  let t = propose(advance(fixture()), 12);
  const state = () => t.journal!.downtimeActivities!,
    w = state().windows[0].id;
  assert.equal(downtimeRemaining(state(), w, "hero"), 960);
  assert.equal(downtimeRemaining(state(), w, "hero", true), 240);
  assert.throws(() => propose(t, 8, "academic"), /Insufficient/);
  t = decide(t, false, "Not feasible here");
  assert.equal(downtimeRemaining(state(), w, "hero", true), 960);
  t = propose(t, 4);
  const r = state().requests.at(-1)!;
  t = act(t, { kind: "downtime-training-cancel", requestId: r.id, before: r }, player);
  assert.equal(downtimeRemaining(state(), w, "hero", true), 960);
  assert.equal(trainingCounters(state()).length, 0);
});
test("no-sheet training requires an explicit DM level confirmation and never creates a sheet", () => {
  let t = propose(advance(fixture(false)));
  assert.throws(() => decide(t), /DM confirmation/);
  t = decide(t, true, "NPC is level 3, below the level 5 trainer; conditions and time confirmed.");
  assert.equal(t.purses.find((p) => p.id === "npc")!.sheet, undefined);
  assert.equal(trainingCounters(t.journal!.downtimeActivities!)[0].currentMinutes, 480);
});
test("character/class level and physical presence are rechecked on approval, including class data requiring manual review", () => {
  let t = advance(fixture());
  t.purses.find((p) => p.id === "npc")!.sheet!.level = 6;
  assert.throws(() => propose(t), /character level exceeds/);
  t.purses.find((p) => p.id === "npc")!.sheet!.level = 3;
  t.purses.find((p) => p.id === "npc")!.sheet!.classes = "Fighter 6";
  assert.throws(() => propose(t, 8, "martial", "Fighter"), /class level exceeds/);
  t.purses.find((p) => p.id === "npc")!.sheet!.classes = "Fighter 3";
  t = propose(t, 8, "martial", "Fighter");
  t.purses.find((p) => p.id === "npc")!.sheet!.level = 6;
  assert.throws(() => decide(t, true, "Confirmed"), /character level exceeds/);
  t.purses.find((p) => p.id === "npc")!.sheet!.level = 3;
  t = decide(t);
  t = propose(t, 8, "academic", "Wizard");
  assert.throws(() => decide(t), /DM confirmation/);
});
test("DM reset acts as a trip meter, retains lifetime/category totals and never refunds used hours", () => {
  let t = decide(propose(advance(fixture()), 8));
  const before = structuredClone(t.purses),
    g = trainingCounters(t.journal!.downtimeActivities!)[0];
  const reset: CommandInput = {
    kind: "downtime-training-reset",
    trainerId: "hero",
    npcId: "npc",
    category: "martial",
    topic: "Drills",
    before: g.requestIds,
    note: "Milestone: proficiency applied manually by DM.",
  };
  assert.throws(() => act(t, reset, player), /Only the DM/);
  t = act(t, reset);
  assert.deepEqual(t.purses, before);
  assert.equal(
    downtimeRemaining(
      t.journal!.downtimeActivities!,
      t.journal!.downtimeActivities!.windows[0].id,
      "hero",
    ),
    480,
  );
  assert.equal(trainingCounters(t.journal!.downtimeActivities!)[0].currentMinutes, 0);
  assert.equal(trainingCounters(t.journal!.downtimeActivities!)[0].lifetimeMinutes, 480);
  assert.throws(() => act(t, reset), /progress changed/);
  t = decide(propose(t, 4));
  const after = trainingCounters(t.journal!.downtimeActivities!)[0];
  assert.equal(after.currentMinutes, 240);
  assert.equal(after.lifetimeMinutes, 720);
});
test("settings preserve historic budgets and per-entry training-day conversions", () => {
  let t = decide(propose(advance(fixture()), 8));
  const old = t.journal!.downtimeActivities!;
  t = act(t, {
    kind: "downtime-settings",
    before: old.settings,
    settings: { hoursPerDay: 12, trainingHoursPerDay: 6 },
  });
  t = decide(propose(advance(t), 6));
  const s = t.journal!.downtimeActivities!;
  assert.equal(s.windows[0].budgets[0].totalMinutes, 960);
  assert.equal(s.windows[1].budgets[0].totalMinutes, 720);
  const c = trainingCounters(s)[0];
  assert.equal(c.lifetimeMinutes, 840);
  assert.equal(c.lifetimeDays, 2);
});
test("role, stale decision, pending-preview and repeat-settlement boundaries cannot be bypassed", () => {
  let t = propose(advance(fixture()));
  const r = t.journal!.downtimeActivities!.requests[0];
  const review: CommandInput = {
    kind: "downtime-training-review",
    requestId: r.id,
    before: r,
    approve: true,
    note: "",
  };
  assert.throws(() => act(t, review, player), /Only the DM/);
  assert.throws(() => act(t, { ...review, before: { ...r, minutes: 1 } }), /changed/);
  assert.throws(
    () =>
      act(
        t,
        {
          kind: "downtime-training",
          windowId: r.windowId,
          trainerId: "other",
          npcId: "npc",
          category: "martial",
          topic: "Drills",
          description: "",
          className: "",
          minutes: 60,
        },
        player,
      ),
    /assigned/,
  );
  t = act(t, review);
  assert.throws(() => act(t, review), /already been decided/);
  t = act(t, { kind: "downtime-plan", days: 1, name: "Pending" });
  assert.throws(() => propose(t, 1), /preview/);
  const receipt = t.journal!.finance!.downtime.at(-1)!;
  t = act(t, { kind: "downtime-apply", downtimeId: receipt.id, endSession: false });
  assert.throws(
    () => act(t, { kind: "downtime-apply", downtimeId: receipt.id, endSession: false }),
    /already been decided/,
  );
});
test("budget quotes account for property labor and away activity while voyage passengers retain hours", () => {
  const t = fixture();
  const p = previewActivityWindow(t, 2, [{ purseId: "hero", days: 0.5 }]);
  assert.equal(p.window.budgets.find((b) => b.purseId === "hero")!.committedMinutes, 480);
  assert.equal(p.window.budgets.find((b) => b.purseId === "npc")!.committedMinutes, 0);
  // A ship voyage is absent from resource consumption; only actual worker allocations consume time.
  t.journal!.fleet = {
    vessels: [],
    facilities: [],
    aboard: [{ purseId: "hero", propertyId: "ship", returnInParty: true }],
    voyages: [],
    boarding: [],
    work: [],
  };
  assert.equal(
    previewActivityWindow(t, 2).window.budgets.find((b) => b.purseId === "hero")!.committedMinutes,
    0,
  );
});
test("legacy journal replacements and backups retain tracking, and players see only their own allocations", () => {
  const t = decide(propose(advance(fixture()), 8));
  const retained = preserveJournalMetadata({}, t.journal!);
  assert.deepEqual(retained.downtimeActivities, t.journal!.downtimeActivities);
  assert.ok(readCloudTable(t));
  const projected = projectRecord(t, player).journal!.downtimeActivities!;
  assert.deepEqual(
    projected.windows[0].budgets.map((b) => b.purseId),
    ["hero"],
  );
  assert.equal(projected.requests.length, 1);
  const other = projectRecord(t, { ...player, purseIds: ["other"] }).journal!.downtimeActivities!;
  assert.equal(other.requests.length, 0);
  assert.equal(other.resets.length, 0);
  assert.deepEqual(readDowntimeActivities().settings, { hoursPerDay: 16, trainingHoursPerDay: 8 });
});
test("client preview retains private NPC budgets while the authoritative decision rejects exhausted recipients", () => {
  const t = advance(fixture());
  const w = t.journal!.downtimeActivities!.windows[0];
  // This NPC has committed the whole period to another reviewed activity.
  w.budgets.find((b) => b.purseId === "npc")!.committedMinutes = 960;
  const projected = projectRecord(t, player);
  // A visible NPC is usually retained through the world directory. Keep that
  // synthetic visible identity here without exposing its sheet or time budget.
  projected.purses.push({ ...t.purses.find((p) => p.id === "npc")!, sheet: undefined });
  const request = {
    id: "private-budget-preview",
    kind: "downtime-training" as const,
    windowId: w.id,
    trainerId: "hero",
    npcId: "npc",
    category: "martial" as const,
    topic: "Drills",
    description: "",
    className: "",
    minutes: 60,
  };
  const preview = applyCommand(projected, player, request, { preview: true });
  assert.equal(preview.journal!.downtimeActivities!.requests[0].status, "pending");
  assert.throws(() => applyCommand(t, player, request), /Insufficient/);
});
test("an older saved pending finance quote can be approved without losing the new resource or original finances", () => {
  let t = act(fixture(), { kind: "downtime-plan", days: 1, name: "Old-client pending plan" });
  const d = t.journal!.finance!.downtime[0];
  delete d.quote.downtimeActivities;
  t = act(t, { kind: "downtime-apply", downtimeId: d.id, endSession: false });
  assert.equal(t.journal!.downtimeActivities!.windows.length, 1);
  assert.equal(t.journal!.finance!.day, 1);
});
