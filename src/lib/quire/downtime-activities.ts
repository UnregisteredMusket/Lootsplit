import type { CloudSeat, CloudTable } from "./cloud.ts";
import { canonicalJson } from "./canonical-json.ts";
import {
  characterLocation,
  characterPosition,
  characterVisible,
  campaignMinute,
} from "./character-position.ts";
import { readServices, type ServiceOrder } from "./services-schema.ts";
import { lessonDays, lessonFee } from "./services.ts";
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
  return canonicalJson([r.trainerId, r.npcId, r.category, r.topic.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()]);
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
  const resetIds = new Map<string, Set<string>>();
  for (const reset of state.resets) {
    const key = trainingKey(reset), ids = resetIds.get(key) ?? new Set<string>();
    for (const id of reset.requestIds) ids.add(id);
    resetIds.set(key, ids);
  }
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
    const reset = resetIds.get(key)?.has(r.id);
    if (!reset) {
      group.currentMinutes += r.minutes;
      group.currentDays += r.minutes / (r.trainingHoursPerDay * 60);
      group.requestIds.push(r.id);
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}
/** Complete totals for a DM; a player projection contains only their own contributions. */
export function recipientTrainingCounters(state: DowntimeActivities) {
  const groups = new Map<string, ReturnType<typeof trainingCounters>[number]>();
  for (const counter of trainingCounters(state)) {
    const key = canonicalJson([counter.record.npcId, counter.record.category]);
    const group = groups.get(key);
    if (!group) groups.set(key, { ...counter, requestIds: [...counter.requestIds] });
    else {
      group.currentMinutes += counter.currentMinutes;
      group.lifetimeMinutes += counter.lifetimeMinutes;
      group.currentDays += counter.currentDays;
      group.lifetimeDays += counter.lifetimeDays;
      group.requestIds.push(...counter.requestIds);
    }
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
/**
 * Paid lessons (services wave 2): the agreement a lesson request names, open and matching the
 * pupil, the teacher, the category and the subject. Throws the reason it can't be used.
 */
export function lessonAgreement(
  t: Table,
  r: { lessonOrderId?: string; trainerId: string; npcId: string; category: string; topic: string },
): ServiceOrder {
  const o = readServices(t.journal?.services).orders.find((x) => x.id === r.lessonOrderId);
  if (!o?.terms.lessons) throw Error("Choose lessons you have agreed with a teacher.");
  if (o.status !== "active") throw Error(`These lessons are ${o.status === "paused" ? "paused" : "closed"}. No new sessions.`);
  const l = o.terms.lessons;
  if (r.trainerId !== l.pupilId || r.npcId !== o.terms.npcId || r.category !== l.category || r.topic !== l.topic)
    throw Error("A session must match its lessons: the pupil, the teacher and the subject.");
  return o;
}
function eligibility(t: Table, trainerId: string, npcId: string, className: string, historical = false, lesson = false) {
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
  // Historical bookkeeping still requires current visible identities and ownership.
  // The DM explicitly verifies location and level as they were when training occurred.
  if (historical) return { trainer, npc, verify: true };
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
  // Paid lessons reverse the roles (the NPC teaches): the DM confirms the teacher in review.
  if (lesson) return { trainer, npc, verify: false };
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
  hooks: {
    /** Paid lessons: charge the approved session once (kept out of this module: finance imports it). */
    chargeLesson?: (t: CloudTable, o: ServiceOrder, r: TrainingRequest, commandId: string, at: number) => void;
  } = {},
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
    const lesson = cmd.lessonOrderId ? lessonAgreement(t, cmd) : undefined;
    if (lesson && cmd.historicalContext) throw Error("Log paid lessons as they happen, not as earlier training.");
    const { trainer, npc } = eligibility(t, cmd.trainerId, cmd.npcId, cmd.className, !!cmd.historicalContext, !!lesson);
    const window = state.windows.find((w) => w.id === cmd.windowId);
    if (!window) throw Error("Choose approved campaign downtime.");
    let feeCopper: number | undefined;
    if (lesson) {
      const l = lesson.terms.lessons!,
        taken = lessonDays(t, lesson),
        days = cmd.minutes / (window.settings.trainingHoursPerDay * 60);
      if (taken.approved + taken.pending + days > l.maxDays + 1e-9)
        throw Error(`These lessons have ${Math.max(0, l.maxDays - taken.approved - taken.pending).toLocaleString(undefined, { maximumFractionDigits: 2 })} training days left.`);
      feeCopper = lessonFee(cmd.minutes, l.dayCopper, window.settings.trainingHoursPerDay);
    }
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
      ...(feeCopper !== undefined ? { feeCopper } : {}),
    });
  } else if (cmd.kind === "downtime-training-reset-category") {
    dm();
    const groups = trainingCounters(state).filter(g => g.record.npcId === cmd.npcId && g.record.category === cmd.category);
    const ids = groups.flatMap(g => g.requestIds);
    if (!ids.length || canonicalJson(ids) !== canonicalJson(cmd.before))
      throw Error("Training progress changed. Review the category total before resetting.");
    for (const [index, group] of groups.entries()) {
      if (!group.requestIds.length) continue;
      const r = group.record;
      state.resets.push({ id: `${cmd.id}-${index}`, trainerId: r.trainerId, npcId: r.npcId,
        category: r.category, topic: r.topic, requestIds: group.requestIds, at, note: cmd.note });
    }
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
      if (cmd.approve && r.lessonOrderId) {
        // A paid lesson: recheck the agreement, the fee and funds, count the hours, charge once.
        const o = lessonAgreement(t, r);
        eligibility(t, r.trainerId, r.npcId, r.className, false, true);
        for (const id of [r.trainerId, r.npcId])
          if (downtimeRemaining(state, r.windowId, id) < r.minutes)
            throw Error("The trainer or NPC no longer has enough hours in this downtime period.");
        const fee = lessonFee(r.minutes, o.terms.lessons!.dayCopper, r.trainingHoursPerDay);
        if (fee !== r.feeCopper) throw Error("The session's fee changed. Deny it and ask the player to log it again.");
        if (!hooks.chargeLesson) throw Error("Paid lessons need the updated website.");
        // Charges once and records the session on the agreement (services-lessons.ts).
        r.status = "approved";
        hooks.chargeLesson(t, o, r, cmd.id, at);
      } else if (cmd.approve) {
        const historical = !!r.historicalContext || cmd.historicalConfirmed === true;
        if (historical && (!cmd.historicalConfirmed || !cmd.note.trim()))
          throw Error("Confirm historical location, equal-or-lower levels and completed time in the DM review note.");
        const { verify } = eligibility(t, r.trainerId, r.npcId, r.className, historical);
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
      cmd.kind === "downtime-training-reset" || cmd.kind === "downtime-training-reset-category"
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
