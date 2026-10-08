import type { PlaySheet } from "../characters/model.mjs";

export type SheetChange = { field: string; before: string; after: string };
export type SheetChangeGroup = { name: string; changes: SheetChange[] };
const groups: Record<string, string> = {
  name: "Identity",
  species: "Identity",
  classes: "Identity",
  background: "Identity",
  level: "Identity",
  edition: "Identity",
  portrait: "Identity",
  description: "Identity",
  scores: "Abilities and training",
  proficiency: "Abilities and training",
  saves: "Abilities and training",
  skills: "Abilities and training",
  hp: "Combat",
  maxHp: "Combat",
  tempHp: "Combat",
  ac: "Combat",
  speed: "Combat",
  initiative: "Combat",
  inspiration: "Combat",
  deathSuccesses: "Combat",
  deathFailures: "Combat",
  conditions: "Combat",
  hitDice: "Combat",
  attacks: "Combat",
  spellAbility: "Spells",
  spellAttackExtra: "Spells",
  spellDcExtra: "Spells",
  spells: "Spells",
  slots: "Spells",
  resources: "Resources",
  features: "Details",
  notes: "Details",
  source: "Details",
};
const label = (value: string) =>
  value.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
function display(value: unknown): string {
  if (value === undefined) return "Not present";
  if (value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}
/** Match uniquely named records by identity, never pair ambiguous duplicates by position. */
function arrayKeys(rows: unknown[]) {
  const keys = rows.map((row) => {
    if (!row || typeof row !== "object") return "";
    const value = row as Record<string, unknown>;
    return typeof value.id === "string"
      ? value.id
      : typeof value.name === "string"
        ? value.name
        : typeof value.level === "number"
          ? `Level ${value.level}`
          : "";
  });
  return keys.every(Boolean) && new Set(keys).size === keys.length ? keys : null;
}
/** Comparison is advisory. Currency/equipment always remain the canonical campaign assets. */
export function compareImportedSheet(current: PlaySheet, proposed: PlaySheet): SheetChangeGroup[] {
  const result = new Map<string, SheetChange[]>();
  function add(key: string, field: string, before: unknown, after: unknown) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const name = groups[key] || "Details";
    const rows = result.get(name) || [];
    rows.push({ field, before: display(before), after: display(after) });
    result.set(name, rows);
  }
  for (const key of Object.keys(proposed) as (keyof PlaySheet)[]) {
    if (key === "version" || key === "coins" || key === "equipment") continue;
    const before = current[key],
      after = proposed[key],
      field = label(key);
    if (key === "portrait") {
      if (before !== after)
        add(
          key,
          "Portrait",
          before ? "Current portrait" : "No portrait",
          after ? "Submitted portrait" : "No portrait",
        );
    } else if (Array.isArray(before) && Array.isArray(after)) {
      const oldKeys = arrayKeys(before),
        newKeys = arrayKeys(after);
      if (oldKeys && newKeys) {
        const oldRows = new Map(oldKeys.map((id, index) => [id, before[index]]));
        const newRows = new Map(newKeys.map((id, index) => [id, after[index]]));
        for (const id of new Set([...oldKeys, ...newKeys]))
          add(key, `${field}: ${id}`, oldRows.get(id), newRows.get(id));
        if (
          oldKeys.length === newKeys.length &&
          oldKeys.every((id) => newRows.has(id)) &&
          oldKeys.join("\n") !== newKeys.join("\n")
        )
          add(key, `${field}: order`, oldKeys.join(" → "), newKeys.join(" → "));
      } else add(key, field, before, after);
    } else if (before && after && typeof before === "object" && typeof after === "object") {
      const previous = before as Record<string, unknown>,
        next = after as Record<string, unknown>;
      for (const part of new Set([...Object.keys(previous), ...Object.keys(next)]))
        add(
          key,
          `${field}: ${part.length === 3 ? part.toUpperCase() : label(part)}`,
          previous[part],
          next[part],
        );
    } else add(key, field, before, after);
  }
  return [...result].map(([name, changes]) => ({ name, changes }));
}
