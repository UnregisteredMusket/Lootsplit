import type { CloudTable, CloudSeat } from "./cloud.ts";
import type { Purse } from "./types.ts";
import { type CharacterPosition, type WorldCommand } from "./world-schema.ts";
import { readMarketLocations, locationPath } from "./shop-locations.ts";
import { canonicalJson } from "./canonical-json.ts";
import { characterSheet, statsOnly } from "../characters/campaign-sheet.mjs";

type Table = Pick<CloudTable, "purses" | "journal">;
export function characterPosition(t: Table, p: Purse): CharacterPosition {
  const w = t.journal?.world,
    n = w?.npcs.find((n) => n.id === p.id);
  return (
    w?.characterPositions?.find((s) => s.purseId === p.id) ?? {
      purseId: p.id,
      inParty: !p.nonParty,
      locationId: n?.locationId ?? null,
      visible: n?.visible ?? true,
      sheetVisible: !p.nonParty,
    }
  );
}
export function inParty(t: Table, p: Purse) {
  return p.kind === "party" || characterPosition(t, p).inParty;
}
export function characterLocation(t: Table, p: Purse) {
  const s = characterPosition(t, p);
  return s.inParty ? readMarketLocations(t.journal?.market).currentLocationId : s.locationId;
}
export function characterVisible(t: Table, p: Purse) {
  return characterPosition(t, p).visible;
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
          locationPath(
            readMarketLocations(t.journal?.market),
            readMarketLocations(t.journal?.market).currentLocationId,
          ).some((l) => l.id === characterLocation(t, p)))))
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
  w.characterPositions.push(s);
  const n = w.npcs.find((n) => n.id === p.id);
  if (n) {
    p.nonParty = !s.inParty;
    n.visible = s.visible;
    if (s.locationId) n.locationId = s.locationId;
  }
}
export function completeCharacterDowntime(t: CloudTable, at: number) {
  for (const s of finishingCharacters(t, campaignMinute(t))) {
    const d = s.downtime!;
    place(t, {
      ...s,
      inParty: d.returnInParty,
      locationId: d.returnLocationId,
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
  if (canonicalJson(s) !== canonicalJson(cmd.before))
    throw Error("This character's placement changed. Reload before saving.");
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
  if (cmd.kind === "character-position") {
    if (s.downtime && (cmd.inParty !== s.inParty || cmd.locationId !== s.locationId))
      throw Error("Cancel this character's downtime before moving them.");
    place(t, {
      ...s,
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
    if (start + cmd.days * 1440 > 1e9 * 1440)
      throw Error("Downtime exceeds the supported campaign clock.");
    place(t, {
      ...s,
      inParty: false,
      locationId: cmd.locationId,
      downtime: {
        id: cmd.id,
        name: cmd.name,
        startedMinute: start,
        finishMinute: start + cmd.days * 1440,
        returnInParty: s.inParty,
        returnLocationId: s.locationId,
      },
    });
  } else if (cmd.kind === "character-downtime-cancel") {
    if (!s.downtime) throw Error("This character has no active downtime action.");
    place(t, {
      ...s,
      inParty: s.downtime.returnInParty,
      locationId: s.downtime.returnLocationId,
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
