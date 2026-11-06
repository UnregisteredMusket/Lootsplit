/**
 * The 3D dice queue (owner request 2026-11-06): whoever records or receives a roll calls
 * `showDice`, and the one dice host on the page throws it. A roll with an `id` is thrown once per
 * page, so the DM's own roll is not thrown again when the room reports it. Device only; nothing
 * is stored.
 */
import type { RecordedRoll } from "./three-d-dice.ts";

export type DiceRoll = RecordedRoll & { id?: string; characterId?: string };
/** Where a thrown roll came from: this screen's own roll, or another seat's roll from the room. */
export type DiceOrigin = "own" | "table";
type Listener = (roll: DiceRoll, origin: DiceOrigin) => void;
const listeners = new Set<Listener>();
const shown: string[] = [];

export function showDice(roll: DiceRoll, origin: DiceOrigin = "own"): void {
  if (roll.id) {
    if (shown.includes(roll.id)) return;
    shown.push(roll.id);
    if (shown.length > 200) shown.shift();
  }
  for (const listener of listeners) listener(roll, origin);
}

export function onDice(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The fields a roll needs to be thrown elsewhere (the TV display): no seat or account names. */
export function diceForDisplay(roll: DiceRoll): DiceRoll {
  const { id, formula, dice, mode, modifier, total, source, label, character } = roll;
  return { id, formula, dice, mode, modifier, total, source, label, character };
}
