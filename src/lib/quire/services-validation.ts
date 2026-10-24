import type { CloudTable } from "./cloud.ts";
import { readMarketLocations } from "./shop-locations.ts";
import { isLinkKind, readServices, serviceOrderOpen, serviceProviderSchema, type ServiceKind } from "./services-schema.ts";

function unique(keys: string[], label: string) {
  if (new Set(keys).size !== keys.length) throw Error(`Duplicate ${label}.`);
}
/** Each kind has one time model: temple instant, workshop downtime days, inn per night. */
const timeFor: Partial<Record<ServiceKind, string>> = { temple: "instant", workshop: "downtime-days", inn: "per-night" };
/** Wave-2 engines not switched on yet: their providers are refused until they ship. */
const comingKinds: readonly ServiceKind[] = ["trainer", "stable", "courier", "sage"];

/**
 * Runs after every command and on every read. `projected` is a player's view, which lacks DM
 * drafts, rumour text, other players' orders and hidden records, so checks needing them are skipped.
 */
export function validateServices(
  t: Pick<CloudTable, "journal" | "purses" | "holdings" | "shops">,
  projected = false,
) {
  if (!t.journal?.services) return;
  const s = readServices(t.journal.services);
  unique(
    s.providers.map((p) => p.id),
    "service providers",
  );
  unique(
    s.orders.map((o) => o.id),
    "service orders",
  );
  const locations = readMarketLocations(t.journal?.market).locations;
  for (const p of s.providers) {
    serviceProviderSchema.parse(p);
    if (
      !projected &&
      (!t.shops.some((x) => x.id === p.shopId && x.locationId) ||
        !t.journal?.world?.npcs.some((n) => n.id === p.npcId))
    )
      throw Error("A service provider needs an existing shop with a location and an existing NPC.");
    if (!projected && comingKinds.includes(p.kind)) throw Error("This kind of service isn't available yet.");
    if (isLinkKind(p.kind)) {
      if (p.offers.length || p.rumours?.length) throw Error(`${p.name}: a link opens another screen and has no offers.`);
      if (p.link?.loan && p.kind !== "bank") throw Error(`${p.name}: only a bank has loan terms.`);
      if (p.link?.roles?.length && p.kind !== "hire") throw Error(`${p.name}: only a hire link has roles.`);
      unique(
        (p.link?.roles ?? []).map((r) => r.key),
        "hire roles",
      );
      if (!projected)
        for (const r of p.link?.roles ?? [])
          if (r.npcId && !t.journal?.world?.npcs.some((n) => n.id === r.npcId))
            throw Error(`${r.name}: choose an existing NPC for this role.`);
    } else if (p.link) throw Error(`${p.name}: only fence, bank and hire links carry link settings.`);
    unique(
      p.offers.map((o) => o.key),
      "service offers",
    );
    unique(
      (p.rumours ?? []).map((r) => r.id),
      "rumours",
    );
    for (const o of p.offers) {
      const time = timeFor[p.kind];
      if (time && o.time.kind !== time)
        throw Error(`${o.name}: this kind of service uses ${time.replace("-", " ")} time.`);
      if (p.kind === "inn" && !o.tiers?.length) throw Error(`${o.name}: an inn offer needs room tiers.`);
      if (p.kind !== "inn" && o.tiers?.length) throw Error(`${o.name}: only an inn has room tiers.`);
      unique(
        (o.tiers ?? []).map((x) => x.key),
        "room tiers",
      );
      unique(
        (o.components ?? []).map((c) => c.key),
        "components",
      );
      if (p.kind === "workshop" && o.output.kind !== "holding")
        throw Error(`${o.name}: a workshop order makes an item.`);
    }
    if (!projected)
      for (const r of p.rumours ?? [])
        if (r.text === undefined || r.buyers === undefined) throw Error("A rumour needs its full text.");
  }
  for (const o of s.orders) {
    if (
      o.progressDays > o.terms.workDays ||
      (["ready", "claimed"].includes(o.status) &&
        (o.progressDays !== o.terms.workDays || o.completedDay === undefined))
    )
      throw Error("Service order progress or completion is invalid.");
    if (
      serviceOrderOpen(o) &&
      !projected &&
      (!t.purses.some((p) => p.id === o.purseId) ||
        !locations.some((l) => l.id === o.terms.locationId) ||
        !s.providers.some((p) => p.id === o.providerId))
    )
      throw Error("Resolve open service orders before deleting their customer, provider or location.");
  }
}
