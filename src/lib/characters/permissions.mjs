import { z } from "zod";
/** Explicit overrides win over the legacy full character-editing window. */
export const characterPermissions = {
  name: "Character name",
  portrait: "Portrait",
  species: "Species / subrace",
  classes: "Classes / subclasses",
  background: "Background",
  level: "Level",
  edition: "Rules edition",
  description: "Personality & description",
  scores: "Ability scores",
  proficiency: "Proficiency bonus",
  saves: "Saving throw training",
  skills: "Skill training",
  maxHp: "Maximum HP",
  ac: "Armor class",
  speed: "Speed",
  initiative: "Initiative bonus",
  hitDice: "Hit dice",
  spellAbility: "Spellcasting ability",
  spellAttackExtra: "Spell attack bonus",
  spellDcExtra: "Spell save DC bonus",
  attacks: "Attacks & damage",
  spells: "Known spells",
  slots: "Spell slot limits",
  resources: "Resource definitions & limits",
  equipment: "Add / edit inventory",
  coins: "Adjust currency",
  features: "Features & traits",
  source: "Source credits",
};
/** @typedef {keyof typeof characterPermissions} CharacterPermission */
export const characterPermissionSchema = z.enum(
  /** @type {[CharacterPermission, ...CharacterPermission[]]} */ (
    Object.keys(characterPermissions)
  ),
);
export const characterPermissionsSchema = z.partialRecord(characterPermissionSchema, z.boolean());
/** @param {{editingAllowed?:boolean, permissions?:Partial<Record<CharacterPermission,boolean>>}} purse
 * @param {string} key */
export function canEditCharacterField(purse, key) {
  if (!Object.hasOwn(characterPermissions, key)) return key !== "version";
  const permission = /** @type {CharacterPermission} */ (key);
  return (
    purse.permissions?.[permission] ??
    (key !== "coins" && key !== "equipment" && purse.editingAllowed === true)
  );
}
