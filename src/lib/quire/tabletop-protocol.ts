import type { CloudTable } from "./cloud.ts";
import type { CampaignMap, MapToken } from "./world-schema.ts";
import { expandTabletopHistory, tabletopHasFogDiffs } from "./fog-history.ts";
import { canonicalJson } from "./canonical-json.ts";
import { placeFromBox, tokenBox, tokenFootprint } from "./tabletop-geometry.ts";
import { hasItemDetails } from "./item-details.ts";

/**
 * The current tabletop table shape; 3 added compact fog history, continued brush strokes, fog
 * consolidation and the alternating diagonal (whose pending commands older apps cannot read).
 * Every client at protocol 3 or later reads that shape, so this stays 3.
 */
export const TABLETOP_PROTOCOL = 3;
/**
 * Transport protocol 4 (2026-10-22): the protocol 3 table shape, with each current shared map's
 * stored image sent as its `/art/room-image-<sha256>.webp` reference instead of the inline raster.
 * The client loads references through the seat-authorized GET /api/room-image/CODE/HASH and
 * restores the inline image before the table reaches the app. Protocols 0-3 (older websites and
 * APKs) keep receiving full inline envelopes.
 */
export const IMAGE_REFERENCE_PROTOCOL = 4;
/**
 * Protocol 5 (2026-10-23, Place hub): record placements may carry an optional pin `style`
 * ("icon" | "portrait"). Older clients have a strict placement schema, so protocols 0-4 receive
 * placements without it; their map saves keep the stored styles (world.ts map-save).
 */
export const PLACEMENT_STYLE_PROTOCOL = 5;
/**
 * Protocol 6 (2026-10-23, Journey planner): a map may carry an optional scale bar (`scale`) for
 * ungridded maps. Older clients have a strict map schema, so protocols 0-5 receive maps without
 * it; their map saves keep the stored scale (world.ts map-save).
 */
export const MAP_SCALE_PROTOCOL = 6;
/**
 * Protocol 7 (2026-10-23, Journey planner B): the world may carry party `journeys` and `travel`
 * settings. Older clients have a strict world schema, so protocols 0-6 receive the world without
 * them; their whole-journal writes keep them (journal.ts), and pending journey commands ask them
 * to finish on the updated website.
 */
export const JOURNEY_PROTOCOL = 7;
/**
 * Protocol 8 (2026-10-23, NPC services): an NPC may carry an optional `services` list. Older
 * clients have a strict NPC schema, so protocols 0-7 receive NPCs without it; their NPC saves and
 * whole-journal writes keep the stored list (world.ts npc-save, journal.ts), and pending service
 * commands ask them to finish on the updated website. `journal.services` itself is ignored by
 * older clients' journal parser, so it needs no stripping.
 */
export const SERVICES_PROTOCOL = 8;
/**
 * Protocol 9 (2026-10-24, NPC services wave 2): providers and NPC service lists may use the kinds
 * trainer, stable, courier, sage, fence, bank and hire, providers may carry `link` settings, and
 * offers, requests, terms and orders may carry wave-2 fields. Protocol 8 clients have strict
 * service schemas, so protocols 0-8 receive services without those providers, offers and orders
 * and NPC lists without the new kinds (also inside pending downtime quotes and archived reports);
 * their NPC saves and whole-journal writes keep the stored kinds (world.ts npc-save, journal.ts),
 * and their pending drafts with wave-2 service data ask them to finish on the updated website.
 */
export const SERVICES_WAVE2_PROTOCOL = 9;
/**
 * Protocol 10 (2026-10-25, split the party): the world may carry party `groups`, a `mainGroup`
 * label and `groupRequests`; character positions a `groupId` (and downtime a `returnGroupId`),
 * journeys a `groupId` and aboard records a `returnGroupId`. Older clients have strict world,
 * position, journey and fleet schemas, so protocols 0-9 receive the table without them (also
 * inside archived reports) and see every party member at the main group's place. Their
 * whole-journal writes keep the stored groups (journal.ts), the server refuses their actions for
 * characters outside the main group with an update message (`refuseOldClientGroupActions`), and
 * pending drafts with group commands ask them to finish on the updated website.
 */
export const PARTY_GROUPS_PROTOCOL = 10;
/**
 * Protocol 11 (2026-10-28, sectioned storage step 3): section-aware room sync. A protocol 11
 * client sends the section hashes it holds (`viewSections`); room views then carry the seat's
 * projected table with its large parts replaced by `null` and a `viewSections` manifest
 * (view-sections.ts), with the texts the client lacks inline up to a budget and the rest from
 * `readCloudSections`. The table content is exactly protocol 10's. Protocols 0-10 (bundled
 * Android apps, older tabs) receive the full view as before and never see a manifest.
 */
export const VIEW_SECTIONS_PROTOCOL = 11;
/**
 * Tabletop protocol 12 (history on demand, history-pages.ts): room views hold the working set, the
 * newest ledger and chat lines and archived sessions without their snapshots, with per-seat
 * cursors; earlier history comes from `readCloudHistory`. Protocols 0-11 receive the whole
 * campaign as before.
 */
export { HISTORY_PROTOCOL } from "./history-pages.ts";
/**
 * Protocol 13 (2026-10-29, map tokens: footprints and snapping): tokens may carry `sizeClass`,
 * `footprint` and `anchor: "corner"` (stored by their top-left square). Older clients have a strict
 * token schema, so protocols 0-12 receive footprint tokens in the centre form they know (the
 * centre square plus a half-square offset for even sizes) without those fields
 * (`centreFormToken`). Their token moves, token saves and map saves come back in that form and the
 * server converts them to the stored form before applying them (`upgradeFootprintCommands`);
 * their saves keep the fields. Pending drafts with footprint fields ask them to finish on the
 * updated website.
 */
export const FOOTPRINT_PROTOCOL = 13;
/**
 * Protocol 14 (2026-10-29, map tokens: grid mode): a map's tabletop settings may carry
 * `gridHidden` (the automatic grid of an ungridded map). Older clients have a strict tabletop
 * schema, so protocols 0-13 receive settings without it; their scene saves and map saves keep it
 * (`upgradeOldClientCommands`). Pending `map-grid-snap` drafts ask them to finish on the updated
 * website.
 */
export const GRID_MODE_PROTOCOL = 14;
/**
 * Protocol 15 (2026-10-29, map tokens: player movement): a map's tabletop settings may carry
 * `movement` ("auto" | "off" | "approval") and `lockedPurseIds`, and players may send
 * `map-token-claim`. Protocols 0-14 receive settings without the new fields (`playerMovement` is
 * kept in step with `movement`); their scene and map saves compare without them, keep them, and a
 * change to "Allow assigned-player token movement" sets Automatic or Off. Pending drafts with the
 * new fields or claims ask them to finish on the updated website. The movement rules, including
 * turns during combat, are enforced by the server for every protocol.
 */
export const PLAYER_MOVEMENT_PROTOCOL = 15;
/**
 * Protocol 16 (2026-10-29, map tokens: group placement): the tabletop session may carry the
 * party's default formation (`partyFormation`), and the DM may send `map-tokens-place` and
 * `map-tokens-edit`. Protocols 0-15 receive the session without it; their session saves compare
 * without it and keep it. Pending drafts with the new commands ask them to finish on the updated
 * website.
 */
export const GROUP_COMMANDS_PROTOCOL = 16;
/**
 * Protocol 17 (2026-10-29, map tokens: token follows view): the tabletop session may carry
 * `followView` ("Character tokens follow players' map view"), and players may send
 * `map-token-follow`. Protocols 0-16 receive the session without it; their session saves compare
 * without it and keep it. Pending drafts with the new command ask them to finish on the updated
 * website.
 */
export const FOLLOW_VIEW_PROTOCOL = 17;
/**
 * Protocol 18 (2026-10-29, map tokens: zones and the split rule): the world may carry `zones`,
 * `splitRule` and `zoneRequests`, and players may send `zone-request`, `zone-vote`,
 * `zone-request-withdraw` and `zone-request-resolve`; the DM `zone-save`. Protocols 0-17 receive
 * the world without them (their world saves keep them, journal.ts); the server still applies the
 * zone rules to their token follows. Drafts with the new commands ask them to finish on the
 * updated website.
 */
export const ZONES_PROTOCOL = 18;
/**
 * Protocol 19 (2026-10-29, map tokens: "Ask the DM" movement): the world may carry
 * `moveRequests`, and players may send `map-move-request` / `-withdraw`, the DM `-review`.
 * Protocols 0-18 receive the world without them (their world saves keep them); on an `approval`
 * map they can't move tokens (as on Off). Drafts with the new commands ask them to finish on the
 * updated website.
 */
export const MOVE_APPROVAL_PROTOCOL = 19;
/**
 * Protocol 21 (2026-11-04, XP and milestones): a character's play sheet (and its edit baseline
 * and change reports) may carry `xp` and `milestoneLevel`, and the DM may send `xp-award`.
 * Protocols 0-20 receive sheets without them. Their sheet edits and whole-purse writes come back
 * without them and the server keeps the stored values (`keepAdvancement`, `keepPurseAdvancement`).
 * Pending drafts with the new command or fields ask them to finish on the updated website.
 */
export const XP_PROTOCOL = 21;
/**
 * Protocol 24 (2026-11-04, item identification): the DM may send `item-unidentify` and
 * `item-identify`. A holding may carry `unidentified` (the presented record); holdings are not a
 * strict schema, so every protocol receives it, and players of every protocol receive unidentified
 * items already presented by the server (item-identity.ts). Older clients' holding saves keep the
 * record (commands.ts patch). Drafts with the new commands ask them to finish on the updated
 * website.
 */
export const ITEM_IDENTITY_PROTOCOL = 24;
/**
 * Protocol 25 (2026-11-04, black-market markup labels): the DM may send `black-market-markup`,
 * and the journal may carry `blackMarketMarkup` ("percentages"; missing means descriptions). The
 * top-level journal schema is not strict, so every protocol receives the table unchanged (older
 * clients drop the key); their whole-journal writes keep the stored value (journal.ts). Drafts
 * with the new command ask them to finish on the updated website.
 */
export const MARKET_MARKUP_PROTOCOL = 25;
/**
 * Protocol 26 (2026-11-05, named market events): the DM may send `market-event` and
 * `market-event-end`, and the journal may carry `marketEvents` (and, on a player's copy,
 * `marketAdjustments`; market-events.ts). The top-level
 * journal schema is not strict, so every protocol receives the table unchanged (older clients drop
 * the key and price without events until they update, so the server refuses their purchases,
 * sales and deliveries whose price an event changes: `marketEventsUnsupported`); their
 * whole-journal writes keep the stored events (journal.ts). Drafts with the new commands ask them
 * to finish on the updated website.
 */
export const MARKET_EVENTS_PROTOCOL = 26;
/**
 * Protocol 27 (2026-11-05, return to party): the DM may send `loot-return` (loot-return.ts). It
 * adds no stored field, but a turn-based DM seat's staged draft reaches every device on that seat,
 * and older clients' strict command schema rejects the unknown kind. Drafts with it ask them to
 * finish on the updated website. (26 is reserved for market events, 28 for another feature.)
 */
export const LOOT_RETURN_PROTOCOL = 27;
/**
 * Protocol 28 (2026-11-05, award item details): the DM's `npc-item` may carry the item's `uses`,
 * `requiresAttunement` and `unidentified` (item-details.ts). Older clients parse `npc-item` with a
 * strict item schema, so drafts with those fields ask them to finish on the updated website.
 * The holdings it creates are not a strict schema, so every protocol receives them (players
 * already presented). Encounter loot and Add loot need no protocol: they reach the room as an
 * award or a holding `patch`, which older clients read.
 */
export const AWARD_DETAILS_PROTOCOL = 28;
/**
 * Protocol 29 (2026-11-05, factions, renown and favor): the DM may send `faction-save`,
 * `faction-visibility`, `faction-delete`, `faction-renown` and `faction-favor-grant`, and the
 * journal may carry `factions` (and, on a player's copy, `factionAdjustments`; factions.ts). The
 * top-level journal schema is not strict, so every protocol receives the table unchanged (older
 * clients drop the key and price without faction standing, so the server refuses their purchases,
 * sales and deliveries whose price a faction changes: `factionsUnsupported`); their whole-journal
 * writes keep the stored factions (journal.ts). Drafts with the new commands ask them to finish on
 * the updated website.
 */
export const FACTIONS_PROTOCOL = 29;
/**
 * Protocol 30 (2026-11-05, the favor market; favor-market.ts): players may send `favor-request`
 * and `favor-withdraw`, and the DM `favor-entry`, `favor-decision` and `favor-purchase`. The new
 * fields live on faction records (`favorMarket`, `favorRequests`), which protocol 29 parses with
 * unknown keys stripped and whose stored copy the server keeps, so every protocol receives the
 * table unchanged. Only drafts with the new commands (strict command schema) ask protocol 29 and
 * older to finish on the updated website.
 */
export const FAVOR_MARKET_PROTOCOL = 30;
/**
 * Protocol 31 (2026-11-05, quests and renown; quests.ts): the DM may send `quest-renown` (a quest's
 * giver faction and renown rewards), and quests may carry `giverFactionId`, `renownRewards` and
 * `renownAppliedAt`. Stored quests are parsed with unknown keys stripped and the server keeps its
 * copy, so every protocol receives the table unchanged; completing a quest applies its rewards on
 * the server whichever app sends `quest-close`. Only drafts with `quest-renown` (strict command
 * schema) ask protocol 30 and older to finish on the updated website.
 */
export const QUEST_RENOWN_PROTOCOL = 31;
/**
 * Protocol 32 (2026-11-10, settlement limits; settlements.ts S2): the DM may send
 * `settlement-limits`, and settlement profiles may carry `saleLimit` and `maxRarity`. The stored
 * settlements stay in the non-strict journal key (older clients strip what they don't know and the
 * server keeps its copy), so every protocol receives the table unchanged. Older apps price sales
 * without the settlement's per-item cap, so the server refuses their sales whose payout the cap
 * lowers (`settlementLimitsUnsupported`; a refused item is refused for every app). Drafts with any
 * `settlement-*` command (S1's too: apps before S1 can't parse them) ask protocol 31 and older to
 * finish on the updated website.
 */
export const SETTLEMENT_LIMITS_PROTOCOL = 32;
/** The protocol current clients declare. */
export const CURRENT_TABLETOP_PROTOCOL = SETTLEMENT_LIMITS_PROTOCOL;
/** Server-only, non-enumerable: inline image -> its stored reference for this room read. */
export const ROOM_IMAGE_SOURCES_KEY = Symbol.for("lootsplit.room-view-image-sources");

const commands = new Set([
  "tabletop-session",
  "map-tabletop",
  "map-token-move",
  "map-fog",
  "map-template",
  "map-render",
  "map-grid-snap",
  "map-token-claim",
  "map-token-follow",
]);
/**
 * Tabletop protocol 2 and older apps (Android 1.10.0 and earlier) have no `alternating` diagonal
 * rule; they see such grids as "One tile per diagonal step" (`equal`). Stored grids are unchanged,
 * and their saves and token moves are accepted against this form (see world.ts / tabletop.ts).
 */
export function legacyDiagonals<T>(value: T): T {
  if (!value || typeof value !== "object" || !JSON.stringify(value).includes('"alternating"'))
    return value;
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(walk);
    if (!item || typeof item !== "object") return item;
    const record = Object.fromEntries(
      Object.entries(item).map(([key, entry]) => [key, walk(entry)]),
    );
    if (
      record.diagonal === "alternating" &&
      typeof record.columns === "number" &&
      typeof record.rows === "number"
    )
      record.diagonal = "equal";
    return record;
  };
  return walk(value) as T;
}
export function legacyTabletopToken(token: MapToken): MapToken {
  const result = { ...centreFormToken(token) };
  delete result.locked;
  delete result.controllerPurseIds;
  delete result.offsetX;
  delete result.offsetY;
  delete result.style;
  delete result.vision;
  return result;
}
/** Protocol 2: fog undo/redo history as full snapshots instead of compact diffs. */
export function fogSnapshotMap(map: CampaignMap): CampaignMap {
  if (!map.tabletop || !tabletopHasFogDiffs(map.tabletop)) return map;
  return { ...map, tabletop: expandTabletopHistory(map.tabletop) };
}
/** A map without placement pin styles (protocols 0-4). The same object when there are none. */
export function withoutPlacementStyles(map: CampaignMap): CampaignMap {
  if (!map.connected?.placements.some((p) => p.style !== undefined)) return map;
  return {
    ...map,
    connected: {
      ...map.connected,
      placements: map.connected.placements.map((p) => {
        const plain = { ...p };
        delete plain.style;
        return plain;
      }),
    },
  };
}
/** A map without its scale bar (protocols 0-5). The same object when it has none. */
export function withoutMapScale(map: CampaignMap): CampaignMap {
  if (map.scale === undefined) return map;
  const plain = { ...map };
  delete plain.scale;
  return plain;
}
/** Whether a table (or a stored backup body) holds a map scale bar. */
export function hasMapScales(table: CloudTable): boolean {
  return (
    !!table.journal?.world?.maps.some((m) => m.scale) ||
    !!table.journal?.reports?.some((r) => mapScaled(r.snapshot ?? ""))
  );
}
const mapScaled = (text: string) => text.includes('"scale":{') && text.includes('"aspect"');
function scaleFreeTable(table: CloudTable): CloudTable {
  if (!hasMapScales(table)) return table;
  const world = table.journal?.world;
  const reports = table.journal?.reports?.map((report) => {
    if (!mapScaled(report.snapshot ?? "")) return report;
    try {
      return {
        ...report,
        snapshot: JSON.stringify(scaleFreeTable(JSON.parse(report.snapshot))),
      };
    } catch {
      return report; // Preserve existing unreadable-archive evidence for the recovery reader.
    }
  });
  return {
    ...table,
    journal: {
      ...table.journal!,
      ...(world ? { world: { ...world, maps: world.maps.map(withoutMapScale) } } : {}),
      ...(reports ? { reports } : {}),
    },
  };
}
/** Whether a table (or a stored backup body) holds journeys or travel settings. */
export function hasJourneys(table: CloudTable): boolean {
  const world = table.journal?.world;
  return (
    world?.journeys !== undefined ||
    world?.travel !== undefined ||
    !!table.journal?.reports?.some((r) => journeyed(r.snapshot ?? ""))
  );
}
const journeyed = (text: string) => text.includes('"journeys":') || text.includes('"travel":{');
function journeyFreeTable(table: CloudTable): CloudTable {
  if (!hasJourneys(table)) return table;
  const world = table.journal?.world;
  const reports = table.journal?.reports?.map((report) => {
    if (!journeyed(report.snapshot ?? "")) return report;
    try {
      return { ...report, snapshot: JSON.stringify(journeyFreeTable(JSON.parse(report.snapshot))) };
    } catch {
      return report; // Preserve existing unreadable-archive evidence for the recovery reader.
    }
  });
  let plainWorld = world;
  if (world && (world.journeys !== undefined || world.travel !== undefined)) {
    plainWorld = { ...world };
    delete plainWorld.journeys;
    delete plainWorld.travel;
  }
  return {
    ...table,
    journal: {
      ...table.journal!,
      ...(plainWorld ? { world: plainWorld } : {}),
      ...(reports ? { reports } : {}),
    },
  };
}
// Protocol 9 (services wave 2). Field names protocol 8's strict service schemas know.
const wave2Kinds = ["trainer", "stable", "courier", "sage", "fence", "bank", "hire"];
const wave2Pattern = new RegExp(`("kind":|"services":\\[[^\\]]*)"(${wave2Kinds.join("|")})"`);
const legacyKeys = {
  provider: ["id", "kind", "preset", "specialty", "shopId", "npcId", "name", "description", "paused", "reviewAboveCopper", "settlement", "offers", "rumours"],
  offer: ["key", "name", "description", "approved", "priceCopper", "spellLevel", "time", "review", "maxUnits", "components", "output", "tiers"],
  order: ["id", "providerId", "offerKey", "purseId", "request", "terms", "orderedDay", "orderedMinute", "progressDays", "status", "paidDay", "paidMinute", "completedDay", "completedMinute", "claimedDay", "message", "history"],
  request: ["beneficiaryPurseIds", "units", "contributions", "inn"],
  terms: ["kind", "providerName", "specialty", "npcId", "npcName", "shopId", "shopName", "locationId", "placeName", "offer", "units", "beneficiaries", "inn", "components", "lines", "priceCopper", "review", "workDays", "settlement"],
  time: ["instant", "downtime-days", "per-night"],
};
const legacyKind = (k: unknown) => k === "temple" || k === "workshop" || k === "inn";
const only = (value: unknown, keys: string[]) =>
  !!value && typeof value === "object" && Object.keys(value).every((k) => keys.includes(k));
const legacyOffer = (o: { time?: { kind?: string } }) =>
  only(o, legacyKeys.offer) && legacyKeys.time.includes(o.time?.kind ?? "");
/** Whether text (a command, a backup body) holds wave-2 service kinds or fields. */
export function wave2Text(text: string) {
  return wave2Pattern.test(text) || /"(itemHoldingId|reveal|lessonOrderId)":|"target":"held-item"|"fare":\{|"kind":"fare"/.test(text);
}
/** A services object as protocol 8 reads it: wave-1 providers, offers and orders only. */
export function wave1Services<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  const s = value as { providers?: Record<string, unknown>[]; orders?: Record<string, unknown>[] };
  return {
    ...s,
    providers: (s.providers ?? [])
      .filter((p) => legacyKind(p.kind))
      .map((p) => {
        const plain: Record<string, unknown> = {};
        for (const k of legacyKeys.provider) if (p[k] !== undefined) plain[k] = p[k];
        plain.offers = ((p.offers as Record<string, unknown>[]) ?? []).filter(legacyOffer);
        return plain;
      }),
    orders: (s.orders ?? []).filter(
      (o) =>
        only(o, legacyKeys.order) &&
        only(o.request, legacyKeys.request) &&
        only(o.terms, legacyKeys.terms) &&
        legacyKind((o.terms as { kind?: string }).kind) &&
        legacyOffer((o.terms as { offer: { time?: { kind?: string } } }).offer),
    ),
  } as T;
}
const wave1Kinds = (services: string[]) => services.filter(legacyKind);
/** Whether a table (or a stored backup body) holds wave-2 service data. */
export function hasWave2Services(table: CloudTable): boolean {
  const s = table.journal?.services;
  const quotes = (table.journal?.finance as { downtime?: { quote?: { services?: { state?: unknown } } }[] } | undefined)
    ?.downtime;
  return (
    !!table.journal?.world?.journeys?.some((j) => j.costs.fare) ||
    !!quotes?.some((d) => (d.quote as { journey?: { lines?: { kind: string }[] } } | undefined)?.journey?.lines?.some((l) => l.kind === "fare")) ||
    !!table.journal?.world?.npcs?.some((n) => n.services?.some((k) => !legacyKind(k))) ||
    (!!s && JSON.stringify(wave1Services(s)) !== JSON.stringify(s)) ||
    !!quotes?.some((d) => d.quote?.services?.state && wave2Text(JSON.stringify(d.quote.services.state))) ||
    !!table.journal?.reports?.some((r) => wave2Text(r.snapshot ?? ""))
  );
}
function wave1Table(table: CloudTable): CloudTable {
  if (!hasWave2Services(table)) return table;
  const journal = table.journal!;
  const world = journal.world;
  const reports = journal.reports?.map((report) => {
    if (!wave2Text(report.snapshot ?? "")) return report;
    try {
      return { ...report, snapshot: JSON.stringify(wave1Table(JSON.parse(report.snapshot))) };
    } catch {
      return report; // Preserve existing unreadable-archive evidence for the recovery reader.
    }
  });
  const finance = journal.finance as (typeof journal.finance & { downtime?: { quote?: { services?: { state?: unknown } } }[] }) | undefined;
  return {
    ...table,
    journal: {
      ...journal,
      ...(journal.services ? { services: wave1Services(journal.services) } : {}),
      ...(finance?.downtime?.some((d) => d.quote?.services || (d.quote as { journey?: unknown } | undefined)?.journey)
        ? {
            finance: {
              ...finance,
              downtime: finance.downtime.map((d) => {
                let quote = d.quote as (typeof d.quote & { journey?: { lines: { kind: string }[] } }) | undefined;
                if (quote?.services?.state)
                  quote = { ...quote, services: { ...quote.services, state: wave1Services(quote.services.state) } };
                // Protocol 8 journey quotes know rations and mounts only (the coach fare is wave 2).
                if (quote?.journey?.lines.some((l) => l.kind === "fare"))
                  quote = { ...quote, journey: { ...quote.journey, lines: quote.journey.lines.filter((l) => l.kind !== "fare") } };
                return quote === d.quote ? d : { ...d, quote };
              }),
            } as typeof journal.finance,
          }
        : {}),
      ...(world?.npcs
        ? {
            world: {
              ...world,
              npcs: world.npcs.map((n) =>
                n.services?.some((k) => !legacyKind(k)) ? { ...n, services: wave1Kinds(n.services) as typeof n.services } : n,
              ),
              // A coach fare is a wave-2 journey cost (protocol 8 has a strict costs schema).
              ...(world.journeys?.some((j) => j.costs.fare)
                ? {
                    journeys: world.journeys.map((j) => {
                      if (!j.costs.fare) return j;
                      const costs = { ...j.costs };
                      delete costs.fare;
                      return { ...j, costs };
                    }),
                  }
                : {}),
            },
          }
        : {}),
      ...(reports ? { reports } : {}),
    },
  };
}
const serviced = (text: string) => /"services":\["(temple|workshop|inn)"/.test(text) || text.includes('"services":[]');
/** Whether a table (or a stored backup body) holds NPC service lists. */
export function hasNpcServices(table: CloudTable): boolean {
  return (
    !!table.journal?.world?.npcs?.some((n) => n.services !== undefined) ||
    !!table.journal?.reports?.some((r) => serviced(r.snapshot ?? ""))
  );
}
function serviceFreeTable(table: CloudTable): CloudTable {
  if (!hasNpcServices(table)) return table;
  const world = table.journal?.world;
  const reports = table.journal?.reports?.map((report) => {
    if (!serviced(report.snapshot ?? "")) return report;
    try {
      return { ...report, snapshot: JSON.stringify(serviceFreeTable(JSON.parse(report.snapshot))) };
    } catch {
      return report; // Preserve existing unreadable-archive evidence for the recovery reader.
    }
  });
  return {
    ...table,
    journal: {
      ...table.journal!,
      ...(world?.npcs
        ? {
            world: {
              ...world,
              npcs: world.npcs.map((n) => {
                if (n.services === undefined) return n;
                const plain = { ...n };
                delete plain.services;
                return plain;
              }),
            },
          }
        : {}),
      ...(reports ? { reports } : {}),
    },
  };
}
// Token styles are objects; only placement styles are these strings.
const placementStyled = (text: string) =>
  text.includes('"placements"') && /"style":"(icon|portrait)"/.test(text);
/** Whether a table (or a stored backup body) holds placement pin styles. */
export function hasPlacementStyles(table: CloudTable): boolean {
  return (
    !!table.journal?.world?.maps.some((m) => m.connected?.placements.some((p) => p.style)) ||
    !!table.journal?.reports?.some((r) => placementStyled(r.snapshot ?? ""))
  );
}
function styleFreeTable(table: CloudTable): CloudTable {
  if (!hasPlacementStyles(table)) return table;
  const world = table.journal?.world;
  const reports = table.journal?.reports?.map((report) => {
    if (!placementStyled(report.snapshot ?? "")) return report;
    try {
      return {
        ...report,
        snapshot: JSON.stringify(styleFreeTable(JSON.parse(report.snapshot))),
      };
    } catch {
      return report; // Preserve existing unreadable-archive evidence for the recovery reader.
    }
  });
  return {
    ...table,
    journal: {
      ...table.journal!,
      ...(world ? { world: { ...world, maps: world.maps.map(withoutPlacementStyles) } } : {}),
      ...(reports ? { reports } : {}),
    },
  };
}
export function previousTabletopMap(map: CampaignMap): CampaignMap {
  const result = { ...map };
  delete result.connected;
  return result;
}
export function legacyTabletopMap(map: CampaignMap): CampaignMap {
  const result = previousTabletopMap(map);
  delete result.tabletop;
  if (map.tokens) result.tokens = map.tokens.map(legacyTabletopToken);
  return result;
}
/** Applied after seat/privacy projection. Older APKs have strict map/token schemas. */
export function legacyTabletopTable(table: CloudTable): CloudTable {
  return tableForProtocol(table, 0);
}
// Protocol 10 (split the party).
const groupKinds = [
  "party-split",
  "party-group-edit",
  "party-group-assign",
  "party-merge",
  "party-group-request",
  "party-group-request-withdraw",
  "party-group-request-review",
  "ship-board-group",
];
const grouped = (text: string) =>
  /"(groups|groupRequests|journeyIds)":\[|"mainGroup":\{|"(groupId|returnGroupId)":"/.test(text);
/** Whether a table (or a stored backup body) holds split-the-party data. */
export function hasPartyGroups(table: CloudTable): boolean {
  const w = table.journal?.world;
  return (
    w?.groups !== undefined ||
    w?.mainGroup !== undefined ||
    w?.groupRequests !== undefined ||
    !!w?.characterPositions?.some((s) => s.groupId !== undefined || s.downtime?.returnGroupId !== undefined) ||
    !!w?.journeys?.some((j) => j.groupId !== undefined) ||
    !!table.journal?.fleet?.aboard?.some((a) => a.returnGroupId !== undefined) ||
    !!(table.journal?.finance as { downtime?: { quote?: { journeys?: unknown } }[] } | undefined)?.downtime?.some((d) => d.quote?.journeys !== undefined) ||
    !!table.journal?.reports?.some((r) => grouped(r.snapshot ?? ""))
  );
}
/** The table as protocol 9 reads it: one party at the main group's place. */
function groupFreeTable(table: CloudTable): CloudTable {
  if (!hasPartyGroups(table)) return table;
  const journal = table.journal!;
  const world = journal.world;
  const reports = journal.reports?.map((report) => {
    if (!grouped(report.snapshot ?? "")) return report;
    try {
      return { ...report, snapshot: JSON.stringify(groupFreeTable(JSON.parse(report.snapshot))) };
    } catch {
      return report; // Preserve existing unreadable-archive evidence for the recovery reader.
    }
  });
  let plainWorld = world;
  if (world) {
    plainWorld = { ...world };
    delete plainWorld.groups;
    delete plainWorld.mainGroup;
    delete plainWorld.groupRequests;
    plainWorld.characterPositions = world.characterPositions.map((s) => {
      if (s.groupId === undefined && s.downtime?.returnGroupId === undefined) return s;
      const plain = { ...s };
      // A group aboard a ship stays in the party; protocol 9 knows only characters aboard alone.
      if (s.inParty && journal.fleet?.aboard?.some((a) => a.purseId === s.purseId)) plain.inParty = false;
      delete plain.groupId;
      if (plain.downtime) {
        const downtime = { ...plain.downtime };
        delete downtime.returnGroupId;
        plain.downtime = downtime;
      }
      return plain;
    });
    // Another group's journeys would break "one open journey" for older apps.
    if (world.journeys)
      plainWorld.journeys = world.journeys
        .filter((j) => j.groupId === undefined);
  }
  const fleet = journal.fleet;
  const atSea = new Set(
    (world?.characterPositions ?? []).filter((s) => s.inParty && s.groupId && fleet?.aboard?.some((a) => a.purseId === s.purseId)).map((s) => s.purseId),
  );
  const finance = journal.finance as (typeof journal.finance & { downtime?: { quote?: { journeys?: unknown } }[] }) | undefined;
  return {
    ...table,
    ...(atSea.size
      ? { purses: table.purses.map((p) => (atSea.has(p.id) && p.control === "npc" ? { ...p, nonParty: true } : p)) }
      : {}),
    journal: {
      ...journal,
      // Further groups' journeys in a pending downtime quote (protocol 9 quotes hold one).
      ...(finance?.downtime?.some((d) => d.quote?.journeys !== undefined)
        ? {
            finance: {
              ...finance,
              downtime: finance.downtime.map((d) => {
                if (d.quote?.journeys === undefined) return d;
                const quote = { ...d.quote };
                delete quote.journeys;
                return { ...d, quote };
              }),
            } as typeof journal.finance,
          }
        : {}),
      ...(plainWorld ? { world: plainWorld } : {}),
      ...(fleet?.aboard?.some((a) => a.returnGroupId !== undefined)
        ? {
            fleet: {
              ...fleet,
              aboard: fleet.aboard.map((a) => {
                if (a.returnGroupId === undefined) return a;
                const plain = { ...a };
                delete plain.returnGroupId;
                return plain;
              }),
            },
          }
        : {}),
      ...(reports ? { reports } : {}),
    },
  };
}
/** Whether a pending command (as JSON) carries split-the-party data older apps can't read. */
export function groupCommandText(c: { kind?: unknown }) {
  return (typeof c.kind === "string" && groupKinds.includes(c.kind)) || grouped(JSON.stringify(c));
}
/**
 * Protocol 9 and older apps act as if the party were whole. While it is split, the server
 * refuses their actions for a character outside the main group (the acting character, the
 * paying purse or the owner of the item), with an update message. Nothing is changed.
 */
export function refuseOldClientGroupActions(
  table: Pick<CloudTable, "journal" | "purses" | "holdings">,
  commands: { kind: string }[],
) {
  const w = table.journal?.world;
  if (!w?.groups?.some((g) => g.status === "active")) return;
  for (const c of commands) {
    const fields = c as Record<string, unknown>;
    const ids = [fields.purseId, fields.actorId, fields.payerId, fields.senderId, fields.trainerId]
      .concat(typeof fields.holdingId === "string" ? [table.holdings.find((h) => h.id === fields.holdingId)?.purseId] : [])
      .filter((id): id is string => typeof id === "string");
    for (const id of ids) {
      const s = w.characterPositions.find((x) => x.purseId === id);
      if (s?.inParty && s.groupId && w.groups.some((g) => g.id === s.groupId && g.status === "active")) {
        const name = table.purses.find((p) => p.id === id)?.name ?? "this character";
        throw Error(`The party is split into groups. Update Lootsplitter to act for ${name}.`);
      }
    }
  }
}
// Protocol 13 (footprints and snapping).
const footprintFields = ["sizeClass", "footprint", "anchor"] as const;
const hasFootprint = (token: Partial<MapToken> | null | undefined) =>
  !!token && footprintFields.some((key) => token[key] !== undefined);
const footprinted = (text: string) => /"(sizeClass|footprint|anchor)":/.test(text);
/**
 * A token as protocols 0-12 read it: without its size fields, and a corner-anchored footprint
 * token at its centre square (plus half a square for even sizes), so older apps draw it at its
 * true centre. The same object when the token has no footprint fields.
 */
export function centreFormToken(token: MapToken): MapToken {
  if (!hasFootprint(token)) return token;
  const result = { ...token };
  for (const key of footprintFields) delete result[key];
  delete result.offsetX;
  delete result.offsetY;
  const box = tokenBox(token),
    n = tokenFootprint(token),
    x = box.left + (n - 1) / 2,
    y = box.top + (n - 1) / 2,
    column = Math.floor(x + 0.5 - 1e-9),
    row = Math.floor(y + 0.5 - 1e-9),
    offsetX = Math.round((x - column) * 1e6) / 1e6,
    offsetY = Math.round((y - row) * 1e6) / 1e6;
  if (n < 1 || n === 1) {
    if (token.offsetX !== undefined) result.offsetX = token.offsetX;
    if (token.offsetY !== undefined) result.offsetY = token.offsetY;
    return result;
  }
  return {
    ...result,
    column,
    row,
    ...(offsetX ? { offsetX } : {}),
    ...(offsetY ? { offsetY } : {}),
  };
}
/** Whether a table (or a stored backup body) holds footprint tokens. */
export function hasFootprintTokens(table: CloudTable): boolean {
  return (
    !!table.journal?.world?.maps.some((m) => m.tokens?.some(hasFootprint)) ||
    !!table.journal?.reports?.some((r) => footprinted(r.snapshot ?? ""))
  );
}
function footprintFreeTable(table: CloudTable): CloudTable {
  if (!hasFootprintTokens(table)) return table;
  const world = table.journal?.world;
  const reports = table.journal?.reports?.map((report) => {
    if (!footprinted(report.snapshot ?? "")) return report;
    try {
      return { ...report, snapshot: JSON.stringify(footprintFreeTable(JSON.parse(report.snapshot))) };
    } catch {
      return report; // Preserve existing unreadable-archive evidence for the recovery reader.
    }
  });
  return {
    ...table,
    journal: {
      ...table.journal!,
      ...(world
        ? {
            world: {
              ...world,
              maps: world.maps.map((m) =>
                m.tokens?.some(hasFootprint) ? { ...m, tokens: m.tokens.map(centreFormToken) } : m,
              ),
            },
          }
        : {}),
      ...(reports ? { reports } : {}),
    },
  };
}
/** Whether a pending command (as JSON) carries footprint fields older apps can't read. */
export function footprintCommandText(c: unknown) {
  return footprinted(JSON.stringify(c));
}
type Place = { column: number; row: number; offsetX?: number; offsetY?: number };
const samePlace = (a: Place, b: Place) =>
  a.column === b.column &&
  a.row === b.row &&
  (a.offsetX ?? 0) === (b.offsetX ?? 0) &&
  (a.offsetY ?? 0) === (b.offsetY ?? 0);
const sameJson = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
/** A centre-form position (older apps) of a stored footprint token, in its stored form. */
function storedPlace(stored: MapToken, centre: Place, snap: boolean): Place {
  const n = tokenFootprint(stored);
  if (stored.anchor !== "corner" || n <= 1) return centre;
  const left = centre.column + (centre.offsetX ?? 0) - (n - 1) / 2,
    top = centre.row + (centre.offsetY ?? 0) - (n - 1) / 2;
  // An even footprint has no centre square: with grid mode on an older app cannot express a
  // snapped position for it, and the server never picks a square on its behalf.
  if (snap && (Math.abs(left - Math.round(left)) > 1e-6 || Math.abs(top - Math.round(top)) > 1e-6))
    throw Error(`Update Lootsplitter to move ${stored.label} on this map.`);
  const place = placeFromBox(stored, left, top);
  return {
    column: place.column,
    row: place.row,
    ...(place.offsetX ? { offsetX: place.offsetX } : {}),
    ...(place.offsetY ? { offsetY: place.offsetY } : {}),
  };
}
/** The token an older app saved (centre form, maybe without tabletop fields), in stored form. */
function storedToken(stored: MapToken, sent: MapToken, snap: boolean): MapToken {
  if (sent.anchor !== undefined || sent.kind !== stored.kind || sent.entityId !== stored.entityId)
    return sent;
  const result: MapToken = { ...sent };
  delete result.offsetX;
  delete result.offsetY;
  for (const key of footprintFields) if (stored[key] !== undefined) Object.assign(result, { [key]: stored[key] });
  return { ...result, ...storedPlace(stored, sent, snap) };
}
/**
 * Protocols 0-12 send footprint tokens in their centre form. Before a batch from such a client is
 * applied, the server rewrites its token moves, token saves and map saves into the stored form
 * (against the current table). Nothing else changes; commands about other tokens are untouched.
 */
export function upgradeFootprintCommands<C extends { kind: string }>(table: CloudTable, commands: C[]): C[] {
  const maps = table.journal?.world?.maps ?? [];
  if (!maps.some((m) => m.tokens?.some(hasFootprint))) return commands;
  return commands.map((command) => {
    const c = command as C & Record<string, unknown>;
    const map = maps.find((m) => m.id === c.mapId);
    const snap = (map?.tabletop as { snap?: boolean } | undefined)?.snap ?? true;
    if (!map?.tokens?.some(hasFootprint)) return command;
    const stored = (id: unknown) => map.tokens!.find((t) => t.id === id && hasFootprint(t));
    if (c.kind === "map-token-move") {
      const moves = (c.moves as { tokenId: string; before: Place; after: Place }[]).map((move) => {
        const token = stored(move.tokenId);
        if (!token || !samePlace(centreFormToken(token), move.before)) return move;
        const before: Place = { column: token.column, row: token.row };
        if (token.offsetX !== undefined) before.offsetX = token.offsetX;
        if (token.offsetY !== undefined) before.offsetY = token.offsetY;
        return { ...move, before, after: storedPlace(token, move.after, snap) };
      });
      return { ...c, moves };
    }
    if (c.kind === "map-token") {
      const token = stored(c.tokenId);
      if (!token) return command;
      const before = c.before as MapToken | null;
      // Protocols 1-12 sent the centre form; protocol 0 the centre form without tabletop fields,
      // which world.ts already accepts as legacyTabletopToken(current) and merges.
      const fromCentre = sameJson(centreFormToken(token), before);
      if (!fromCentre && !sameJson(legacyTabletopToken(token), before)) return command;
      const sent = c.token as MapToken | null;
      return { ...c, before: fromCentre ? token : before, token: sent && storedToken(token, sent, snap) };
    }
    if (c.kind === "map-save") {
      const before = c.before as CampaignMap | null,
        sent = c.map as CampaignMap | null;
      const restore = (list: MapToken[] | undefined, previous: boolean) =>
        list?.map((t) => {
          const s = stored(t.id);
          if (!s) return t;
          if (previous) return sameJson(centreFormToken(s), t) ? s : t;
          return storedToken(s, t, snap);
        });
      return {
        ...c,
        ...(before?.tokens ? { before: { ...before, tokens: restore(before.tokens, true) } } : {}),
        ...(sent?.tokens ? { map: { ...sent, tokens: restore(sent.tokens, false) } } : {}),
      };
    }
    return command;
  });
}
// Protocol 14 (grid mode).
const gridHiddenText = (text: string) => text.includes('"gridHidden":');
/** Tabletop settings without the hidden-grid flag (protocols 0-13). The same object without it. */
export function withoutGridHidden<T>(settings: T): T {
  if (!settings || typeof settings !== "object" || !("gridHidden" in settings)) return settings;
  const plain = { ...settings } as T & { gridHidden?: boolean };
  delete plain.gridHidden;
  return plain;
}
/** Whether a table (or a stored backup body) holds hidden automatic grids. */
export function hasHiddenGrids(table: CloudTable): boolean {
  return (
    !!table.journal?.world?.maps.some((m) => m.tabletop?.gridHidden !== undefined) ||
    !!table.journal?.reports?.some((r) => gridHiddenText(r.snapshot ?? ""))
  );
}
function gridHiddenFreeTable(table: CloudTable): CloudTable {
  if (!hasHiddenGrids(table)) return table;
  const world = table.journal?.world;
  const reports = table.journal?.reports?.map((report) => {
    if (!gridHiddenText(report.snapshot ?? "")) return report;
    try {
      return { ...report, snapshot: JSON.stringify(gridHiddenFreeTable(JSON.parse(report.snapshot))) };
    } catch {
      return report; // Preserve existing unreadable-archive evidence for the recovery reader.
    }
  });
  return {
    ...table,
    journal: {
      ...table.journal!,
      ...(world
        ? {
            world: {
              ...world,
              maps: world.maps.map((m) =>
                m.tabletop?.gridHidden !== undefined ? { ...m, tabletop: withoutGridHidden(m.tabletop) } : m,
              ),
            },
          }
        : {}),
      ...(reports ? { reports } : {}),
    },
  };
}
/**
 * Older clients can't see some tabletop settings fields: their scene saves (`map-tabletop`) and
 * map saves are compared against the settings without them (`strip`) and keep them (`restore`).
 * Commands about other maps are untouched.
 */
function upgradeSettingsCommands<C extends { kind: string }>(
  table: CloudTable,
  commands: C[],
  hidden: (settings: NonNullable<CampaignMap["tabletop"]>) => boolean,
  strip: <T>(settings: T) => T,
  restore: (sent: Record<string, unknown>, current: NonNullable<CampaignMap["tabletop"]>) => Record<string, unknown>,
): C[] {
  const maps = table.journal?.world?.maps ?? [];
  if (!maps.some((m) => m.tabletop && hidden(m.tabletop))) return commands;
  return commands.map((command) => {
    const c = command as C & Record<string, unknown>;
    const map = maps.find((m) => m.id === c.mapId);
    const current = map?.tabletop;
    if (!current || !hidden(current)) return command;
    // Protocol 2 sent full-snapshot fog history; tabletop.ts accepts either form.
    const forms = [current, expandTabletopHistory(current)];
    const match = (sent: unknown) => forms.find((form) => sameJson(strip(form), sent));
    const keep = (next: unknown) =>
      next && typeof next === "object" ? restore(next as Record<string, unknown>, current) : next;
    if (c.kind === "map-tabletop") {
      const before = match(c.before);
      return before ? { ...c, before, settings: keep(c.settings) } : command;
    }
    if (c.kind === "map-save") {
      const before = c.before as CampaignMap | null,
        sent = c.map as CampaignMap | null;
      const found = before?.tabletop && match(before.tabletop);
      if (!found) return command;
      return {
        ...c,
        before: { ...before, tabletop: found },
        ...(sent?.tabletop ? { map: { ...sent, tabletop: keep(sent.tabletop) } } : {}),
      };
    }
    return command;
  });
}
const upgradeGridHiddenCommands = <C extends { kind: string }>(table: CloudTable, commands: C[]) =>
  upgradeSettingsCommands(
    table,
    commands,
    (t) => t.gridHidden !== undefined,
    withoutGridHidden,
    (sent, current) => ("gridHidden" in sent ? sent : { ...sent, gridHidden: current.gridHidden }),
  );
// Protocol 15 (player movement).
const movementText = (text: string) => /"movement":"(auto|off|approval)"|"lockedPurseIds":\[/.test(text);
/** Tabletop settings without `movement` and `lockedPurseIds` (protocols 0-14). */
export function withoutMovement<T>(settings: T): T {
  if (!settings || typeof settings !== "object" || (!("movement" in settings) && !("lockedPurseIds" in settings)))
    return settings;
  const plain = { ...settings } as T & { movement?: unknown; lockedPurseIds?: unknown };
  delete plain.movement;
  delete plain.lockedPurseIds;
  return plain;
}
const hasMovementFields = (t: NonNullable<CampaignMap["tabletop"]>) =>
  t.movement !== undefined || t.lockedPurseIds !== undefined;
/** Whether a table (or a stored backup body) holds the movement choice or movement locks. */
export function hasMovementSettings(table: CloudTable): boolean {
  return (
    !!table.journal?.world?.maps.some((m) => m.tabletop && hasMovementFields(m.tabletop)) ||
    !!table.journal?.reports?.some((r) => movementText(r.snapshot ?? ""))
  );
}
function movementFreeTable(table: CloudTable): CloudTable {
  if (!hasMovementSettings(table)) return table;
  const world = table.journal?.world;
  const reports = table.journal?.reports?.map((report) => {
    if (!movementText(report.snapshot ?? "")) return report;
    try {
      return { ...report, snapshot: JSON.stringify(movementFreeTable(JSON.parse(report.snapshot))) };
    } catch {
      return report; // Preserve existing unreadable-archive evidence for the recovery reader.
    }
  });
  return {
    ...table,
    journal: {
      ...table.journal!,
      ...(world
        ? {
            world: {
              ...world,
              maps: world.maps.map((m) =>
                m.tabletop && hasMovementFields(m.tabletop) ? { ...m, tabletop: withoutMovement(m.tabletop) } : m,
              ),
            },
          }
        : {}),
      ...(reports ? { reports } : {}),
    },
  };
}
const upgradeMovementCommands = <C extends { kind: string }>(table: CloudTable, commands: C[]) =>
  upgradeSettingsCommands(table, commands, hasMovementFields, withoutMovement, (sent, current) => {
    if ("movement" in sent || "lockedPurseIds" in sent) return sent;
    // "Allow assigned-player token movement" changed on an older client: Automatic or Off.
    const was = current.movement ? current.movement !== "off" : current.playerMovement;
    const movement =
      typeof sent.playerMovement === "boolean" && sent.playerMovement !== was
        ? sent.playerMovement
          ? "auto"
          : "off"
        : current.movement;
    return {
      ...sent,
      ...(movement ? { movement } : {}),
      ...(current.lockedPurseIds ? { lockedPurseIds: current.lockedPurseIds } : {}),
    };
  });
// Protocol 16 (group placement).
const formationText = (text: string) => text.includes('"partyFormation":');
/** Whether a table (or a stored backup body) holds a party formation default. */
export function hasPartyFormation(table: CloudTable): boolean {
  return (
    table.journal?.world?.tabletop?.partyFormation !== undefined ||
    !!table.journal?.reports?.some((r) => formationText(r.snapshot ?? ""))
  );
}
function formationFreeTable(table: CloudTable): CloudTable {
  if (!hasPartyFormation(table)) return table;
  const world = table.journal?.world;
  const reports = table.journal?.reports?.map((report) => {
    if (!formationText(report.snapshot ?? "")) return report;
    try {
      return { ...report, snapshot: JSON.stringify(formationFreeTable(JSON.parse(report.snapshot))) };
    } catch {
      return report; // Preserve existing unreadable-archive evidence for the recovery reader.
    }
  });
  let plainWorld = world;
  if (world?.tabletop?.partyFormation !== undefined) {
    const tabletop = { ...world.tabletop };
    delete tabletop.partyFormation;
    plainWorld = { ...world, tabletop };
  }
  return {
    ...table,
    journal: { ...table.journal!, ...(plainWorld ? { world: plainWorld } : {}), ...(reports ? { reports } : {}) },
  };
}
// Protocol 17 (token follows view): the same treatment as the formation default, for `followView`.
const followText = (text: string) => text.includes('"followView":');
/** Whether a table (or a stored backup body) holds the follow-view setting. */
export function hasFollowView(table: CloudTable): boolean {
  return (
    table.journal?.world?.tabletop?.followView !== undefined ||
    !!table.journal?.reports?.some((r) => followText(r.snapshot ?? ""))
  );
}
function followFreeTable(table: CloudTable): CloudTable {
  if (!hasFollowView(table)) return table;
  const world = table.journal?.world;
  const reports = table.journal?.reports?.map((report) => {
    if (!followText(report.snapshot ?? "")) return report;
    try {
      return { ...report, snapshot: JSON.stringify(followFreeTable(JSON.parse(report.snapshot))) };
    } catch {
      return report; // Preserve existing unreadable-archive evidence for the recovery reader.
    }
  });
  let plainWorld = world;
  if (world?.tabletop?.followView !== undefined) {
    const tabletop = { ...world.tabletop };
    delete tabletop.followView;
    plainWorld = { ...world, tabletop };
  }
  return {
    ...table,
    journal: { ...table.journal!, ...(plainWorld ? { world: plainWorld } : {}), ...(reports ? { reports } : {}) },
  };
}
/** The newer session fields (and the protocol that introduced each), newest first. */
const SESSION_FIELDS = [
  ["followView", FOLLOW_VIEW_PROTOCOL],
  ["partyFormation", GROUP_COMMANDS_PROTOCOL],
] as const;
/**
 * An older client's `tabletop-session` save: it saw the session without every field newer than its
 * protocol, so `before` is compared without all of them at once (with or without `presentation`,
 * which protocol 2 and older never send) and the save keeps the stored values it couldn't see.
 */
function upgradeSessionCommands<C extends { kind: string }>(table: CloudTable, commands: C[], protocol: number): C[] {
  const current = table.journal?.world?.tabletop as Record<string, unknown> | undefined;
  if (!current) return commands;
  const hidden = SESSION_FIELDS.filter(([field, since]) => protocol < since && current[field] !== undefined).map(([field]) => field);
  if (!hidden.length) return commands;
  const plain = { ...current };
  for (const field of hidden) delete plain[field];
  const withoutPresentation = { ...plain };
  delete withoutPresentation.presentation;
  return commands.map((command) => {
    const c = command as C & Record<string, unknown>;
    if (c.kind !== "tabletop-session") return command;
    const exact = sameJson(plain, c.before);
    if (!exact && !sameJson(withoutPresentation, c.before)) return command;
    const before = { ...current };
    if (!exact) delete before.presentation;
    const session = { ...(c.session as Record<string, unknown>) };
    for (const field of hidden) if (!(field in session)) session[field] = current[field];
    return { ...c, before, session };
  });
}
// Protocol 21 (XP and milestones).
const advancementText = (text: string) => /"(xp|milestoneLevel)":\d/.test(text);
type SheetLike = { xp?: number; milestoneLevel?: number } | undefined;
const sheetHasAdvancement = (s: SheetLike) => !!s && (s.xp !== undefined || s.milestoneLevel !== undefined);
function withoutAdvancement<T extends SheetLike>(s: T): T {
  if (!sheetHasAdvancement(s)) return s;
  const { xp: _xp, milestoneLevel: _milestone, ...rest } = s!;
  return rest as T;
}
/** Whether a table (or a stored backup body) holds XP or milestones on a character sheet. */
export function hasAdvancement(table: CloudTable): boolean {
  const reportHas = (snapshot: string) => {
    // "xp" also names creature XP in resource packs: parse only when the text could match.
    if (!advancementText(snapshot)) return false;
    try {
      return hasAdvancement(JSON.parse(snapshot));
    } catch {
      return false;
    }
  };
  return (
    (table.purses ?? []).some((p) => sheetHasAdvancement(p.sheet) || sheetHasAdvancement(p.editBaseline)) ||
    !!table.journal?.editReports?.some((r) => sheetHasAdvancement(r.before) || sheetHasAdvancement(r.after)) ||
    !!table.journal?.reports?.some((r) => reportHas(r.snapshot ?? ""))
  );
}
function advancementFreeTable(table: CloudTable): CloudTable {
  if (!hasAdvancement(table)) return table;
  const purses = table.purses.map((p) =>
    sheetHasAdvancement(p.sheet) || sheetHasAdvancement(p.editBaseline)
      ? {
          ...p,
          ...(p.sheet ? { sheet: withoutAdvancement(p.sheet) } : {}),
          ...(p.editBaseline ? { editBaseline: withoutAdvancement(p.editBaseline) } : {}),
        }
      : p,
  );
  if (!table.journal) return { ...table, purses };
  const editReports = table.journal.editReports?.map((r) => ({
    ...r,
    before: withoutAdvancement(r.before),
    after: withoutAdvancement(r.after),
  }));
  const reports = table.journal.reports?.map((report) => {
    if (!advancementText(report.snapshot ?? "")) return report;
    try {
      return { ...report, snapshot: JSON.stringify(advancementFreeTable(JSON.parse(report.snapshot))) };
    } catch {
      return report; // Preserve existing unreadable-archive evidence for the recovery reader.
    }
  });
  return {
    ...table,
    purses,
    journal: { ...table.journal, ...(editReports ? { editReports } : {}), ...(reports ? { reports } : {}) },
  };
}
// Protocol 19 ("Ask the DM" movement).
const moveRequestText = (text: string) => text.includes('"moveRequests":[');
export function hasMoveRequests(table: CloudTable): boolean {
  return table.journal?.world?.moveRequests !== undefined || !!table.journal?.reports?.some((r) => moveRequestText(r.snapshot ?? ""));
}
function moveRequestFreeTable(table: CloudTable): CloudTable {
  if (!hasMoveRequests(table)) return table;
  const world = table.journal?.world;
  const reports = table.journal?.reports?.map((report) => {
    if (!moveRequestText(report.snapshot ?? "")) return report;
    try {
      return { ...report, snapshot: JSON.stringify(moveRequestFreeTable(JSON.parse(report.snapshot))) };
    } catch {
      return report; // Preserve existing unreadable-archive evidence for the recovery reader.
    }
  });
  let plainWorld = world;
  if (world?.moveRequests !== undefined) {
    plainWorld = { ...world };
    delete plainWorld.moveRequests;
  }
  return { ...table, journal: { ...table.journal!, ...(plainWorld ? { world: plainWorld } : {}), ...(reports ? { reports } : {}) } };
}
// Protocol 18 (zones).
const zonesText = (text: string) => /"(zones|zoneRequests)":\[|"splitRule":\{/.test(text);
/** Whether a table (or a stored backup body) holds zones, the split rule or split requests. */
export function hasZones(table: CloudTable): boolean {
  const w = table.journal?.world;
  return (
    w?.zones !== undefined ||
    w?.splitRule !== undefined ||
    w?.zoneRequests !== undefined ||
    !!table.journal?.reports?.some((r) => zonesText(r.snapshot ?? ""))
  );
}
function zonesFreeTable(table: CloudTable): CloudTable {
  if (!hasZones(table)) return table;
  const world = table.journal?.world;
  const reports = table.journal?.reports?.map((report) => {
    if (!zonesText(report.snapshot ?? "")) return report;
    try {
      return { ...report, snapshot: JSON.stringify(zonesFreeTable(JSON.parse(report.snapshot))) };
    } catch {
      return report; // Preserve existing unreadable-archive evidence for the recovery reader.
    }
  });
  let plainWorld = world;
  if (world) {
    plainWorld = { ...world };
    delete plainWorld.zones;
    delete plainWorld.splitRule;
    delete plainWorld.zoneRequests;
  }
  return {
    ...table,
    journal: { ...table.journal!, ...(plainWorld ? { world: plainWorld } : {}), ...(reports ? { reports } : {}) },
  };
}
/** Every older-client conversion, applied to a batch before it runs (cloud.server.ts). */
export function upgradeOldClientCommands<C extends { kind: string }>(
  table: CloudTable,
  commands: C[],
  protocol = 0,
): C[] {
  let result = commands;
  // The session fields a client can't see (privacy review 2026-10-29): stripped in one pass, so a
  // client older than several of them still matches `before` (it never sees any of them).
  if (protocol < FOLLOW_VIEW_PROTOCOL) result = upgradeSessionCommands(table, result, protocol);
  if (protocol < PLAYER_MOVEMENT_PROTOCOL) result = upgradeMovementCommands(table, result);
  if (protocol < GRID_MODE_PROTOCOL) result = upgradeGridHiddenCommands(table, result);
  if (protocol < FOOTPRINT_PROTOCOL) result = upgradeFootprintCommands(table, result);
  return result;
}
export function tableForProtocol(table: CloudTable, protocol = 0): CloudTable {
  if (protocol >= XP_PROTOCOL) return table;
  table = advancementFreeTable(table);
  if (protocol >= MOVE_APPROVAL_PROTOCOL) return table;
  table = moveRequestFreeTable(table);
  if (protocol >= ZONES_PROTOCOL) return table;
  table = zonesFreeTable(table);
  if (protocol >= FOLLOW_VIEW_PROTOCOL) return table;
  table = followFreeTable(table);
  if (protocol >= GROUP_COMMANDS_PROTOCOL) return table;
  table = formationFreeTable(table);
  if (protocol >= PLAYER_MOVEMENT_PROTOCOL) return table;
  table = movementFreeTable(table);
  if (protocol >= GRID_MODE_PROTOCOL) return table;
  table = gridHiddenFreeTable(table);
  if (protocol >= FOOTPRINT_PROTOCOL) return table;
  table = footprintFreeTable(table);
  if (protocol >= PARTY_GROUPS_PROTOCOL) return table;
  table = groupFreeTable(table);
  if (protocol >= SERVICES_WAVE2_PROTOCOL) return table;
  table = wave1Table(table);
  if (protocol >= SERVICES_PROTOCOL) return table;
  table = serviceFreeTable(table);
  if (protocol >= JOURNEY_PROTOCOL) return table;
  table = journeyFreeTable(table);
  if (protocol >= MAP_SCALE_PROTOCOL) return table;
  table = scaleFreeTable(table);
  if (protocol >= PLACEMENT_STYLE_PROTOCOL) return table;
  table = styleFreeTable(table);
  if (protocol >= TABLETOP_PROTOCOL) return table;
  table = legacyDiagonalTable(table);
  if (protocol === 2) {
    if (
      !table.journal?.world?.maps.some(
        (map) => map.tabletop && tabletopHasFogDiffs(map.tabletop),
      ) &&
      !table.journal?.reports?.some((report) => report.snapshot.includes('"fog-diff"'))
    )
      return table;
    const result = structuredClone(table),
      world = result.journal?.world;
    if (world) world.maps = world.maps.map(fogSnapshotMap);
    for (const report of result.journal?.reports ?? []) {
      if (!report.snapshot.includes('"fog-diff"')) continue;
      try {
        report.snapshot = JSON.stringify(tableForProtocol(JSON.parse(report.snapshot), protocol));
      } catch {
        /* Preserve existing unreadable-archive evidence for the recovery reader. */
      }
    }
    return result;
  }
  const result = structuredClone(table),
    world = result.journal?.world;
  if (world) {
    delete world.combat;
    if (world.tabletop) delete world.tabletop.presentation;
    if (protocol < 1) delete world.tabletop;
    world.maps = world.maps
      .map(fogSnapshotMap)
      .map(protocol === 1 ? previousTabletopMap : legacyTabletopMap);
  }
  for (const report of result.journal?.reports ?? []) {
    if (
      !report.snapshot.includes('"tabletop"') &&
      !report.snapshot.includes('"controllerPurseIds"') &&
      !report.snapshot.includes('"connected"') &&
      !report.snapshot.includes('"combat"') &&
      !report.snapshot.includes('"presentation"')
    )
      continue;
    try {
      report.snapshot = JSON.stringify(tableForProtocol(JSON.parse(report.snapshot), protocol));
    } catch {
      /* Preserve existing unreadable-archive evidence for the recovery reader. */
    }
  }
  return result;
}
function legacyDiagonalTable(table: CloudTable): CloudTable {
  const result = legacyDiagonals(table);
  if (result === table) return table;
  for (const report of result.journal?.reports ?? []) {
    if (!report.snapshot.includes('"alternating"')) continue;
    try {
      report.snapshot = JSON.stringify(legacyDiagonals(JSON.parse(report.snapshot)));
    } catch {
      /* Preserve existing unreadable-archive evidence for the recovery reader. */
    }
  }
  return result;
}
export function tabletopResponse<T extends { table: CloudTable; draft: string }>(
  value: T,
  protocol?: number,
): T {
  if (protocol && protocol >= SETTLEMENT_LIMITS_PROTOCOL) return withImageReferences(value);
  const draft: unknown = JSON.parse(value.draft);
  if (
    Array.isArray(draft) &&
    draft.some((c) => {
      if (!c || typeof c !== "object") return false;
      // Protocol 32: settlement tiers and limits.
      if (typeof c.kind === "string" && c.kind.startsWith("settlement-")) return true;
      if (protocol && protocol >= QUEST_RENOWN_PROTOCOL) return false;
      // Protocol 31: a quest's giver faction and renown rewards.
      if (c.kind === "quest-renown") return true;
      if (protocol && protocol >= FAVOR_MARKET_PROTOCOL) return false;
      // Protocol 30: the favor market.
      if (typeof c.kind === "string" && c.kind.startsWith("favor-")) return true;
      if (protocol && protocol >= FACTIONS_PROTOCOL) return false;
      // Protocol 29: factions, renown and favor.
      if (typeof c.kind === "string" && c.kind.startsWith("faction-")) return true;
      if (protocol && protocol >= AWARD_DETAILS_PROTOCOL) return false;
      // Protocol 28: an NPC inventory lot with charges, attunement or a presented record.
      if (c.kind === "npc-item" && hasItemDetails(c.item)) return true;
      if (protocol && protocol >= LOOT_RETURN_PROTOCOL) return false;
      // Protocol 27: return a departed character's items and coins to the party.
      if (c.kind === "loot-return") return true;
      if (protocol && protocol >= MARKET_EVENTS_PROTOCOL) return false;
      // Protocol 26: named market events.
      if (c.kind === "market-event" || c.kind === "market-event-end") return true;
      if (protocol && protocol >= MARKET_MARKUP_PROTOCOL) return false;
      // Protocol 25: the black-market markup display setting.
      if (c.kind === "black-market-markup") return true;
      if (protocol && protocol >= ITEM_IDENTITY_PROTOCOL) return false;
      // Protocol 24: item identification commands.
      if (c.kind === "item-identify" || c.kind === "item-unidentify") return true;
      if (protocol && protocol >= XP_PROTOCOL) return false;
      // Protocol 21: XP awards, and sheet edits or purse writes that carry XP or milestones.
      if (
        c.kind === "xp-award" ||
        (c.kind === "character" && advancementText(JSON.stringify([c.before, c.sheet]))) ||
        (c.kind === "patch" &&
          Array.isArray(c.changes) &&
          c.changes.some(
            (change: { store?: string }) => change?.store === "purses" && advancementText(JSON.stringify(change)),
          ))
      )
        return true;
      if (protocol && protocol >= MOVE_APPROVAL_PROTOCOL) return false;
      // Protocol 19: "Ask the DM" move requests.
      if (String(c.kind).startsWith("map-move-request") || moveRequestText(JSON.stringify(c))) return true;
      if (protocol && protocol >= ZONES_PROTOCOL) return false;
      // Protocol 18: zone commands and fields.
      if (String(c.kind).startsWith("zone-") || zonesText(JSON.stringify(c))) return true;
      if (protocol && protocol >= FOLLOW_VIEW_PROTOCOL) return false;
      // Protocol 17: token follows and the follow-view setting.
      if (c.kind === "map-token-follow" || followText(JSON.stringify(c))) return true;
      if (protocol && protocol >= GROUP_COMMANDS_PROTOCOL) return false;
      // Protocol 16: group placement commands and the formation default.
      if (c.kind === "map-tokens-place" || c.kind === "map-tokens-edit" || formationText(JSON.stringify(c)))
        return true;
      if (protocol && protocol >= PLAYER_MOVEMENT_PROTOCOL) return false;
      // Protocol 15: token claims and the movement fields.
      if (c.kind === "map-token-claim" || movementText(JSON.stringify(c))) return true;
      if (protocol && protocol >= GRID_MODE_PROTOCOL) return false;
      // Protocol 14: grid mode commands and the hidden-grid flag.
      if (c.kind === "map-grid-snap" || gridHiddenText(JSON.stringify(c))) return true;
      if (protocol && protocol >= FOOTPRINT_PROTOCOL) return false;
      // Protocol 13: footprint fields older apps cannot read.
      if (footprintCommandText(c)) return true;
      if (protocol && protocol >= PARTY_GROUPS_PROTOCOL) return false;
      // Protocol 10: split-the-party commands and group fields older apps cannot read.
      if (groupCommandText(c)) return true;
      if (protocol && protocol >= SERVICES_WAVE2_PROTOCOL) return false;
      // Protocol 9: wave-2 service kinds and fields older apps cannot read.
      if (
        ((typeof c.kind === "string" && c.kind.startsWith("service-")) ||
          c.kind === "npc-save" ||
          c.kind === "npc-create") &&
        wave2Text(JSON.stringify(c))
      )
        return true;
      if (protocol && protocol >= SERVICES_PROTOCOL) return false;
      // Protocol 8: service commands and NPC service lists older apps cannot read.
      if (
        (typeof c.kind === "string" && c.kind.startsWith("service-")) ||
        ((c.kind === "npc-save" || c.kind === "npc-create") &&
          [c.npc, c.before].some((n) => n?.services !== undefined))
      )
        return true;
      if (protocol && protocol >= JOURNEY_PROTOCOL) return false;
      // Protocol 7: journey commands and journey fields older apps cannot read.
      if (
        c.kind === "party-journey" ||
        c.kind === "travel-settings" ||
        ((c.kind === "downtime-plan" || c.kind === "party-location") && c.journeyId !== undefined)
      )
        return true;
      if (protocol && protocol >= MAP_SCALE_PROTOCOL) return false;
      // Protocol 6: a map scale bar fails older strict map schemas.
      if (c.kind === "map-save" && [c.map, c.before].some((m) => m?.scale !== undefined))
        return true;
      if (protocol && protocol >= PLACEMENT_STYLE_PROTOCOL) return false;
      // Protocol 5: placement pin styles fail older strict placement schemas.
      if (
        c.kind === "map-save" &&
        [c.map, c.before].some((m) => m?.connected?.placements?.some((p: { style?: string }) => p?.style))
      )
        return true;
      if (protocol && protocol >= TABLETOP_PROTOCOL) return false;
      // Protocol 3 forms (compact history, continued strokes, consolidation, the alternating
      // diagonal) fail older strict schemas.
      if (
        (c.kind === "map-fog" && (c.continued || c.action === "consolidate")) ||
        JSON.stringify(c).includes('"fog-diff"') ||
        JSON.stringify(c).includes('"diagonal":"alternating"')
      )
        return true;
      if (protocol === 2) return false;
      if (
        c.kind === "map-combat-transition" ||
        (c.kind === "tabletop-session" && (c.session?.presentation || c.before?.presentation)) ||
        (c.kind === "map-save" && (c.map?.connected || c.before?.connected))
      )
        return true;
      if (protocol === 1) return false;
      return (
        commands.has(c.kind) ||
        (c.kind === "map-save" && (c.map?.tabletop || c.before?.tabletop)) ||
        (c.kind === "map-token" &&
          [c.token, c.before].some(
            (token) =>
              token &&
              ["locked", "controllerPurseIds", "offsetX", "offsetY", "style", "vision"].some(
                (key) => token[key] !== undefined,
              ),
          ))
      );
    })
  )
    throw Error(
      "This session has unfinished map actions from an updated Lootsplitter client. Finish or resolve those actions on the updated website before resuming this older app. Your saved campaign and pending work are retained.",
    );
  // Protocol 29 reads every table field the favor market adds (stripped, kept by the server).
  if (protocol && protocol >= FACTIONS_PROTOCOL) return withImageReferences(value);
  if (protocol && protocol >= IMAGE_REFERENCE_PROTOCOL) {
    const referenced = withImageReferences(value);
    return { ...referenced, table: tableForProtocol(referenced.table, protocol) };
  }
  return { ...value, table: tableForProtocol(value.table, protocol) };
}

/**
 * Protocol 4: replace each current map's inline image with the reference it was read from.
 * Only images restored from this room's own stored rows are replaced (the server attached them),
 * so every reference sent is one the seat can load. Images stored inline (shared with portraits,
 * or written in this same request) stay inline.
 */
export function withImageReferences<T extends { table: CloudTable }>(value: T): T {
  const sources = (value as T & { [ROOM_IMAGE_SOURCES_KEY]?: Map<string, string> })[
    ROOM_IMAGE_SOURCES_KEY
  ];
  const world = value.table.journal?.world;
  if (!sources?.size || !world?.maps.some((map) => sources.has(map.image))) return value;
  return {
    ...value,
    table: {
      ...value.table,
      journal: {
        ...value.table.journal!,
        world: {
          ...world,
          maps: world.maps.map((map) =>
            sources.has(map.image) ? { ...map, image: sources.get(map.image)! } : map,
          ),
        },
      },
    },
  };
}
