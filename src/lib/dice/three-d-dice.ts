/**
 * 3D dice for rolls the app has already made (owner request 2026-11-06).
 *
 * The roll is decided first, by the room server's crypto dice in shared campaigns or by the
 * device's dice offline (`throwDice` in characters/model.mjs). The animation never decides
 * anything: it throws dice that are forced to land on those exact values
 * (@3d-dice/dice-box-threejs `notation@results`), so what people see always matches the recorded
 * roll. Nothing here is stored or sent anywhere.
 *
 * Fifth-edition dice: d4, d6, d8, d10, d12 and d20 are thrown as themselves. A d100 (percentile)
 * is thrown the way it is read at the table: a tens die (00–90) and a units die (0–9), where
 * 00 and 0 together read 100. Advantage and disadvantage throw two d20s and mark the one kept.
 * Any other die size (d2, d3, d7…) or more than MAX_ANIMATED_DICE dice is not animated; the
 * written result is shown as before.
 */
import { parseDice } from "../characters/model.mjs";

export const ANIMATED_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;
export const MAX_ANIMATED_DICE = 20;

export type RecordedRoll = {
  formula: string;
  dice: number[];
  mode: string;
  modifier: number;
  total: number;
  source?: string;
  label?: string;
  character?: string;
};

export type ThrownDie = {
  /** The die as thrown: "d20", or "d100" (tens) and "d10" (units) for a percentile roll. */
  type: string;
  /** The face it must land on, in the library's numbering (d10 "0" is 10, d100 "00" is 100). */
  face: number;
};

export type DiceThrow = {
  /** Library notation with forced results, e.g. "2d20@17,4" or "1d100+1d10@50,7". */
  notation: string;
  thrown: ThrownDie[];
  /** One entry per recorded die: its value and whether it counts toward the total. */
  results: { sides: number; value: number; kept: boolean }[];
  modifier: number;
  total: number;
};

/** The tens and units faces of a percentile die showing `value` (1–100). */
export function percentileFaces(value: number): { tens: number; units: number } {
  const units = value % 10;
  const tens = Math.floor((value % 100) / 10);
  return { tens: tens === 0 ? 100 : tens * 10, units: units === 0 ? 10 : units };
}

/** The value a pair of percentile faces reads as (the inverse of `percentileFaces`). */
export function percentileValue(tens: number, units: number): number {
  const t = tens === 100 ? 0 : tens;
  const u = units === 10 ? 0 : units;
  return t + u === 0 ? 100 : t + u;
}

/**
 * The throw that shows `roll`, or null when it is not animated (a manual total, a fixed number,
 * an unsupported die size, too many dice, or values that do not fit the dice).
 */
export function diceThrow(roll: RecordedRoll): DiceThrow | null {
  if (roll.source === "manual" || roll.mode === "manual" || !roll.dice?.length) return null;
  let sides: number;
  try {
    ({ sides } = parseDice(roll.formula));
  } catch {
    return null;
  }
  if (!(ANIMATED_SIDES as readonly number[]).includes(sides)) return null;
  if (roll.dice.length > MAX_ANIMATED_DICE) return null;
  if (roll.dice.some((v) => !Number.isInteger(v) || v < 1 || v > sides)) return null;
  const twoForOne = roll.mode === "advantage" || roll.mode === "disadvantage";
  if (twoForOne && (sides !== 20 || roll.dice.length !== 2)) return null;
  // "highest": several separate dice where the highest one counts (treasure pool d100s).
  const highest = roll.mode === "highest";
  if (highest && roll.total !== Math.max(...roll.dice)) return null;
  const keptIndex = twoForOne
    ? roll.dice.indexOf(roll.mode === "advantage" ? Math.max(...roll.dice) : Math.min(...roll.dice))
    : highest
      ? roll.dice.indexOf(Math.max(...roll.dice))
      : -1;
  const results = roll.dice.map((value, i) => ({
    sides,
    value,
    kept: (!twoForOne && !highest) || i === keptIndex,
  }));
  let thrown: ThrownDie[];
  let notation: string;
  if (sides === 100) {
    const faces = roll.dice.map(percentileFaces);
    thrown = [
      ...faces.map((f) => ({ type: "d100", face: f.tens })),
      ...faces.map((f) => ({ type: "d10", face: f.units })),
    ];
    notation = `${faces.length}d100+${faces.length}d10@${thrown.map((d) => d.face).join(",")}`;
  } else {
    thrown = roll.dice.map((value) => ({ type: `d${sides}`, face: value }));
    notation = `${thrown.length}d${sides}@${thrown.map((d) => d.face).join(",")}`;
  }
  return { notation, thrown, results, modifier: roll.modifier, total: roll.total };
}

/** The values the thrown dice show, as recorded dice (tens and units paired back up). */
export function shownValues(t: DiceThrow, faces: number[]): number[] {
  if (t.results[0]?.sides !== 100) return faces;
  const n = faces.length / 2;
  return faces.slice(0, n).map((tens, i) => percentileValue(tens, faces[n + i]!));
}

/** The caption under the dice: "Stealth · 17", with the kept die and modifier spelled out. */
export function diceCaption(roll: RecordedRoll, t: DiceThrow): string {
  const label = [roll.character, roll.label].filter(Boolean).join(" · ");
  const dice = t.results
    .map((r) => (r.kept ? String(r.value) : `(${r.value})`))
    .join(" + ");
  const mod = t.modifier ? ` ${t.modifier > 0 ? "+" : "−"} ${Math.abs(t.modifier)}` : "";
  const mode =
    roll.mode === "advantage"
      ? " · advantage"
      : roll.mode === "disadvantage"
        ? " · disadvantage"
        : roll.mode === "highest"
          ? " · highest wins"
          : "";
  if (roll.mode === "highest")
    return `${label ? label + ": " : ""}${t.total} (${t.results.map((r) => (r.kept ? String(r.value) : `(${r.value})`)).join(", ")}${mode})`;
  return `${label ? label + ": " : ""}${t.total} (${dice}${mod}${mode})`;
}
