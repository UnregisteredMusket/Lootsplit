/**
 * XP and milestones (loot plan phase 6): the computed readouts. Nothing here changes a sheet:
 * "Ready to level up" offers the new level as a draft edit the person still has to save.
 */
import type { CharacterSheet } from "@/lib/quire/sheet";
import type { Purse } from "@/lib/quire/types";
import { characterSheet } from "@/lib/characters/campaign-sheet.mjs";
import { currentXp, levelUpTarget, xpReadout } from "@/lib/quire/xp";

const n = (value: number) => value.toLocaleString("en-US");

/** Party → Characters: one line per character for the DM. */
export function XpLine({ purse, sheets }: { purse: Purse; sheets: CharacterSheet[] }) {
  const legacy = sheets.find((s) => s.purseId === purse.id);
  const sheet = purse.sheet ?? characterSheet(purse, [], legacy);
  const xp = purse.sheet?.xp ?? (currentXp({ sheets }, purse) || undefined);
  const shown = { level: sheet.level, xp, milestoneLevel: purse.sheet?.milestoneLevel };
  const ready = levelUpTarget(shown);
  const text = xpReadout(shown);
  if (!text && !ready) return null;
  return (
    <p className="party-xp">
      {text}
      {ready ? <strong className="level-up-tag"> Ready to level up: level {ready}</strong> : null}
    </p>
  );
}

/**
 * The sheet's banner for the controlling player and the DM. `onLevel` puts the new level in the
 * draft (the person reviews and saves it); without permission to edit the level it says whom to ask.
 */
export function LevelUpNotice({
  sheet,
  canEditLevel,
  onLevel,
}: {
  sheet: { level: number; xp?: number; milestoneLevel?: number };
  canEditLevel: boolean;
  onLevel: (level: number) => void;
}) {
  const ready = levelUpTarget(sheet);
  if (!ready) return null;
  const why =
    sheet.milestoneLevel !== undefined && sheet.milestoneLevel >= ready
      ? "A milestone was reached."
      : `${n(sheet.xp ?? 0)} XP reaches level ${ready}.`;
  return (
    <div className="level-up-notice" role="status">
      <strong>Ready to level up</strong>
      <span>
        {why} The sheet stays at level {sheet.level} until you change it; HP, proficiency, spells
        and features don't change automatically.
      </span>
      {canEditLevel ? (
        <button type="button" onClick={() => onLevel(ready)}>
          Set level to {ready} (review, then save)
        </button>
      ) : (
        <span>Ask the DM to open editing for the level.</span>
      )}
    </div>
  );
}
