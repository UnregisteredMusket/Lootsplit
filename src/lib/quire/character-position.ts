import type { CloudTable, CloudSeat } from "./cloud.ts";
import type { Purse } from "./types.ts";
import { type CharacterPosition, type WorldCommand } from "./world-schema.ts";
import { readMarketLocations, locationPath } from "./shop-locations.ts";
import { canonicalJson } from "./canonical-json.ts";
import { characterSheet, statsOnly } from "../characters/campaign-sheet.mjs";
import { activeGroups, groupPlace, MAIN_GROUP, resolveGroup, seatGroups, withoutGroupFields } from "./party-groups.ts";

type Table = Pick<CloudTable, "purses" | "journal">;
export function characterPosition(t: Table, p: Purse): CharacterPosition {
  const w = t.journal?.world,
    n = w?.npcs.find((n) => n.id === p.id);
  const position = w?.characterPositions?.find((s) => s.purseId === p.id) ?? {
    purseId: p.id, inParty: !p.nonParty, locationId: n?.locationId ?? null,
    visible: n?.visible ?? true, sheetVisible: !p.nonParty,
  };
  const aboard=t.journal?.fleet?.aboard.find(a=>a.purseId===p.id);
  return aboard ? {...position,shipId:aboard.propertyId,shipReturnInParty:aboard.returnInParty} : position;
}
export function inParty(t: Table, p: Purse) {
  return p.kind === "party" || characterPosition(t, p).inParty;
}
export function characterLocation(t: Table, p: Purse) {
  const s = characterPosition(t, p);
  if (s.shipId) return s.locationId;
  // Split the party: a character in the party is wherever its group is (main = the party's place).
  return s.inParty ? groupPlace(t, resolveGroup(t, s.groupId)).locationId : s.locationId;
}
export function characterVisible(t: Table, p: Purse) {
  return characterPosition(t, p).visible;
}
/**
 * A party companion is a visible NPC character travelling with the party. When the DM turns on
 * "Party can see companion NPC funds", party players may read its coins and ledger lines.
 * Hidden NPCs, NPCs elsewhere and exchange treasuries never qualify.
 */
export function companionFundsShared(t: Table, p: Purse) {
  if (t.journal?.world?.companionFundsVisible !== true) return false;
  if (p.kind !== "character" || p.control !== "npc") return false;
  if (t.journal?.tradeEconomy?.exchanges?.some((e) => e.purseId === p.id)) return false;
  const npc = t.journal?.world?.npcs?.find((n) => n.id === p.id);
  const s = characterPosition(t, p);
  return s.visible && (npc?.visible ?? true) && s.inParty && !s.downtime;
}
/** True when `seat` (a player) may read this companion's coins and ledger lines. The DM always can. */
export function companionFundsReadable(
  t: Table,
  p: Purse,
  seat: Pick<CloudSeat, "role" | "purseIds">,
) {
  if (seat.role === "dm") return true;
  if (!companionFundsShared(t, p)) return false;
  // Only seats with a visible character travelling with the party; non-party players do not.
  return seatInParty(t, seat, p.id);
}
/**
 * True when a player seat controls a visible, player-controlled character travelling with the
 * party (not elsewhere, not on downtime). Party-only readouts (other party players' balances and
 * ledger lines, shared companion funds) require this; a non-party player gets only their own data.
 * `except` ignores one purse, so a controlled companion does not qualify its own controller.
 */
export function seatInParty(
  t: Table,
  seat: Pick<CloudSeat, "role" | "purseIds">,
  except?: string,
) {
  if (seat.role === "dm") return true;
  return seat.purseIds.some((id) => {
    const own = t.purses.find((o) => o.id === id);
    return (
      !!own &&
      own.id !== except &&
      own.kind === "character" &&
      own.control !== "npc" &&
      characterVisible(t, own) &&
      inParty(t, own)
    );
  });
}
export function canReadCharacter(t: Table, p: Purse, seat: Pick<CloudSeat, "role" | "purseIds">) {
  if (seat.role === "dm") return true;
  const s = characterPosition(t, p);
  if (!s.visible || (p.control === "npc" && !s.sheetVisible)) return false;
  return (
    seat.purseIds.includes(p.id) ||
    (p.control === "npc" &&
      !!p.sheet &&
      (s.inParty ||
        (!!characterLocation(t, p) &&
          // Any place where one of the seat's groups is (the party's place when not split).
          seatGroups(t, seat).some((g) =>
            locationPath(readMarketLocations(t.journal?.market), groupPlace(t, g).locationId).some(
              (l) => l.id === characterLocation(t, p),
            ),
          ))))
  );
}
export function campaignMinute(t: Pick<CloudTable, "journal">) {
  return (t.journal?.finance?.day ?? 0) * 1440 + (t.journal?.finance?.minuteOfDay ?? 0);
}
export function finishingCharacters(t: Table, until: number) {
  return (t.journal?.world?.characterPositions ?? []).filter(
    (s) => s.downtime && s.downtime.finishMinute <= until,
  );
}
function place(t: CloudTable, s: CharacterPosition) {
  const w = t.journal!.world!,
    p = t.purses.find((p) => p.id === s.purseId)!;
  w.characterPositions = w.characterPositions.filter((old) => old.purseId !== s.purseId);
  const {shipId,shipReturnInParty,...stored}=s;
  void shipId; void shipReturnInParty;
  // A group belongs only to characters in the party; the main group is stored as no groupId.
  if (!stored.inParty || !stored.groupId || stored.groupId === MAIN_GROUP) delete stored.groupId;
  if (stored.downtime && !stored.downtime.returnGroupId) {
    const { returnGroupId: _unused, ...downtime } = stored.downtime;
    void _unused;
    stored.downtime = downtime;
  }
  w.characterPositions.push(stored);
  const n = w.npcs.find((n) => n.id === p.id);
  if (n) {
    p.nonParty = !s.inParty;
    n.visible = s.visible;
    if (s.locationId) n.locationId = s.locationId;
  }
}
/**
 * Split the party: the group a character returns to after downtime — the group it left if that
 * group is still active, otherwise the group it merged into, otherwise the main group.
 */
function returnGroup(t: CloudTable, d: NonNullable<CharacterPosition["downtime"]>) {
  if (!d.returnInParty) return undefined;
  const g = resolveGroup(t, d.returnGroupId);
  return g === MAIN_GROUP || !activeGroups(t).some((x) => x.id === g) ? undefined : g;
}
export function completeCharacterDowntime(t: CloudTable, at: number) {
  for (const s of finishingCharacters(t, campaignMinute(t))) {
    const d = s.downtime!;
    place(t, {
      ...s,
      inParty: d.returnInParty,
      locationId: d.returnLocationId,
      groupId: returnGroup(t, d),
      downtime: undefined,
    });
    t.journal!.events.push({
      id: d.id + "-finished",
      at,
      kind: "management",
      dmOnly: true,
      purseId: s.purseId,
      summary: `${t.purses.find((p) => p.id === s.purseId)?.name}: completed ${d.name}; previous placement restored.`,
    });
  }
}
export function applyCharacterPosition(
  t: CloudTable,
  seat: CloudSeat,
  cmd: WorldCommand,
  at: number,
) {
  if (
    !["character-position", "character-downtime-start", "character-downtime-cancel"].includes(
      cmd.kind,
    )
  )
    return false;
  if (seat.role !== "dm") throw Error("Only the DM can move characters or manage downtime.");
  if (!("purseId" in cmd) || !("before" in cmd)) throw Error("Invalid character command.");
  const p = t.purses.find((p) => p.id === cmd.purseId && p.kind === "character");
  if (!p || t.journal?.tradeEconomy?.exchanges.some((e) => e.purseId === p.id))
    throw Error("Choose an existing character or NPC.");
  const s = characterPosition(t, p);
  if (canonicalJson(s) !== canonicalJson(cmd.before)) {
    // An app older than split-the-party (tabletop protocol 9) sends the placement without its group.
    if ((s.groupId || s.downtime?.returnGroupId) && canonicalJson(withoutGroupFields(s)) === canonicalJson(cmd.before))
      throw Error(`The party is split into groups. Update Lootsplitter to act for ${p.name}.`);
    throw Error("This character's placement changed. Reload before saving.");
  }
  if (
    t.journal?.finance?.downtime.some((d) => d.status === "pending") &&
    (cmd.kind !== "character-position" ||
      cmd.inParty !== s.inParty ||
      cmd.locationId !== s.locationId)
  )
    throw Error("Approve or cancel pending campaign downtime before changing character placement.");
  if (
    "locationId" in cmd &&
    cmd.locationId &&
    !readMarketLocations(t.journal?.market).locations.some((l) => l.id === cmd.locationId)
  )
    throw Error("Choose an existing location.");
  if (s.shipId && cmd.kind !== "character-position") throw Error("Disembark before starting character downtime.");
  if (cmd.kind === "character-position") {
    if (s.downtime && (cmd.inParty !== s.inParty || cmd.locationId !== s.locationId))
      throw Error("Cancel this character's downtime before moving them.");
    const placementChanged = cmd.inParty !== s.inParty || cmd.locationId !== s.locationId;
    if(placementChanged&&t.journal!.fleet)t.journal!.fleet.aboard=t.journal!.fleet.aboard.filter(a=>a.purseId!==p.id);
    place(t, {
      ...s,
      ...(placementChanged ? { shipId: undefined, shipReturnInParty: undefined } : {}),
      inParty: cmd.inParty,
      locationId: cmd.locationId,
      visible: cmd.visible,
      sheetVisible: cmd.sheetVisible,
    });
    if (p.control === "npc" && cmd.inParty && !p.sheet) {
      p.sheet = statsOnly(
        characterSheet(
          p,
          [],
          t.sheets.find((old) => old.purseId === p.id),
        ),
      );
      p.sheet.description = t.journal!.world!.npcs.find((n) => n.id === p.id)?.description ?? "";
      p.sheetRevision = (p.sheetRevision ?? 0) + 1;
    }
  } else if (cmd.kind === "character-downtime-start") {
    if (s.downtime) throw Error("This character already has an active downtime action.");
    const start = campaignMinute(t);
    const duration = cmd.durationMinutes ?? cmd.days * 1440;
    if (start + duration > 1e9 * 1440)
      throw Error("Downtime exceeds the supported campaign clock.");
    place(t, {
      ...s,
      inParty: false,
      locationId: cmd.locationId,
      downtime: {
        id: cmd.id,
        name: cmd.name,
        startedMinute: start,
        finishMinute: start + duration,
        returnInParty: s.inParty,
        returnLocationId: s.locationId,
        ...(s.inParty && s.groupId ? { returnGroupId: s.groupId } : {}),
      },
    });
  } else if (cmd.kind === "character-downtime-cancel") {
    if (!s.downtime) throw Error("This character has no active downtime action.");
    place(t, {
      ...s,
      inParty: s.downtime.returnInParty,
      locationId: s.downtime.returnLocationId,
      groupId: returnGroup(t, s.downtime),
      downtime: undefined,
    });
  }
  t.journal!.events.push({
    id: cmd.id + "-placement",
    at,
    kind: "management",
    dmOnly: true,
    purseId: p.id,
    summary: `${p.name}: ${cmd.kind === "character-downtime-start" ? "started downtime" : cmd.kind === "character-downtime-cancel" ? "cancelled downtime; previous placement restored" : "placement and visibility updated"}.`,
  });
  return true;
}
