import { canReadCharacter, characterPosition, characterLocation } from "./character-position.ts";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { CatalogItem, Lexeme } from "./types.ts";
import { readMarketLocations, locationLabel } from "./shop-locations.ts";
import { readWorld } from "./world-schema.ts";
import { npcAvailableHere, shopVisible } from "./world.ts";
import { formatCopper } from "./money.ts";
import { missingCreatureFields } from "./resource-packs.ts";
import { canAccessEstate } from "./estate.ts";
import { readEstate } from "./estate-schema.ts";

export type LibraryRecord = {
  key: string;
  name: string;
  kind: string;
  description: string;
  image?: string;
  fields: [string, string][];
  links: { name: string; href: string }[];
  warnings?: string[];
};
export const libraryRecordKey = (...parts: string[]) => `record:${JSON.stringify(parts)}`;
export const libraryRecordHref = (...parts: string[]) =>
  `/library?record=${encodeURIComponent(libraryRecordKey(...parts))}#records`;
export const searchLibraryRecords = (records: LibraryRecord[], query: string, kind = "") => {
  const normalize = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return records.filter(
    (r) =>
      (!kind || r.kind === kind) &&
      terms.every((term) =>
        normalize(
          `${r.name} ${r.kind} ${r.description} ${r.fields.map(([k, v]) => `${k} ${v}`).join(" ")}`,
        ).includes(term),
      ),
  );
};

/** References existing records; does not copy data, change visibility or mutate campaign state. */
export function libraryRecords(
  table: Pick<CloudTable, "journal" | "purses" | "holdings" | "shops">,
  seat: Pick<CloudSeat, "role" | "purseIds">,
  catalog: CatalogItem[] = [],
  lexicon: Lexeme[] = [],
): LibraryRecord[] {
  const dm = seat.role === "dm",
    market = readMarketLocations(table.journal?.market),
    world = readWorld(table.journal?.world);
  const location = (id?: string | null): [string, string][] =>
    id ? [["Location", locationLabel(market, id)]] : [];
  const records: LibraryRecord[] = market.locations.map((l) => ({
    key: libraryRecordKey("location", l.id),
    name: l.name,
    kind: "Location",
    description: l.description ?? "",
    image: l.image,
    fields: [["Type", l.kind], ...location(l.id)],
    links: l.parentId
      ? [
          {
            name: `Parent: ${locationLabel(market, l.parentId)}`,
            href: libraryRecordHref("location", l.parentId),
          },
        ]
      : [],
  }));
  const npcLocation = (id: string, fallback: string) => {
    const s=world.characterPositions.find(s=>s.purseId===id);
    return s ? s.inParty ? market.currentLocationId : s.locationId : fallback;
  };
  for (const n of world.npcs.filter((n) => dm || npcAvailableHere(n, table)))
    records.push({
      key: libraryRecordKey("npc", n.id),
      name: n.name,
      kind: "NPC",
      description: n.description,
      image: n.portrait,
      fields: [
        ...location(npcLocation(n.id,n.locationId)),
        [
          "Party",
          world.characterPositions.find((s) => s.purseId === n.id)?.inParty
            ? "In party"
            : "Outside party",
        ],
        ["Bartering", n.barterAllowed ? "Allowed" : "Unavailable"],
        ...(dm
          ? [["Visibility", n.visible ? "Shared when nearby" : "DM only"] as [string, string]]
          : []),
      ],
      links: [
        ...(npcLocation(n.id,n.locationId) ? [{ name: "View location", href: libraryRecordHref("location", npcLocation(n.id,n.locationId)!) }] : []),
        ...(table.purses.some((p) => p.id === n.id && canReadCharacter(table, p, seat))
          ? [
              {
                name: "Open NPC sheet",
                href: `/characters?id=${encodeURIComponent(`party:${n.id}`)}`,
              },
            ]
          : []),
        { name: "Interact with this NPC", href: `/features/npcs?npc=${encodeURIComponent(n.id)}` },
      ],
    });
  for (const p of table.purses.filter(
    (p) =>
      p.kind === "character" &&
      !table.journal?.tradeEconomy?.exchanges.some((e) => e.purseId === p.id) &&
      (dm || canReadCharacter(table, p, seat)),
  ))
    records.push({
      key: libraryRecordKey("character", p.id),
      name: p.name,
      kind: "Character",
      description: p.sheet?.description ?? "",
      image: p.portrait || p.sheet?.portrait || undefined,
      fields: [["Party",characterPosition(table,p).inParty?"In party":"Outside party"],...location(characterLocation(table,p)),...(p.sheet
        ? [
            ["Species", p.sheet.species],
            ["Classes", p.sheet.classes],
            ["Background", p.sheet.background],
            ["Level", String(p.sheet.level)],
          ]
        : [])] as [string,string][],
      links: [
        {
          name: "Open character sheet",
          href: `/characters?id=${encodeURIComponent(`party:${p.id}`)}`,
        },
        { name: "Party & character sheets", href: "/party" },
      ],
    });
  for (const s of table.shops.filter((s) => dm || shopVisible(s, table)))
    records.push({
      key: libraryRecordKey("shop", s.id),
      name: s.name,
      kind: s.blackMarket ? "Black market" : "Shop",
      description: s.notes,
      image: s.image,
      fields: [
        ...location(s.locationId),
        ["Address", s.place],
        ["Shopkeeper", s.keeper],
        ["Category", s.category],
        ["Status", s.closed ? "Closed" : "Open"],
      ],
      links: [
        { name: "Open shop", href: `/shop/${encodeURIComponent(s.id)}` },
        ...(s.locationId
          ? [{ name: "View location", href: libraryRecordHref("location", s.locationId) }]
          : []),
      ],
    });
  for (const h of table.holdings.filter(
    (h) =>
      h.kind === "property" &&
      h.quantity > 0 &&
      (dm ||
        seat.purseIds.includes(h.purseId) ||
        canAccessEstate(table, readEstate(table.journal?.propertyOperations), h.id, seat)),
  ))
    records.push({
      key: libraryRecordKey("property", h.id),
      name: h.name,
      kind: "Property",
      description: h.notes,
      image: h.image,
      fields: location(h.locationId),
      links: [
        { name: "Property management", href: "/features/properties" },
        ...(h.locationId
          ? [{ name: "View location", href: libraryRecordHref("location", h.locationId) }]
          : []),
      ],
    });
  for (const m of world.maps.filter((m) => dm || m.visible)) {
    records.push({
      key: libraryRecordKey("map", m.id),
      name: m.name,
      kind: "Map",
      description: "",
      image: m.image,
      fields: location(m.locationId),
      links: [{ name: "View saved map", href: `/maps?map=${encodeURIComponent(m.id)}` }],
    });
    for (const marker of m.markers.filter((p) => dm || p.visibility === "party"))
      records.push({
        key: libraryRecordKey("marker", m.id, marker.id),
        name: marker.label,
        kind: "Map marker",
        description: marker.description,
        fields: [["Map", m.name]],
        links: [{ name: "View saved map", href: `/maps?map=${encodeURIComponent(m.id)}` }],
      });
  }
  if (dm) {
    for (const p of table.journal?.resourceLibrary?.packs ?? [])
      for (const e of p.entries) {
        const fields: [string, string][] = [
          ["Resource pack", `${p.title} · ${p.revision}`],
          [
            "Sources",
            e.sources
              .map(
                (s) =>
                  `${s.book}, PDF p. ${s.pdfPage}${s.printedPage ? ` (printed ${s.printedPage})` : ""}`,
              )
              .join("; "),
          ],
          ["Attribution", p.attribution],
        ];
        if (e.tags.length) fields.push(["Tags", e.tags.join(", ")]);
        if (e.kind === "creature")
          fields.push(
            ...Object.entries(e.stats).map(([k, v]): [string, string] => [
              k === "initiativeBonus" ? "Initiative bonus" : k.toUpperCase(),
              v === null ? "Unknown — source review required" : String(v),
            ]),
          );
        if (e.kind === "item")
          fields.push(
            ["Category", e.category],
            ["Rarity", e.rarity],
            [
              "Reference price",
              e.baseCopper === null ? "Unknown — DM review required" : formatCopper(e.baseCopper),
            ],
          );
        if (e.kind === "location") fields.push(["Location type", e.locationKind]);
        const related = [
          ...(e.relatedIds ?? []),
          ...("parentId" in e && e.parentId ? [e.parentId] : []),
        ];
        records.push({
          key: libraryRecordKey("resource", p.id, p.revision, e.id),
          name: e.name,
          kind: e.kind === "creature" ? "Monster" : `Source ${e.kind}`,
          description: e.text,
          fields,
          warnings: [...e.warnings, ...missingCreatureFields(e)],
          links: related.flatMap((id) => {
            const r = p.entries.find((x) => x.id === id);
            return r
              ? [{ name: r.name, href: libraryRecordHref("resource", p.id, p.revision, r.id) }]
              : [];
          }),
        });
      }
    for (const c of catalog)
      records.push({
        key: libraryRecordKey("catalog", c.id),
        name: c.name,
        kind: c.service ? "Service" : "Item",
        description: c.notes,
        fields: [
          ["Category", c.category],
          ["Rarity", c.rarity],
          ["Price", formatCopper(c.baseCopper)],
          ["Source", c.origin],
        ],
        links: [{ name: "Manage catalog", href: "/catalog?pane=goods" }],
      });
    for (const l of lexicon)
      records.push({
        key: libraryRecordKey("name", l.id),
        name: l.name,
        kind: "Name",
        description: l.notes,
        fields: [["Type", l.kind]],
        links: [{ name: "Names & lexicon", href: "/catalog?pane=names" }],
      });
    for (const t of table.journal?.propertyOperations?.templates ?? [])
      records.push({
        key: libraryRecordKey("template", t.key),
        name: t.name,
        kind: "Property template",
        description: t.capabilities.join(", "),
        fields: [
          ["Property type", t.propertyType],
          ...(t.rental
            ? [
                [
                  "Rental income",
                  `${formatCopper(t.rental.incomeCopper)} every ${t.rental.periodDays} days`,
                ] as [string, string],
                ["Upkeep", formatCopper(t.rental.upkeepCopper)] as [string, string],
              ]
            : []),
          ...(t.recipes ?? []).map((r): [string, string] => [
            r.name,
            `${r.laborDays} labor days; ${formatCopper(r.laborCostCopper)}; ${r.requirement ?? ""}`,
          ]),
        ],
        links: [{ name: "Manage property templates", href: "/features/properties" }],
      });
    for (const m of table.journal?.propertyOperations?.materials ?? [])
      records.push({
        key: libraryRecordKey("material", m.key),
        name: m.name,
        kind: "Material",
        description: "",
        fields: [["Unit", m.unit]],
        links: [{ name: "Property materials", href: "/features/properties" }],
      });
  }
  return records.sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key),
  );
}
