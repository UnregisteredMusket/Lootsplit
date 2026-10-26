/**
 * Quest log engine (docs/QUESTS.md). One implementation serves the shared room (commands.ts)
 * and, through executeLocalCommand, the device. Every command is DM only, checks the quest's
 * revision and writes one DM-only Activity event. Quests never move coins or items.
 *
 * Players receive a projection (`projectQuests`, called from `projectRecord`, which also covers
 * archived session reports): only quests revealed to them, without DM notes, hidden objectives,
 * DM-only chronicle lines, revision internals, links to NPCs they cannot read, places of hidden
 * groups they are not in, map pins they cannot see, or receipts they could not already read.
 */
import type { CloudSeat, CloudTable } from "./cloud.ts";
import { characterVisible, inParty, seatInParty } from "./character-position.ts";
import { isNpc } from "./coin-split.ts";
import { readFinance } from "./finance.ts";
import { formatCopper } from "./money.ts";
import { readMarketLocations } from "./shop-locations.ts";
import type { Purse } from "./types.ts";
import {
  MAX_QUEST_LOG,
  MAX_QUEST_REWARD_LINKS,
  MAX_QUESTS,
  readQuests,
  type Quest,
  type QuestAudience,
  type QuestCommand,
  type QuestDraft,
  type QuestLogEntry,
  type QuestRewardLink,
  type Quests,
} from "./quests-schema.ts";

type Seat = Pick<CloudSeat, "role" | "purseIds">;
type Journal = NonNullable<CloudTable["journal"]>;

export const STALE_QUEST = "Quest changed on another device. Nothing was saved.";
const FULL_LOG = `This quest has ${MAX_QUEST_LOG} chronicle entries. Close it and start a follow-up quest.`;

export function questsOf(t: Pick<CloudTable, "journal">): Quest[] {
  return readQuests((t.journal as { quests?: unknown } | undefined)?.quests).quests;
}

/** A player character a quest can be addressed to (not an NPC, not a fund). */
export function questCharacter(t: Pick<CloudTable, "purses" | "journal">, p: Purse | undefined) {
  return !!p && p.kind === "character" && p.control !== "npc" && !isNpc(t, p);
}
/**
 * A party quest reaches every party player character: those travelling with the party and those
 * who walked off (knowledge is not lost by leaving), but not characters the DM made non-party.
 */
function partyMember(t: Pick<CloudTable, "purses" | "journal">, p: Purse) {
  return questCharacter(t, p) && characterVisible(t, p) && (inParty(t, p) || !p.nonParty);
}

/** True when this seat may read the quest. The DM always can. */
export function questReadable(table: Pick<CloudTable, "purses" | "journal">, quest: Pick<Quest, "audience">, seat: Seat) {
  if (seat.role === "dm") return true;
  const mine = table.purses.filter((p) => seat.purseIds.includes(p.id) && characterVisible(table, p));
  if (quest.audience.kind === "party") return mine.some((p) => partyMember(table, p));
  if (quest.audience.kind === "characters") {
    const listed = new Set(quest.audience.purseIds);
    return mine.some((p) => listed.has(p.id) && questCharacter(table, p));
  }
  return false;
}

/** The active session and campaign day, stamped on every chronicle line and objective change. */
function stamp(journal: Journal): { sessionId?: string; day?: number } {
  const session = [...(journal.sessions ?? [])].reverse().find((s) => !s.endedAt);
  const day = journal.finance ? readFinance(journal.finance).day : undefined;
  return {
    ...(session ? { sessionId: session.id } : {}),
    ...(typeof day === "number" ? { day } : {}),
  };
}

/** Where a reward receipt lives in this campaign (current records, then archived sessions). */
function findReceipt(
  t: Pick<CloudTable, "ledger" | "journal">,
  link: Pick<QuestRewardLink, "kind" | "id">,
): { purseIds: string[]; label: string } | null {
  const tables: { ledger: CloudTable["ledger"]; events: Journal["events"] }[] = [
    { ledger: t.ledger, events: t.journal?.events ?? [] },
  ];
  for (const report of t.journal?.reports ?? []) {
    try {
      const raw = JSON.parse(report.snapshot) as Partial<CloudTable>;
      tables.push({ ledger: raw.ledger ?? [], events: raw.journal?.events ?? [] });
    } catch {
      // An unreadable archive cannot hold a linkable receipt; the others are still searched.
    }
  }
  for (const { ledger, events } of tables) {
    if (link.kind === "ledger") {
      const line = ledger.find((l) => l.id === link.id);
      if (line)
        return {
          purseIds: [line.purseId],
          label: `${line.summary.slice(0, 120)}${line.copper ? ` · ${formatCopper(Math.abs(line.copper))}` : ""}`,
        };
    } else if (link.kind === "encounter-award") {
      const lines = ledger.filter((l) => l.award?.receiptId === link.id);
      if (lines.length)
        return {
          purseIds: [...new Set(lines.map((l) => l.purseId))],
          label: `${(lines[0]!.summary.replace(/:.*$/, "") || "Encounter award").slice(0, 120)}${
            lines.some((l) => l.copper > 0) ? ` · ${formatCopper(lines.reduce((n, l) => n + Math.max(0, l.copper), 0))}` : ""
          }`,
        };
    } else {
      const event = events.find((e) => e.lootResolution?.id === link.id);
      if (event)
        return {
          purseIds: [...new Set(event.lootResolution!.lots.flatMap((l) => l.awards.map((a) => a.purseId)))],
          label: "Treasure-pool resolution",
        };
    }
  }
  return null;
}

/** Referenced records must exist when the DM saves; later deletions are skipped when shown. */
function assertDraft(t: CloudTable, draft: QuestDraft) {
  const world = t.journal?.world;
  if (draft.giverNpcId && !world?.npcs.some((n) => n.id === draft.giverNpcId))
    throw Error("Choose an existing NPC as the quest giver.");
  const locations = new Set(readMarketLocations(t.journal?.market).locations.map((l) => l.id));
  const places = [...draft.locationIds, ...draft.objectives.flatMap((o) => (o.locationId ? [o.locationId] : []))];
  if (places.some((id) => !locations.has(id))) throw Error("Choose existing locations for this quest.");
  if (new Set(draft.locationIds).size !== draft.locationIds.length)
    throw Error("Each location can be linked once.");
  const maps = world?.maps ?? [];
  const pin = (m: { mapId: string; markerId: string }) => {
    const map = maps.find((x) => x.id === m.mapId);
    return (
      !!map &&
      (map.markers.some((x) => x.id === m.markerId) ||
        (map.connected?.placements ?? []).some((x) => x.id === m.markerId))
    );
  };
  const markers = [...draft.markers, ...draft.objectives.flatMap((o) => (o.marker ? [o.marker] : []))];
  if (markers.some((m) => !pin(m))) throw Error("Choose existing map pins for this quest.");
  const objectiveIds = new Set(draft.objectives.map((o) => o.id));
  if (objectiveIds.size !== draft.objectives.length) throw Error("Each objective needs its own ID.");
  const areaIds = new Set(draft.areas.map((a) => a.id));
  if (areaIds.size !== draft.areas.length) throw Error("Each radius marker needs its own ID.");
  for (const area of draft.areas) {
    if (!maps.some((m) => m.id === area.mapId)) throw Error("Choose an existing map for each radius marker.");
    if (area.objectiveId && !objectiveIds.has(area.objectiveId))
      throw Error("A radius marker belongs to an objective that is not in this quest.");
  }
}

function notify(
  t: CloudTable,
  quest: Quest,
  cmdId: string,
  at: number,
  text: string,
) {
  const line = `Quest · ${quest.title}: ${text}`.slice(0, 500);
  if (quest.audience.kind === "party")
    t.notes.push({ id: `${cmdId}-quest-note`, at, from: "dm", to: "party", purseId: "", text: line });
  else if (quest.audience.kind === "characters")
    for (const purseId of quest.audience.purseIds)
      t.notes.push({ id: `${cmdId}-quest-note-${purseId}`, at, from: "dm", to: "dm", purseId, text: line });
}

function audienceText(t: CloudTable, audience: QuestAudience) {
  if (audience.kind === "none") return "nobody (draft)";
  if (audience.kind === "party") return "the party";
  return audience.purseIds.map((id) => t.purses.find((p) => p.id === id)?.name ?? "a character").join(", ");
}

export function applyQuestCommand(t: CloudTable, seat: CloudSeat, cmd: QuestCommand, at: number) {
  if (seat.role !== "dm") throw Error("Only the DM can change quests.");
  const journal = t.journal!;
  const state: Quests = readQuests((journal as { quests?: unknown }).quests);
  const save = () => ((journal as { quests?: Quests }).quests = state);
  const activity = (summary: string) =>
    journal.events.push({
      id: `${cmd.id}-event-${journal.events.length}`,
      at,
      summary: summary.slice(0, 500),
      kind: "management",
      dmOnly: true,
    });
  const when = stamp(journal);
  const addLog = (quest: Quest, entry: Omit<QuestLogEntry, "id" | "at" | "sessionId" | "day">, suffix = "") => {
    if (quest.log.length >= MAX_QUEST_LOG) throw Error(FULL_LOG);
    quest.log.push({ id: `${cmd.id}${suffix}`, at, ...when, ...entry });
  };
  const revealed = (quest: Quest) => quest.audience.kind !== "none";

  if (cmd.kind === "quest-save") {
    assertDraft(t, cmd.quest);
    const draft = cmd.quest;
    if (cmd.questId === null) {
      if (cmd.revision !== null) throw Error(STALE_QUEST);
      if (state.quests.some((q) => q.id === cmd.id)) throw Error("This quest already exists.");
      if (state.quests.length >= MAX_QUESTS)
        throw Error(`This campaign has ${MAX_QUESTS} quests. Archive is kept; nothing was saved.`);
      state.quests.push({
        id: cmd.id,
        title: draft.title,
        ...(draft.main ? { main: true } : {}),
        status: "active",
        audience: { kind: "none" },
        summary: draft.summary,
        ...(draft.giverNpcId ? { giverNpcId: draft.giverNpcId } : {}),
        locationIds: draft.locationIds,
        markers: draft.markers,
        areas: draft.areas,
        objectives: draft.objectives.map((o) => ({ ...o, state: "open" as const })),
        ...(draft.rewardText ? { rewardText: draft.rewardText } : {}),
        rewardLinks: [],
        log: [],
        ...(draft.dmNotes ? { dmNotes: draft.dmNotes } : {}),
        createdAt: at,
        updatedAt: at,
        editedAt: at,
        revision: 0,
      });
      save();
      activity(`Quest drafted: ${draft.title}`);
      return;
    }
    const quest = state.quests.find((q) => q.id === cmd.questId);
    if (!quest || quest.revision !== cmd.revision) throw Error(STALE_QUEST);
    const before = new Map(quest.objectives.map((o) => [o.id, o]));
    const known = (o: { hidden?: boolean }) => revealed(quest) && !o.hidden;
    for (const old of quest.objectives)
      if (known(old) && !draft.objectives.some((o) => o.id === old.id))
        throw Error(`Players know "${old.text}". Mark it done or failed instead of removing it.`);
    let shared = draft.title !== quest.title || draft.summary !== quest.summary || !!draft.main !== !!quest.main;
    const objectives = draft.objectives.map((o) => {
      const old = before.get(o.id);
      const next = {
        ...o,
        state: old?.state ?? ("open" as const),
        ...(old?.changedAt !== undefined ? { changedAt: old.changedAt } : {}),
        ...(old?.sessionId ? { sessionId: old.sessionId } : {}),
      };
      if (known(next) && (!old || !known(old))) {
        // A new or newly revealed objective is news for the players who know the quest.
        addLog(quest, { text: `New objective: ${o.text}`, shared: true, kind: "objective", objectiveId: o.id }, `-objective-${o.id}`);
        shared = true;
      } else if (known(next) && old && (old.text !== o.text || !!old.optional !== !!o.optional)) shared = true;
      return next;
    });
    Object.assign(quest, {
      title: draft.title,
      summary: draft.summary,
      locationIds: draft.locationIds,
      markers: draft.markers,
      areas: draft.areas,
      objectives,
    });
    for (const [key, value] of [
      ["main", draft.main || undefined],
      ["giverNpcId", draft.giverNpcId],
      ["rewardText", draft.rewardText || undefined],
      ["dmNotes", draft.dmNotes || undefined],
    ] as const) {
      if (value === undefined) delete quest[key];
      else (quest as Record<string, unknown>)[key] = value;
    }
    quest.revision += 1;
    quest.editedAt = at;
    if (shared && revealed(quest)) quest.updatedAt = at;
    save();
    activity(`Quest saved: ${quest.title}`);
    return;
  }

  const quest = state.quests.find((q) => q.id === cmd.questId);
  if (!quest || quest.revision !== cmd.revision) throw Error(STALE_QUEST);
  const finish = (summary: string, shared: boolean) => {
    quest.revision += 1;
    quest.editedAt = at;
    if (shared) quest.updatedAt = at;
    save();
    activity(summary);
  };

  if (cmd.kind === "quest-reveal") {
    if (cmd.audience.kind === "characters") {
      const ids = new Set(cmd.audience.purseIds);
      if (ids.size !== cmd.audience.purseIds.length) throw Error("Each character can be listed once.");
      for (const purseId of ids)
        if (!questCharacter(t, t.purses.find((p) => p.id === purseId)))
          throw Error("Choose player characters to tell about this quest.");
    }
    const wasRevealed = revealed(quest);
    quest.audience = cmd.audience;
    const nowRevealed = revealed(quest);
    if (nowRevealed) {
      quest.revealedAt ??= at;
      addLog(quest, {
        text: cmd.text || (wasRevealed ? "More of the party learned of this quest." : "The party learned of this quest."),
        shared: true,
        kind: "revealed",
      });
      if (cmd.message) notify(t, quest, cmd.id, at, cmd.text || "New quest in your quest log.");
    }
    finish(`Quest ${nowRevealed ? "revealed" : "hidden again"}: ${quest.title} · ${audienceText(t, quest.audience)}`, nowRevealed);
    return;
  }
  if (cmd.kind === "quest-objective") {
    const objective = quest.objectives.find((o) => o.id === cmd.objectiveId);
    if (!objective) throw Error(STALE_QUEST);
    let shared = false;
    if (cmd.action === "reveal" || cmd.action === "hide") {
      const hide = cmd.action === "hide";
      if (!!objective.hidden === hide) return;
      if (hide) objective.hidden = true;
      else delete objective.hidden;
      if (!hide && revealed(quest)) {
        addLog(quest, { text: cmd.text || `New objective: ${objective.text}`, shared: true, kind: "objective", objectiveId: objective.id });
        shared = true;
      }
      finish(`Quest objective ${hide ? "hidden" : "revealed"}: ${quest.title} · ${objective.text}`, shared);
    } else {
      if (objective.state === cmd.action) return;
      objective.state = cmd.action;
      objective.changedAt = at;
      if (when.sessionId) objective.sessionId = when.sessionId;
      else delete objective.sessionId;
      shared = revealed(quest) && !objective.hidden;
      const words = cmd.action === "done" ? "Done" : cmd.action === "failed" ? "Failed" : "Reopened";
      // A hidden objective's progress stays a DM-only line until the objective is revealed.
      addLog(quest, { text: cmd.text || `${words}: ${objective.text}`, shared, kind: "objective", objectiveId: objective.id });
      finish(`Quest objective ${words.toLowerCase()}: ${quest.title} · ${objective.text}`, shared);
    }
    if (shared && cmd.message) notify(t, quest, cmd.id, at, cmd.text || objective.text);
    return;
  }
  if (cmd.kind === "quest-log") {
    addLog(quest, { text: cmd.text, shared: cmd.shared, kind: "entry" });
    const shared = cmd.shared && revealed(quest);
    if (shared && cmd.message) notify(t, quest, cmd.id, at, cmd.text);
    finish(`Quest chronicle ${cmd.shared ? "entry" : "DM note"}: ${quest.title}`, shared);
    return;
  }
  if (cmd.kind === "quest-close") {
    if (quest.status === cmd.status) return;
    quest.status = cmd.status;
    if (cmd.status === "active") delete quest.closedAt;
    else quest.closedAt = at;
    const words = cmd.status === "completed" ? "Completed" : cmd.status === "failed" ? "Failed" : "Reopened";
    addLog(quest, { text: cmd.text || `${words}.`, shared: true, kind: "status" });
    const shared = revealed(quest);
    if (shared && cmd.message) notify(t, quest, cmd.id, at, cmd.text || words);
    finish(`Quest ${words.toLowerCase()}: ${quest.title}`, shared);
    return;
  }
  if (cmd.kind === "quest-link-reward") {
    const same = (l: QuestRewardLink) => l.kind === cmd.link.kind && l.id === cmd.link.id;
    if (cmd.remove) {
      if (!quest.rewardLinks.some(same)) return;
      quest.rewardLinks = quest.rewardLinks.filter((l) => !same(l));
      finish(`Quest reward link removed: ${quest.title}`, false);
      return;
    }
    if (quest.rewardLinks.some(same)) return;
    if (quest.rewardLinks.length >= MAX_QUEST_REWARD_LINKS)
      throw Error(`A quest can link ${MAX_QUEST_REWARD_LINKS} receipts.`);
    const receipt = findReceipt(t, cmd.link);
    if (!receipt) throw Error("That receipt is not in this campaign.");
    quest.rewardLinks.push({ ...cmd.link, label: receipt.label, at });
    finish(`Quest reward linked: ${quest.title} · ${receipt.label}`, revealed(quest));
    return;
  }
  if (cmd.kind === "quest-archive") {
    if (!!quest.archived === cmd.archived) return;
    if (cmd.archived) quest.archived = true;
    else delete quest.archived;
    finish(`Quest ${cmd.archived ? "archived" : "restored"}: ${quest.title}`, false);
    return;
  }
  if (cmd.kind === "quest-delete") {
    if (quest.revealedAt !== undefined || revealed(quest))
      throw Error("Players have seen this quest. Archive it instead; its history is kept.");
    state.quests = state.quests.filter((q) => q !== quest);
    save();
    activity(`Quest draft deleted: ${quest.title}`);
  }
}

export type QuestProjectionContext = {
  /** NPC IDs this seat may read (`projectRecord`). */
  readableNpcs: Set<string>;
  /** Places of hidden groups this seat is not in. */
  hiddenPlaces: Set<string>;
};
/**
 * A player's copy of the quest log. Runs on the unprojected `table` (audiences and receipts are
 * decided there) and writes into the projected `journal`. Returns the location IDs the projected
 * quests name, so their names reach the player's market projection.
 */
export function projectQuests(
  table: CloudTable,
  journal: Journal,
  seat: Seat,
  context: QuestProjectionContext,
): string[] {
  const raw = (journal as { quests?: unknown }).quests;
  if (seat.role === "dm" || raw === undefined) return [];
  const own = new Set(seat.purseIds);
  const party = seatInParty(table, seat);
  const receiptReadable = (link: QuestRewardLink) => {
    const receipt = findReceipt(table, link);
    if (!receipt) return false;
    if (link.kind === "loot-resolution") return party || receipt.purseIds.some((id) => own.has(id));
    return receipt.purseIds.some((id) => {
      if (own.has(id)) return true;
      const p = table.purses.find((x) => x.id === id);
      // Party balances and their lines are shared only among the party (cloud.server.ts playerTable).
      return !!p && party && !isNpc(table, p) && !p.nonParty && characterVisible(table, p) && inParty(table, p);
    });
  };
  const place = (id: string | undefined) => !!id && !context.hiddenPlaces.has(id);
  const quests = readQuests(raw)
    .quests.filter((q) => questReadable(table, q, seat))
    .map((q): Quest => {
      const objectives = q.objectives
        .filter((o) => !o.hidden)
        .map((o) => {
          const projected = { ...o };
          if (!place(o.locationId)) delete projected.locationId;
          return projected;
        });
      const visibleObjectives = new Set(objectives.map((o) => o.id));
      const projected: Quest = {
        ...q,
        audience:
          q.audience.kind === "characters"
            ? {
                kind: "characters",
                // Owner decision D3: co-recipients' names are shown (they share the secret).
                purseIds: q.audience.purseIds.filter((id) => {
                  const p = table.purses.find((x) => x.id === id);
                  return !!p && characterVisible(table, p);
                }),
              }
            : q.audience,
        locationIds: q.locationIds.filter(place),
        areas: q.areas.filter((a) => !a.objectiveId || visibleObjectives.has(a.objectiveId)),
        objectives,
        log: q.log
          .filter((l) => l.shared && (!l.objectiveId || visibleObjectives.has(l.objectiveId)))
          .map((l) => ({ ...l })),
        rewardLinks: q.rewardLinks.filter(receiptReadable).map((l) => ({ kind: l.kind, id: l.id, ...(l.label ? { label: l.label } : {}) })),
        revision: 0,
      };
      // Permission chaining: a giver the seat cannot read is dropped, never named.
      if (!q.giverNpcId || !context.readableNpcs.has(q.giverNpcId)) delete projected.giverNpcId;
      delete projected.dmNotes;
      delete projected.editedAt;
      if (projected.audience.kind === "characters" && !projected.audience.purseIds.length)
        projected.audience = { kind: "party" };
      return projected;
    });
  if (quests.length) (journal as { quests?: Quests }).quests = { quests };
  else delete (journal as { quests?: Quests }).quests;
  return quests.flatMap((q) => [
    ...q.locationIds,
    ...q.objectives.flatMap((o) => (o.locationId ? [o.locationId] : [])),
  ]);
}

/**
 * After the maps are projected: keep only map pins and radius markers on maps (and pins) the
 * player can see. Hidden objectives' markers never reach this point (`projectQuests`).
 */
export function projectQuestMapLinks(journal: Journal) {
  const store = (journal as { quests?: Quests }).quests;
  if (!store) return;
  const maps = journal.world?.maps ?? [];
  const pin = (m: { mapId: string; markerId: string }) => {
    const map = maps.find((x) => x.id === m.mapId);
    return (
      !!map &&
      (map.markers.some((x) => x.id === m.markerId) ||
        (map.connected?.placements ?? []).some((x) => x.id === m.markerId))
    );
  };
  for (const quest of store.quests) {
    quest.markers = quest.markers.filter(pin);
    quest.areas = quest.areas.filter((a) => maps.some((m) => m.id === a.mapId));
    for (const o of quest.objectives) if (o.marker && !pin(o.marker)) delete o.marker;
  }
}

/** Purse IDs a projected quest names (for the player's character name list). */
export function questNamedPurses(journal: Journal): string[] {
  const store = (journal as { quests?: Quests }).quests;
  return (store?.quests ?? []).flatMap((q) => (q.audience.kind === "characters" ? q.audience.purseIds : []));
}
