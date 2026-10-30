import { combatantSchema } from "./model.mjs";
import { open5eErrorMessage, readOpen5e } from "../quire/open5e-fetch.mjs";
/** @param {string} message @param {number} status @returns {never} */
const fail = (message, status = 503) => {
  throw Object.assign(new Error(message), { status });
};
const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
/**
 * The stat block's size key ("large"), from Open5e's `size` object or name.
 * @param {unknown} size
 */
export function sizeKey(size) {
  const raw = size && typeof size === "object" ? /** @type {{key?: unknown, name?: unknown}} */ (size).key ?? /** @type {{name?: unknown}} */ (size).name : size;
  const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return SIZES.includes(key) ? key : undefined;
}
/** @typedef {import("zod").infer<typeof combatantSchema> & {type: string, environments: string}} Creature */
/** @type {{at: number, rows: Creature[]} | null} */
let creatureCache = null;
// Only the fields the combatant conversion below reads (Open5e v2 `fields` / `<field>__fields`).
export const CREATURE_INDEX_FIELDS = {
  fields:
    "key,name,document,type,size,armor_class,hit_points,challenge_rating,experience_points,initiative_bonus,modifiers,traits,actions,environments",
  document__fields: "key,name",
  type__fields: "name",
  size__fields: "key,name",
  traits__fields: "name,desc",
  actions__fields: "name,desc",
  environments__fields: "name",
};
/** @param {number} page */
export function creatureIndexUrl(page) {
  const url = new URL("https://api.open5e.com/v2/creatures/");
  url.search = new URLSearchParams({
    document__key__in: "srd-2014",
    limit: "500",
    page: String(page),
    ordering: "name",
    ...CREATURE_INDEX_FIELDS,
  }).toString();
  return url.toString();
}
/**
 * The SRD 5.1 creature list for encounters. Kept for an hour in this isolate; each page is also
 * cached by `readOpen5e`. If Open5e fails, the last list (up to a week old) is used instead.
 * @param {import("../quire/open5e-fetch.mjs").Open5eReadOptions} [options]
 */
export async function creatureIndex(options = {}) {
  if (creatureCache && Date.now() - creatureCache.at < 3600000) return creatureCache.rows;
  try {
    return await loadCreatureIndex(options);
  } catch (error) {
    if (creatureCache && Date.now() - creatureCache.at < 7 * 86400000) return creatureCache.rows;
    if (error && typeof error === "object" && "status" in error && !("reason" in error)) throw error;
    return fail(
      `${open5eErrorMessage(error)} Saved encounters and custom enemies remain available.`,
      503,
    );
  }
}
/** @param {import("../quire/open5e-fetch.mjs").Open5eReadOptions} options */
async function loadCreatureIndex(options) {
  /** @type {Creature[]} */
  const rows = [];
  for (let page = 1; page <= 10; page++) {
    // The per-page list is large and the rows above are already kept in memory.
    const data = /** @type {any} */ (await readOpen5e(creatureIndexUrl(page), { memory: false, ...options }));
    if (!Array.isArray(data.results)) fail("Open5e returned an unexpected creature index.", 503);
    for (const c of data.results) {
      if (c.document?.key !== "srd-2014") continue;
      const r = combatantSchema.safeParse({
        id: c.key,
        name: c.name,
        side: "enemy",
        hp: c.hit_points,
        maxHp: c.hit_points,
        ac: c.armor_class,
        initiative: null,
        initiativeBonus: c.initiative_bonus ?? c.modifiers?.dexterity ?? 0,
        conditions: "",
        cr: Number(c.challenge_rating),
        xp: c.experience_points,
        sourceKey: c.key,
        ...(sizeKey(c.size) ? { size: sizeKey(c.size) } : {}),
        source:
          "SRD 5.1 by Wizards of the Coast LLC · CC BY 4.0 · via Open5e · https://www.dndbeyond.com/srd · https://creativecommons.org/licenses/by/4.0/legalcode",
        notes: [...(c.traits || []), ...(c.actions || [])]
          .map((/** @type {{name: string, desc: string}} */ a) => `${a.name}: ${a.desc}`)
          .join("\n\n")
          .slice(0, 16000),
      });
      if (r.success)
        rows.push({
          ...r.data,
          type: c.type?.name || "",
          environments: (c.environments || [])
            .map((/** @type {{name: string}} */ e) => e.name)
            .join(", "),
        });
    }
    if (!data.next) {
      creatureCache = { at: Date.now(), rows };
      return rows;
    }
  }
  fail("Open5e index exceeds the supported size. Please use custom enemies for now.", 503);
}
