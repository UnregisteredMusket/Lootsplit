import type { CloudTable } from "./cloud.ts";
import { readBlacksmith, smithProfileSchema, type SmithOrder } from "./blacksmith-schema.ts";
import { readMarketLocations } from "./shop-locations.ts";
import { readEstate } from "./estate-schema.ts";
const open = (o: SmithOrder) => ["active", "paused", "ready"].includes(o.status);
function unique(keys: string[], label: string) {
  if (new Set(keys).size !== keys.length) throw Error(`Duplicate ${label}.`);
}
export function validateBlacksmith(
  t: Pick<CloudTable, "journal" | "purses" | "holdings" | "shops">,
  projected = false,
) {
  const s = readBlacksmith(t.journal?.blacksmith);
  unique(
    s.profiles.map((p) => p.shopId),
    "smith shops",
  );
  unique(
    s.orders.map((o) => o.id),
    "smith orders",
  );
  const locations = readMarketLocations(t.journal?.market).locations;
  const definitions =
    !projected && s.profiles.length ? readEstate(t.journal?.propertyOperations).materials : [];
  for (const p of s.profiles) {
    smithProfileSchema.parse(p);
    if (
      !projected &&
      (!t.shops.some((s) => s.id === p.shopId && s.locationId) ||
        !t.journal?.world?.npcs.some((n) => n.id === p.npcId))
    )
      throw Error("A smith profile requires an existing located shop and NPC.");
    unique(
      p.items.map((i) => i.key),
      "smith designs",
    );
    if (!projected)
      for (const material of p.materials) {
        const definition = definitions.find((m) => m.key === material.materialKey);
        if (!definition || definition.name !== material.name || definition.unit !== material.unit)
          throw Error(
            "Smith materials must retain their canonical material definitions and units.",
          );
      }
    unique(
      p.materials.map((m) => m.materialKey),
      "smith materials",
    );
    unique(
      p.enchantments.map((e) => e.key),
      "smith enchantments",
    );
    for (const i of p.items) {
      unique(
        i.parts.map((part) => part.key),
        "item parts",
      );
      for (const part of i.parts) {
        unique(
          part.options.map((o) => o.key),
          "part styles",
        );
        unique(part.materialKeys, "part materials");
        if (part.materialKeys.some((key) => !p.materials.some((m) => m.materialKey === key)))
          throw Error("Every component material must be offered by this smith.");
      }
    }
  }
  for (const o of s.orders) {
    if (
      o.progressDays > o.terms.workDays ||
      (["ready", "claimed"].includes(o.status) &&
        (o.progressDays !== o.terms.workDays ||
          o.completedDay === undefined ||
          o.completedMinute === undefined))
    )
      throw Error("Commission progress or completion is invalid.");
    if (
      open(o) &&
      !projected &&
      (!t.purses.some((p) => p.id === o.purseId) ||
        !locations.some((l) => l.id === o.terms.locationId))
    )
      throw Error(
        "Resolve outstanding commissions before deleting their customer or forge location.",
      );
  }
}
