/** Keep source prose while promoting only explicit values to playable fields. */
/** @param {import("../quire/sheet.ts").SheetDraft | import("../quire/sheet.ts").CharacterSheet} legacy */
export function importedArrays(legacy) {
  const attacks = String(legacy.attacks || "")
    .split(/\n/)
    .flatMap((line) => {
      const m = line.trim().match(/^(.+?)\s*(?:·|\||:)\s*([+-]?\d+)\s*(?:·|\||:)\s*(.+)$/);
      if (!m || !/\d+d\d+/i.test(m[3])) return [];
      return [
        { name: m[1].slice(0, 120), bonus: Number(m[2]), damage: m[3].slice(0, 120), notes: line },
      ];
    });
  const equipment = String(legacy.equipment || "")
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)\s*(?:[×x]\s*(\d+)|\((\d+)\))$/);
      return {
        name: m ? m[1].trim() : line,
        quantity: m ? Number(m[2] || m[3]) : 1,
        weight: 0,
        equipped: false,
        notes: "Imported: " + line,
      };
    });
  /** @type {number|null} */
  let level = null;
  const spells = String(legacy.spells || "")
    .split(/\n/)
    .flatMap((line) => {
      const heading = line.match(/^\s*(cantrips?|(?:spell )?level\s*([0-9]))\s*:?\s*(.*)$/i);
      if (heading) {
        level = /cantrip/i.test(heading[1]) ? 0 : Number(heading[2]);
        line = heading[3];
      }
      if (level === null || !line.trim()) return [];
      return line
        .split(/[,;]+/)
        .map((name) => ({
          name: name.trim().slice(0, 120),
          level: level ?? 0,
          prepared: false,
          description: "Imported from character sheet. Review spell details.",
          formula: "",
          source: "Imported character sheet",
        }));
    });
  const resources = String(legacy.features || "")
    .split(/\n/)
    .flatMap((line) => {
      const m = line.match(/^\s*[-•]?\s*([^:()]+)\s*\((\d+)\/(\d+)\)/);
      if (!m || Number(m[2]) > Number(m[3])) return [];
      return [
        {
          name: m[1].trim().slice(0, 120),
          current: Number(m[2]),
          max: Number(m[3]),
          recovery: "manual",
        },
      ];
    });
  return { attacks, equipment, spells, resources };
}
/** Only fields actually present in a partial import may replace an existing sheet.
 * @param {import('../quire/sheet.ts').SheetDraft} legacy */
export function importedFieldNames(legacy) {
  const mapping = {
    name: "name",
    race: "species",
    classLevel: "classes",
    background: "background",
    proficiency: "proficiency",
    hitDice: "hitDice",
    armorClass: "ac",
    speed: "speed",
    initiative: "initiative",
    features: "features",
  };
  const fields = Object.entries(mapping)
    .filter(([source]) => Boolean(legacy[/** @type {keyof typeof legacy} */ (source)]))
    .map(([, target]) => target);
  if (legacy.classLevel && /\d/.test(legacy.classLevel)) fields.push("level");
  if (legacy.hitPoints) fields.push("hp", "maxHp");
  for(const [key,value] of Object.entries(legacy.abilities)) if(value.score) fields.push(`scores.${key}`);
  for(const [key,value] of Object.entries(legacy.saves)) if(value) fields.push(`saves.${key}`);
  for(const skill of legacy.skills) fields.push(`skills.${skill.name}`);
  const arrays=importedArrays(legacy);
  for(const key of ["attacks","equipment","spells"]) if(arrays[/** @type {"attacks"|"equipment"|"spells"} */ (key)].length)fields.push(key);
  if (
    [
      legacy.traits,
      legacy.ideals,
      legacy.bonds,
      legacy.flaws,
      legacy.alignment,
      legacy.experience,
    ].some(Boolean)
  )
    fields.push("description");
  if (legacy.features && importedArrays(legacy).resources.length) fields.push("resources");
  for(const [key,value] of Object.entries(legacy.coins)) if(value>0)fields.push(`coins.${key}`);
  if ([legacy.attacks, legacy.equipment, legacy.spells, legacy.proficiencies].some(Boolean))
    fields.push("notes");
  return fields;
}
