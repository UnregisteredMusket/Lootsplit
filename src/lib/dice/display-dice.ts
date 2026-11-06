/**
 * Which rolls the TV display throws (owner choice 2026-11-06: the roller, the DM and the TV
 * display see a roll). The display is a screen the whole table watches, so it throws a roll only
 * for a visible character travelling with the party, never for a character elsewhere, a hidden
 * one, a character on downtime, or an NPC whose sheet the party cannot see. Only rolls that reach
 * the DM's window from the room (players' rolls) are sent: the DM's own rolls, which may be secret
 * checks, stay on the DM's screen. The DM's own screen still throws every roll.
 */
import { characterPosition } from "../quire/character-position.ts";
import type { CloudTable } from "../quire/cloud.ts";

type Table = Pick<CloudTable, "purses" | "journal">;

export const DISPLAY_DICE_KIND = "lootsplit.dice";

/** The purse a room roll belongs to: its purse id, or an account character's `profileId`. */
export function purseForRoll(t: Pick<CloudTable, "purses">, characterId: string) {
  return t.purses.find((p) => p.id === characterId) ?? t.purses.find((p) => p.profileId === characterId);
}

export function displayShowsRoll(t: Table, characterId: string | undefined): boolean {
  if (!characterId) return false;
  const p = purseForRoll(t, characterId);
  if (!p || p.kind !== "character") return false;
  const s = characterPosition(t, p);
  if (!s.visible || !s.inParty || s.downtime) return false;
  if (t.journal?.world?.npcs?.find((n) => n.id === p.id)?.visible === false) return false;
  return p.control !== "npc" || s.sheetVisible;
}
