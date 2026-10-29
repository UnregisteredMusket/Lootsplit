import { z } from "zod";
import { downtimeActivitiesSchema } from "./downtime-activities-schema.ts";
import { validateDowntimeActivities } from "./downtime-activities.ts";
import { blacksmithSchema } from "./blacksmith-schema.ts";
import { validateBlacksmith } from "./blacksmith-validation.ts";
import { legacyServiceKinds, serviceKinds, servicesSchema } from "./services-schema.ts";
import { validateServices } from "./services-validation.ts";
import { fleetSchema } from "./ships-schema.ts";
import { validateFleet } from "./ships.ts";
import { referencePolicySchema } from "./reference-access.ts";
import { resourceLibrarySchema } from "./resource-packs.ts";
import { worldSchema } from "./world-schema.ts";
import { questsSchema } from "./quests-schema.ts";
import { validateWorld } from "./world.ts";
import { estateSchema } from "./estate-schema.ts";
import { validateEstate } from "./estate.ts";
import { tradeEconomySchema } from "./trade-economy-schema.ts";
import { validateTradeEconomy } from "./trade-economy.ts";
import { marketLocationsSchema, validateShopLocations } from "./shop-locations.ts";
import { validateEconomyRows } from "./validation.ts";
import { validatePropertyLocations, listingSchema } from "./property.ts";
import type { CloudTable } from "./cloud.ts";
import { sheetSchema } from "../characters/model.mjs";
import { financeSchema } from "./finance.ts";
import { quireDb, request } from "./db.ts";
import type { LedgerLine } from "./types.ts";
import {
  lootClaimEventSchema,
  lootClaimsSchema,
  lootPoolEventSchema,
  lootResolutionSchema,
  lootFavourSchema,
} from "./loot-claims-schema.ts";
const id = z.string().min(1).max(150),
  at = z.number().int().nonnegative();
/** Optional receipt identity; it carries no recipient, financial or enemy data. */
export const encounterLootProvenanceSchema = z
  .object({
    kind: z.literal("encounter-loot"),
    encounterId: id,
    receiptId: z.string().min(1).max(120),
    sessionId: id.optional(),
  })
  .strict();
export type EncounterLootProvenance = z.infer<typeof encounterLootProvenanceSchema>;
export const encounterLootEntryId = (receiptId: string) => `encounter-loot:${receiptId}`;
const splitRule = z.enum(["party-fund", "source", "recipient", "rotate"]);
/** Campaign coin-split settings. Missing means the party-fund rule (owner decision). */
export const coinSplitSettingsSchema = z
  .object({
    remainderRule: splitRule.optional(),
    partyFundId: id.optional(),
    rotation: z.object({ lastPurseId: id }).strict().optional(),
  })
  .strict();
/** One split's receipt on its journal event; ledger lines link to it by `id`. */
export const coinSplitEventSchema = z
  .object({
    id,
    sourceId: id,
    copper: z.number().int().positive().max(1e12),
    share: z.number().int().positive().max(1e12),
    n: z.number().int().min(1).max(20),
    remainder: z.number().int().nonnegative().max(19),
    remainderTo: id.nullable(),
    rule: splitRule,
    recipientIds: z.array(id).min(1).max(20),
  })
  .strict();
const journalFields = z.object({
  coinSplit: coinSplitSettingsSchema.optional(),
  lootClaims: lootClaimsSchema.optional(),
  /** Quest log (docs/QUESTS.md); changes only through quest commands. */
  quests: questsSchema.optional(),
  downtimeActivities: downtimeActivitiesSchema.optional(),
  blacksmith: blacksmithSchema.optional(),
  services: servicesSchema.optional(),
  referenceAccess: referencePolicySchema.optional(),
  resourceLibrary: resourceLibrarySchema.optional(),
  tradeEconomy: tradeEconomySchema.optional(),
  world: worldSchema.optional(),
  propertyOperations: estateSchema.optional(),
  fleet: fleetSchema.optional(),
  market: marketLocationsSchema.optional(),
  downtimePrompt: z
    .object({ enabled: z.boolean(), days: z.number().int().min(0).max(3650) })
    .optional(),
  finance: financeSchema.optional(),
  reports: z
    .array(
      z.object({
        id,
        name: z.string().max(100),
        at,
        seatIds: z.array(id).optional(),
        snapshot: z.string(),
        error: z.string().optional(),
      }),
    )
    .optional(),
  entries: z
    .array(
      z.object({
        id,
        at,
        authorId: id,
        purseId: z.string(),
        visibility: z.enum(["dm", "party", "player"]),
        title: z.string().max(100),
        text: z.string().max(12000),
        reportIds: z.array(id).default([]),
        provenance: encounterLootProvenanceSchema.optional(),
        /** A note about one quest (players' private "My notes"). */
        questId: id.optional(),
      }),
    )
    .optional(),
  editReports: z
    .array(
      z.object({ id, purseId: id, name: z.string(), at, before: sheetSchema, after: sheetSchema }),
    )
    .optional(),
  sessions: z
    .array(
      z.object({
        id,
        name: z.string().min(1).max(100),
        startedAt: at,
        endedAt: at.optional(),
        startLedgerIds: z.array(id).optional(),
        endLedgerIds: z.array(id).optional(),
      }),
    )
    .default([]),
  requests: z
    .array(
      z.object({
        id,
        purseId: id,
        note: z.string().min(1).max(1000),
        copper: z.number().int().positive().max(1e12),
        at,
        status: z.enum(["pending", "approved", "denied"]),
      }),
    )
    .default([]),
  events: z
    .array(
      z.object({
        id,
        at,
        summary: z.string().max(500),
        kind: z.enum(["management", "prices", "request", "session"]),
        dmOnly: z.boolean().optional(),
        purseId: id.optional(),
        propertyId: id.optional(),
        split: coinSplitEventSchema.optional(),
        lootClaim: lootClaimEventSchema.optional(),
        lootPool: lootPoolEventSchema.optional(),
        lootResolution: lootResolutionSchema.optional(),
        lootFavour: lootFavourSchema.optional(),
        change: z
          .object({
            entity: z.enum(["stock", "realm", "shop", "holding", "account"]),
            entityId: id.optional(),
            before: z
              .record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()]))
              .nullable(),
            after: z
              .record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()]))
              .nullable(),
          })
          .optional(),
      }),
    )
    .default([]),
});
export const journalSchema = journalFields.superRefine((journal, ctx) => {
  for (const [index, report] of (journal.reports || []).entries()) {
    try {
      readCompleteArchive(report);
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["reports", index, "snapshot"],
        message:
          "An archived report has an invalid campaign snapshot or unreadable diagnostic placeholder. The current campaign was not changed.",
      });
    }
  }
});

function readCompleteArchive(report: { snapshot: string; error?: string }): CloudTable {
  if (report.error !== undefined)
    throw Error("An unreadable diagnostic placeholder is not a complete archived report.");
  return readArchivedSnapshot(report.snapshot);
}

/** Validate an archive without recursively invoking the outer journal refinement. */
export function readArchivedSnapshot(snapshot: string): CloudTable {
  const root: unknown = JSON.parse(snapshot);
  const pending: { table: unknown; depth: number }[] = [{ table: root, depth: 0 }];
  while (pending.length) {
    const { table, depth } = pending.pop()!;
    if (!table || typeof table !== "object" || depth > 32)
      throw Error("Archived report nesting is invalid.");
    const t = table as CloudTable;
    validateEconomyRows(t);
    const journal = journalFields.parse(t.journal ?? {});
    validateShopLocations(t.shops, journal.market);
    for (const listing of t.listings ?? []) listingSchema.parse(listing);
    validatePropertyLocations(t.listings ?? [], t.holdings, journal.market);
    validateEstate({ ...t, journal }, true);
    validateFleet({ ...t, journal }, true);
    validateBlacksmith({ ...t, journal }, true);
    validateServices({ ...t, journal }, true);
    validateDowntimeActivities({ ...t, journal }, true);
    validateTradeEconomy({ ...t, journal });
    validateWorld({ ...t, journal }, true);
    for (const key of ["notes", "sheets", "loans", "listings", "handouts"] as const)
      if (t[key] !== undefined && !Array.isArray(t[key])) throw Error("Invalid archived records.");
    if (
      !z
        .array(
          z.object({
            id: z.string(),
            at: z.number().finite(),
            from: z.enum(["dm", "player"]),
            to: z.enum(["dm", "party", "player"]),
            purseId: z.string(),
            text: z.string(),
            recipientId: z.string().optional(),
          }),
        )
        .safeParse(t.notes ?? []).success
    )
      throw Error("Invalid archived messages.");
    for (const report of journal.reports || []) {
      if (report.error !== undefined)
        throw Error("An unreadable diagnostic placeholder is not a complete archived report.");
      pending.push({ table: JSON.parse(report.snapshot), depth: depth + 1 });
    }
  }
  const table = root as CloudTable;
  return {
    ...table,
    notes: table.notes ?? [],
    sheets: table.sheets ?? [],
    loans: table.loans ?? [],
    listings: table.listings ?? [],
    handouts: table.handouts ?? [],
  };
}

/** Existing unreadable archives remain discoverable without breaking other authorized records. */
export const readJournalForRecords = (value: unknown) => journalFields.parse(value ?? {});
export type Journal = z.infer<typeof journalSchema>;
/** Stored journal fields remain usable even when one legacy archive needs recovery. */
export function readJournal(value: unknown): Journal {
  return journalFields.parse(value ?? {});
}
/** Untrusted imports/new rooms must contain fully projectable archived snapshots. */
export function readValidatedJournal(value: unknown): Journal {
  return journalSchema.parse(value ?? {});
}
export async function loadJournal(): Promise<Journal> {
  const db = await quireDb();
  const row = await request<{ value: unknown } | undefined>(
    db.transaction("meta").objectStore("meta").get("journal"),
  );
  return readJournal(row?.value);
}
export function selectSessionLedgerRows(
  ledger: LedgerLine[],
  session: Journal["sessions"][number],
  purseIds?: string[],
) {
  const startIds = session.startLedgerIds ? new Set(session.startLedgerIds) : null;
  const endIds = session.endLedgerIds ? new Set(session.endLedgerIds) : null;
  return ledger.filter(
    (x) =>
      (startIds ? !startIds.has(x.id) : x.at >= session.startedAt) &&
      (endIds ? endIds.has(x.id) : !session.endedAt || x.at < session.endedAt) &&
      (!purseIds || purseIds.includes(x.purseId)),
  );
}
// An account movement is not campaign income. Legacy transfers use their recorded summaries.
export function isExternalLedgerLine(row: LedgerLine): boolean {
  return row.transactionType
    ? row.transactionType !== "transfer"
    : !/^(Transfer (sent|received)$|Gave )/.test(row.summary);
}
export function sessionSummary(
  ledger: LedgerLine[],
  session: Journal["sessions"][number],
  purseIds?: string[],
) {
  const rows = selectSessionLedgerRows(ledger, session, purseIds);
  const external = rows.filter(isExternalLedgerLine);
  return {
    net: rows.reduce((n, x) => n + x.copper, 0),
    received: external.reduce((n, x) => n + Math.max(0, x.copper), 0),
    spent: external.reduce((n, x) => n + Math.max(0, -x.copper), 0),
  };
}

/** Older clients omit optional change metadata. Preserve it during their journal patches. */
export function preserveJournalMetadata(value: unknown, current: Journal): Journal {
  const next = readJournal(value);
  delete next.resourceLibrary;
  delete next.referenceAccess;
  delete next.lootClaims;
  delete next.services;
  delete next.quests;
  const reports = new Map((current.reports || []).map((report) => [report.id, report]));
  for (const report of next.reports || []) {
    // An archive is immutable. Hydrated error placeholders and stale client copies must
    // never replace the authoritative source bytes of an existing record.
    if (!reports.has(report.id)) {
      readCompleteArchive(report);
      reports.set(report.id, report);
    }
  }
  const changes = new Map(current.events.map((event) => [event.id, event.change]));
  const splits = new Map(current.events.map((event) => [event.id, event.split]));
  const loot = new Map(
    current.events.map((event) => [
      event.id,
      {
        lootClaim: event.lootClaim,
        lootPool: event.lootPool,
        lootResolution: event.lootResolution,
        lootFavour: event.lootFavour,
      },
    ]),
  );
  const privateEvents = new Set(current.events.filter((e) => e.dmOnly).map((e) => e.id));
  const entries = new Map((current.entries || []).map((entry) => [entry.id, entry]));
  for (const entry of next.entries || []) {
    const old = entries.get(entry.id);
    const provenance = old?.provenance ?? entry.provenance;
    const questId = old ? old.questId : entry.questId;
    // Older clients do not know these optional fields. Keep a confirmed record's
    // stable association when they write the same entry back without it.
    const kept = { ...entry };
    delete kept.questId;
    entries.set(entry.id, {
      ...kept,
      ...(provenance ? { provenance } : {}),
      ...(questId ? { questId } : {}),
    });
  }
  return readJournal({
    ...next,
    ...(current.blacksmith ? { blacksmith: current.blacksmith } : {}),
    // Services change only through service commands; a journal patch never rewrites them.
    ...(current.services ? { services: current.services } : {}),
    ...(current.downtimeActivities ? { downtimeActivities: current.downtimeActivities } : {}),
    ...(current.fleet ? { fleet: current.fleet } : {}),
    ...(current.referenceAccess ? { referenceAccess: current.referenceAccess } : {}),
    ...((next.downtimePrompt ?? current.downtimePrompt)
      ? { downtimePrompt: next.downtimePrompt ?? current.downtimePrompt }
      : {}),
    ...(next.finance &&
    next.finance.minuteOfDay === undefined &&
    current.finance?.minuteOfDay !== undefined
      ? { finance: { ...next.finance, minuteOfDay: current.finance.minuteOfDay } }
      : {}),
    ...(next.finance ? {} : current.finance ? { finance: current.finance } : {}),
    ...(next.world
      ? {
          world: {
            ...next.world,
            ...(current.world?.tabletop ? { tabletop: current.world.tabletop } : {}),
            ...(current.world?.combat ? { combat: current.world.combat } : {}),
            npcs: next.world.npcs.map((n) => {
              const old = current.world?.npcs.find((o) => o.id === n.id);
              return {
                ...n,
                ...(old?.blacksmithServices !== undefined
                  ? { blacksmithServices: old.blacksmithServices }
                  : {}),
                // Older clients don't know the services list; keep the stored one. Protocol 8
                // clients don't know wave-2 kinds (tabletop protocol 9); keep those stored too.
                ...(n.services === undefined && old?.services !== undefined
                  ? { services: old.services }
                  : n.services &&
                      !n.services.some((k) => !legacyServiceKinds.includes(k as never)) &&
                      old?.services?.some((k) => !legacyServiceKinds.includes(k as never))
                    ? {
                        services: serviceKinds.filter(
                          (k) =>
                            n.services!.includes(k) ||
                            (!legacyServiceKinds.includes(k as never) && old.services!.includes(k)),
                        ),
                      }
                    : {}),
              };
            }),
            ...(current.world?.partyPosition ? { partyPosition: current.world.partyPosition } : {}),
            // Journeys and travel settings change only through their commands.
            ...(current.world?.journeys ? { journeys: current.world.journeys } : {}),
            ...(current.world?.travel ? { travel: current.world.travel } : {}),
            // Split the party: groups change only through their commands, and an older app
            // (tabletop protocol 9) writing positions back keeps each character's group.
            ...(current.world?.groups ? { groups: current.world.groups } : {}),
            ...(current.world?.mainGroup ? { mainGroup: current.world.mainGroup } : {}),
            ...(current.world?.groupRequests ? { groupRequests: current.world.groupRequests } : {}),
            // Zones (tabletop protocol 17) change only through their commands.
            ...(current.world?.zones ? { zones: current.world.zones } : {}),
            ...(current.world?.splitRule ? { splitRule: current.world.splitRule } : {}),
            ...(current.world?.zoneRequests ? { zoneRequests: current.world.zoneRequests } : {}),
            characterPositions: keepGroups(
              next.world.characterPositions ?? [],
              current.world?.characterPositions ?? [],
              new Set((current.fleet?.aboard ?? []).map((a) => a.purseId)),
            ),
            maps: next.world.maps.map((map) => {
              const old = current.world?.maps.find((m) => m.id === map.id);
              if (old?.connected) map.connected = old.connected;
              return {
                ...map,
                ...(old?.type ? { type: old.type } : {}),
                ...(old?.propertyId ? { propertyId: old.propertyId } : {}),
                ...(old?.grid ? { grid: old.grid } : {}),
                ...(old?.scale ? { scale: old.scale } : {}),
                ...(old?.tokens ? { tokens: old.tokens } : {}),
                ...(old?.encounterId ? { encounterId: old.encounterId } : {}),
                ...(old?.tabletop ? { tabletop: old.tabletop } : {}),
              };
            }),
          },
        }
      : current.world
        ? { world: current.world }
        : {}),
    ...(next.market ? {} : current.market ? { market: current.market } : {}),
    ...(next.propertyOperations
      ? {}
      : current.propertyOperations
        ? { propertyOperations: current.propertyOperations }
        : {}),
    ...(current.tradeEconomy ? { tradeEconomy: current.tradeEconomy } : {}),
    ...(current.resourceLibrary ? { resourceLibrary: current.resourceLibrary } : {}),
    ...(current.reports || next.reports
      ? {
          reports: [...reports.values()],
        }
      : {}),
    ...(current.entries || next.entries
      ? {
          entries: [...entries.values()],
        }
      : {}),
    ...(current.editReports || next.editReports
      ? {
          editReports: [
            ...new Map(
              [...(current.editReports || []), ...(next.editReports || [])].map((r) => [r.id, r]),
            ).values(),
          ],
        }
      : {}),
    // Older clients drop the optional split settings and receipts; keep the stored ones.
    ...(next.coinSplit ?? current.coinSplit ? { coinSplit: next.coinSplit ?? current.coinSplit } : {}),
    // Claims change only through loot commands; a journal patch never rewrites them.
    ...(current.lootClaims ? { lootClaims: current.lootClaims } : {}),
    // Quests change only through quest commands; a journal patch never rewrites them.
    ...(current.quests ? { quests: current.quests } : {}),
    events: next.events.map((event) => {
      const change = event.change ?? changes.get(event.id);
      const split = event.split ?? splits.get(event.id);
      const kept = loot.get(event.id);
      return {
        ...event,
        ...(kept?.lootClaim && !event.lootClaim ? { lootClaim: kept.lootClaim } : {}),
        ...(kept?.lootPool && !event.lootPool ? { lootPool: kept.lootPool } : {}),
        ...(kept?.lootResolution && !event.lootResolution ? { lootResolution: kept.lootResolution } : {}),
        ...(kept?.lootFavour && !event.lootFavour ? { lootFavour: kept.lootFavour } : {}),
        ...(change ? { change } : {}),
        ...(split ? { split } : {}),
        ...(privateEvents.has(event.id) ? { dmOnly: true } : {}),
      };
    }),
  });
}

type StoredPosition = NonNullable<NonNullable<Journal["world"]>["characterPositions"]>[number];
/** Positions written back without group fields keep the stored group when nothing else moved. */
function keepGroups(next: StoredPosition[], current: StoredPosition[], aboard: Set<string>): StoredPosition[] {
  return next.map((s) => {
    const old = current.find((o) => o.purseId === s.purseId);
    if (!old || s.groupId !== undefined) return s;
    const kept = { ...s };
    if (old.groupId && s.inParty && old.inParty) kept.groupId = old.groupId;
    // A group at sea reads as "aboard alone" (out of the party) for older apps: keep it in its group.
    if (old.groupId && old.inParty && !s.inParty && aboard.has(s.purseId) && s.locationId === old.locationId) {
      kept.inParty = true;
      kept.groupId = old.groupId;
    }
    if (kept.downtime && old.downtime?.returnGroupId && kept.downtime.returnGroupId === undefined && kept.downtime.id === old.downtime.id)
      kept.downtime = { ...kept.downtime, returnGroupId: old.downtime.returnGroupId };
    return kept;
  });
}
