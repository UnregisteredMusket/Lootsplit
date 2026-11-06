/**
 * The 3D dice queue (owner request 2026-11-06): whoever records an in-app roll calls `showDice`,
 * and the one `DiceRollHost` on the page throws it. Device only; nothing is stored or sent.
 */
import type { RecordedRoll } from "./three-d-dice.ts";

type Listener = (roll: RecordedRoll) => void;
const listeners = new Set<Listener>();

export function showDice(roll: RecordedRoll): void {
  for (const listener of listeners) listener(roll);
}

export function onDice(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
