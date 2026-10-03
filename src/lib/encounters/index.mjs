import { combatantSchema } from "./model.mjs";
/** @param {string} message @param {number} status @returns {never} */
const fail = (message, status = 503) => {
  throw Object.assign(new Error(message), { status });
};
/** @typedef {import("zod").infer<typeof combatantSchema> & {type: string, environments: string}} Creature */
/** @type {{at: number, rows: Creature[]} | null} */
let creatureCache = null;
export async function creatureIndex() {
  if (creatureCache && Date.now() - creatureCache.at < 3600000) return creatureCache.rows;
  /** @type {Creature[]} */
  const rows = [];
  for (let page = 1; page <= 10; page++) {
    const url = new URL("https://api.open5e.com/v2/creatures/");
    url.search = new URLSearchParams({
      document__key__in: "srd-2014",
      limit: "500",
      page: String(page),
      ordering: "name",
    }).toString();
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok)
      fail("Open5e is unavailable. Saved encounters and custom enemies remain available.", 503);
    const data = await response.json();
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
