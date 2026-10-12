import type { CloudSeat, CloudTable } from "./cloud.ts";
import { canonicalJson } from "./canonical-json.ts";
import {
  characterLocation,
  characterPosition,
  characterVisible,
  campaignMinute,
} from "./character-position.ts";
import {
  readDowntimeActivities,
  type DowntimeActivities,
  type DowntimeActivityCommand,
  type TrainingRequest,
} from "./downtime-activities-schema.ts";

type Table = Pick<CloudTable, "purses" | "journal">;
export function trainingKey(
  r: Pick<TrainingRequest, "trainerId" | "npcId" | "category" | "topic">,
) {
  return canonicalJson([r.trainerId, r.npcId, r.category, r.topic]);
}
export function trainingCounters(state: DowntimeActivities) {
  const groups = new Map<
    string,
    {
      record: TrainingRequest;
      lifetimeMinutes: number;
      currentMinutes: number;
      lifetimeDays: number;
      currentDays: number;
      requestIds: string[];
    }
  >();
  for (const r of state.requests.filter((r) => r.status === "approved")) {
    const key = trainingKey(r),
      group = groups.get(key) ?? {
        record: r,
        lifetimeMinutes: 0,
        currentMinutes: 0,
        lifetimeDays: 0,
        currentDays: 0,
        requestIds: [],
      };
    group.lifetimeMinutes += r.minutes;
    group.lifetimeDays += r.minutes / (r.trainingHoursPerDay * 60);
    const reset = state.resets.some((x) => trainingKey(x) === key && x.requestIds.includes(r.id));
    if (!reset) {
      group.currentMinutes += r.minutes;
      group.currentDays += r.minutes / (r.trainingHoursPerDay * 60);
      group.requestIds.push(r.id);
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}
export function downtimeRemaining(
  state: DowntimeActivities,
  windowId: string,
  purseId: string,
  includePending = false,
  excludeRequestId?: string,
) {
  const b = state.windows
    .find((w) => w.id === windowId)
    ?.budgets.find((b) => b.purseId === purseId);
  if (!b) return 0;
  return (
    b.totalMinutes -
    b.committedMinutes -
    state.requests
      .filter(
        (r) =>
          r.id !== excludeRequestId &&
          r.windowId === windowId &&
          (r.trainerId === purseId || r.npcId === purseId) &&
          (r.status === "approved" || (includePending && r.status === "pending")),
      )
      .reduce((n, r) => n + r.minutes, 0)
  );
}
/** Same approved clock, separate per-character allocations. Voyages consume no personal hours. */
export function previewActivityWindow(
  t: Table,
  days: number,
  characterWorkDays: { purseId: string; days: number }[] = [],
) {
  const state = readDowntimeActivities(t.journal?.downtimeActivities),
    start = campaignMinute(t);
  const totalMinutes = days * state.settings.hoursPerDay * 60;
  return {
    before: canonicalJson({ settings: state.settings }),
    window: {
      id: "preview",
      name: "Downtime",
      fromDay: t.journal?.finance?.day ?? 0,
      days,
      settings: state.settings,
      budgets: t.purses
        .filter(
          (p) =>
            p.kind === "character" &&
            !t.journal?.tradeEconomy?.exchanges.some((e) => e.purseId === p.id),
        )
        .map((p) => {
          const away = characterPosition(t, p).downtime;
          const awayDays = away
            ? Math.max(0, Math.min(days, (away.finishMinute - start) / 1440))
            : 0;
          const work = characterWorkDays
            .filter((w) => w.purseId === p.id)
            .reduce((n, w) => n + w.days, 0);
          return {
            purseId: p.id,
            totalMinutes,
            committedMinutes: Math.min(
              totalMinutes,
              Math.ceil((work + awayDays) * state.settings.hoursPerDay * 60),
            ),
          };
        }),
    },
  };
}
function eligibility(t: Table, trainerId: string, npcId: string, className: string) {
  const trainer = t.purses.find((p) => p.id === trainerId && p.kind === "character"),
    npc = t.purses.find(
      (p) =>
        p.id === npcId &&
        p.kind === "character" &&
        (p.control === "npc" || t.journal?.world?.npcs.some((n) => n.id === p.id)),
    );
  if (
    !trainer ||
    !npc ||
    trainer.id === npc.id ||
    !characterVisible(t, trainer) ||
    !characterVisible(t, npc)
  )
    throw Error("Choose an available trainer and NPC.");
  const a = characterPosition(t, trainer),
    b = characterPosition(t, npc);
  if (a.downtime || b.downtime)
    throw Error("Finish or cancel the character's away activity before allocating training.");
  const together =
    a.shipId || b.shipId
      ? !!a.shipId && a.shipId === b.shipId
      : (a.inParty && b.inParty) ||
        (!!characterLocation(t, trainer) &&
          characterLocation(t, trainer) === characterLocation(t, npc));
  if (!together)
    throw Error("Trainer and NPC must be together at the same location or aboard the same ship.");
  if (trainer.sheet && npc.sheet && npc.sheet.level > trainer.sheet.level)
    throw Error("The NPC's character level exceeds the trainer's level.");
  let verify = !trainer.sheet || !npc.sheet;
  if (className) {
    const level = (text?: string) => {
      const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = text?.match(
        new RegExp(`(?:^|[^a-z])${escaped}\\s*(?:level\\s*)?(\\d+)(?:$|[^\\d])`, "i"),
      );
      return match ? Number(match[1]) : null;
    };
    const teacher = level(trainer.sheet?.classes),
      pupil = level(npc.sheet?.classes);
    if (teacher !== null && pupil !== null && pupil > teacher)
      throw Error("The NPC's class level exceeds the trainer's class level.");
    verify ||= teacher === null || pupil === null;
  }
  return { trainer, npc, verify };
}
export function applyDowntimeActivity(
  t: CloudTable,
  seat: CloudSeat,
  cmd: DowntimeActivityCommand,
  at: number,
  preview = false,
) {
  const state = readDowntimeActivities(t.journal?.downtimeActivities);
  const dm = () => {
    if (seat.role !== "dm")
      throw Error("Only the DM can review training, configure time or reset counters.");
  };
  const own = (purseId: string) => {
    if (seat.role !== "dm" && !seat.purseIds.includes(purseId))
      throw Error("Use your assigned character's downtime.");
  };
  if (t.journal?.finance?.downtime.some((d) => d.status === "pending"))
    throw Error(
      "Approve or cancel the campaign downtime preview before changing hourly allocations.",
    );
  if (cmd.kind === "downtime-settings") {
    dm();
    if (canonicalJson(cmd.before) !== canonicalJson(state.settings))
      throw Error("Downtime settings changed. Reload before saving.");
    state.settings = cmd.settings;
  } else if (cmd.kind === "downtime-training") {
    own(cmd.trainerId);
    const { trainer, npc } = eligibility(t, cmd.trainerId, cmd.npcId, cmd.className);
    const window = state.windows.find((w) => w.id === cmd.windowId);
    if (!window) throw Error("Choose approved campaign downtime.");
    for (const id of [trainer.id, npc.id])
      // The player's projection deliberately omits another character's resource
      // balance. Only the authoritative server validates that private balance.
      if (!(preview && id === npc.id && !window.budgets.some((b) => b.purseId === id)))
        if (downtimeRemaining(state, window.id, id, true) < cmd.minutes)
          throw Error(
            "Insufficient unallocated hours for the trainer or NPC in this downtime period.",
          );
    state.requests.push({
      ...cmd,
      id: cmd.id,
      trainerName: trainer.name,
      npcName: npc.name,
      trainingHoursPerDay: window.settings.trainingHoursPerDay,
      status: "pending",
      at,
      reviewNote: "",
    });
  } else if (cmd.kind === "downtime-training-reset") {
    dm();
    const group = trainingCounters(state).find((g) => trainingKey(g.record) === trainingKey(cmd));
    if (
      !group ||
      !group.requestIds.length ||
      canonicalJson(group.requestIds) !== canonicalJson(cmd.before)
    )
      throw Error("Training progress changed. Review the counter before resetting.");
    state.resets.push({
      id: cmd.id,
      trainerId: cmd.trainerId,
      npcId: cmd.npcId,
      category: cmd.category,
      topic: cmd.topic,
      requestIds: group.requestIds,
      at,
      note: cmd.note,
    });
  } else {
    const r = state.requests.find((r) => r.id === cmd.requestId);
    if (!r || r.status !== "pending" || canonicalJson(r) !== canonicalJson(cmd.before))
      throw Error("This training request changed or has already been decided.");
    if (cmd.kind === "downtime-training-cancel") {
      own(r.trainerId);
      r.status = "cancelled";
    } else {
      dm();
      if (cmd.approve) {
        const { verify } = eligibility(t, r.trainerId, r.npcId, r.className);
        if (verify && !cmd.note.trim())
          throw Error(
            "Record DM confirmation of the equal-or-lower level requirement when a sheet or class level is unavailable.",
          );
        for (const id of [r.trainerId, r.npcId])
          if (downtimeRemaining(state, r.windowId, id) < r.minutes)
            throw Error("The trainer or NPC no longer has enough hours in this downtime period.");
        r.status = "approved";
      } else r.status = "denied";
      r.reviewNote = cmd.note;
    }
    r.decidedAt = at;
  }
  t.journal!.downtimeActivities = state;
  t.journal!.events.push({
    id: `${cmd.id}-activity`,
    at,
    kind: "management",
    dmOnly: true,
    summary:
      cmd.kind === "downtime-training-reset"
        ? `Training counter reset; DM manually applies milestone changes. ${cmd.note}`.slice(0, 500)
        : `Hourly downtime: ${cmd.kind}. Training tracks time only; character sheets are unchanged.`,
  });
}

export function validateDowntimeActivities(t: Table, projected = false) {
  if (!t.journal?.downtimeActivities) return;
  const s = readDowntimeActivities(t.journal.downtimeActivities);
  for (const rows of [s.windows, s.requests, s.resets])
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw Error("Downtime record IDs must be unique.");
  for (const w of s.windows) {
    if (new Set(w.budgets.map((b) => b.purseId)).size !== w.budgets.length)
      throw Error("Downtime budgets must be unique per character.");
    for (const b of w.budgets)
      if (b.committedMinutes > b.totalMinutes || downtimeRemaining(s, w.id, b.purseId) < 0)
        throw Error("Hourly downtime exceeds its approved resource budget.");
  }
  if (!projected)
    for (const r of s.requests) {
      if (
        !s.windows.some(
          (w) =>
            w.id === r.windowId &&
            [r.trainerId, r.npcId].every((id) => w.budgets.some((b) => b.purseId === id)),
        )
      )
        throw Error("Training must use an existing downtime allocation.");
      if (
        r.status === "pending" &&
        ![r.trainerId, r.npcId].every((id) => t.purses.some((p) => p.id === id))
      )
        throw Error("Resolve pending training before removing a participant.");
    }
}
