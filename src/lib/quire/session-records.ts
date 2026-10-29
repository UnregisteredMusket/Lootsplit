import { projectConnectedMaps } from "./connected-maps.ts";
import { facilityAccess } from "./ships.ts";
import { readDowntimeActivities } from "./downtime-activities-schema.ts";
import { readBlacksmith } from "./blacksmith-schema.ts";
import { isLinkKind, readServices } from "./services-schema.ts";
import { courierRecipients } from "./services-courier.ts";
import {
  characterVisible,
  canReadCharacter,
  companionFundsReadable,
  inParty,
  seatInParty,
} from "./character-position.ts";
import { designatedPartyFund, isNpc, partyFunds } from "./coin-split.ts";
import { projectLoot } from "./loot-claims.ts";
import { fairnessProjection } from "./loot-fairness.ts";
import { readWorld } from "./world-schema.ts";
import { exchangeHere } from "./trade-economy.ts";
import { readTradeEconomy } from "./trade-economy-schema.ts";
import { npcAvailableHere, npcController, shopVisible } from "./world.ts";
import { projectNpcBarter } from "./npc-barter.ts";
import type { CloudTable, CloudSeat } from "./cloud.ts";
import { canReadNote } from "./chat-visibility.ts";
import { characterSheet } from "../characters/campaign-sheet.mjs";
import { readFinance } from "./finance.ts";
import { readJournal, readJournalForRecords, readArchivedSnapshot } from "./journal.ts";
import { readMarketLocations, publicMarketLocations } from "./shop-locations.ts";
import { propertyAvailableToGroups } from "./property.ts";
import { projectPartyGroups } from "./party-groups-project.ts";
import { projectZones } from "./zones-project.ts";
import { seatGroups } from "./party-groups.ts";
import { canAccessEstate } from "./estate.ts";
import { readEstate } from "./estate-schema.ts";
import { mapAccessible, projectTabletopMap } from "./tabletop.ts";
import { projectJourneys } from "./journey-engine.ts";
import { projectQuestMapLinks, projectQuests, questNamedPurses, type QuestProjectionContext } from "./quests.ts";
import { isDeferredSnapshot } from "./history-pages.ts";

/** Server/default projections enforce historical seats; verified local DM readers may retain their owned nested records. */
export function projectRecord(
  table: CloudTable,
  seat: Pick<CloudSeat, "role" | "purseIds"> & { id?: string },
  options: {
    ownedDevice?: boolean;
    directory?: boolean;
    tabletopProjected?: boolean;
    /** Quest reward receipts resolved over the whole campaign (quests.ts `QuestProjectionContext`). */
    questReceipt?: QuestProjectionContext["receipt"];
  } = {},
): CloudTable {
  const t = structuredClone(table);
  const dm = seat.role === "dm";
  if (!dm)
    seat = {
      ...seat,
      purseIds: seat.purseIds.filter((id) => {
        const p = t.purses.find((p) => p.id === id);
        return p && characterVisible(t, p);
      }),
    };
  const ownedDevice = options.ownedDevice === true && dm;
  t.notes = t.notes.filter((n) => canReadNote(n, seat));
  t.journal = readJournalForRecords(t.journal);
  t.journal.entries = t.journal.entries?.filter(
    (e) =>
      e.visibility === "party" ||
      (dm ? e.visibility === "dm" : e.visibility === "player" && seat.purseIds.includes(e.purseId)),
  );
  t.journal.reports = t.journal.reports
    ?.filter((r) => ownedDevice || !r.seatIds || (seat.id && r.seatIds.includes(seat.id)))
    .map((r) => {
      // History on demand (step 4): an archived session not read with the room is listed by its
      // name and date only; `projectArchivedReport` projects it when someone opens it.
      if (isDeferredSnapshot(r.snapshot)) {
        const { snapshot: _snapshot, ...listed } = r;
        return { ...listed, snapshot: "", deferred: true as const };
      }
      return projectArchivedReport(r, table, seat, { ownedDevice, tabletopProjected: options.tabletopProjected });
    });
  t.journal.editReports = t.journal.editReports?.filter(
    (r) => dm || seat.purseIds.includes(r.purseId),
  );
  if (!dm) {
    delete t.journal.resourceLibrary;
    const world = readWorld(t.journal.world);
    delete world.combat;
    world.maps = world.maps
      .filter((map) => mapAccessible(t, map, seat))
      .map((map) => ({
        ...map,
        encounterId: undefined,
        markers: map.markers.filter((marker) => marker.visibility === "party"),
        ...(map.tokens
          ? {
              tokens: map.tokens.filter(
                (token) =>
                  token.visibility === "party" &&
                  (token.kind !== "character" ||
                    !!t.purses.find((p) => p.id === token.entityId && characterVisible(t, p))) &&
                  (token.kind !== "ship" ||
                    !!t.journal?.fleet?.vessels.some((v) => v.propertyId === token.entityId)),
              ),
            }
          : {}),
      }))
      .map((map) => (options.tabletopProjected ? map : projectTabletopMap(t, map, seat)));
    if (world.tabletop) {
      if (!world.maps.some((m) => m.id === world.tabletop!.activeMapId))
        world.tabletop.activeMapId = null;
      if (world.tabletop.camera && !world.maps.some((m) => m.id === world.tabletop!.camera!.mapId))
        world.tabletop.camera = null;
      if (world.tabletop.presentation && !world.maps.some(m=>m.id===world.tabletop!.presentation!.mapId)) world.tabletop.presentation=null;
      world.tabletop.tvEnabled = false;
    }
    // Split the party: "here" is the place of any group this seat has a character in.
    const groups = seatGroups(table, seat);
    const readableNpcs = new Set(
      world.npcs.filter((npc) => npcAvailableHere(npc, table, groups)).map((npc) => npc.id),
    );
    const controlledNpcs = new Set(
      world.npcs.filter((npc) => npcController(npc, seat)).map((npc) => npc.id),
    );
    world.conversations = world.conversations.filter(
      (c) =>
        (seat.purseIds.includes(c.purseId) || controlledNpcs.has(c.npcId)) &&
        readableNpcs.has(c.npcId),
    );
    world.trades = world.trades.filter((o) =>
      [o.left.purseId, o.right.purseId].some(
        (id) => seat.purseIds.includes(id) || controlledNpcs.has(id),
      ),
    );
    world.timeHistory = world.timeHistory.map((r) => ({
      ...r,
      purseIds: r.purseIds.filter((id) => seat.purseIds.includes(id)),
    }));
    if (world.partyPosition && !world.maps.some((m) => m.id === world.partyPosition!.mapId)) {
      delete world.partyPosition.mapId;
      delete world.partyPosition.x;
      delete world.partyPosition.y;
    }
    projectPartyGroups(table, world, seat);
    projectZones(world, seat, table);
    world.npcs = world.npcs.filter((npc) => readableNpcs.has(npc.id));
    projectNpcBarter(world, seat);
    if (t.journal.downtimeActivities) {
      const activities = readDowntimeActivities(t.journal.downtimeActivities);
      activities.windows = activities.windows.map((w) => ({
        ...w,
        budgets: w.budgets.filter((b) => seat.purseIds.includes(b.purseId)),
      }));
      activities.requests = activities.requests
        .filter((r) => seat.purseIds.includes(r.trainerId))
        .map((r) => (readableNpcs.has(r.npcId) ? r : { ...r, npcName: "Unavailable NPC" }));
      activities.resets = activities.resets.filter((r) => seat.purseIds.includes(r.trainerId));
      t.journal.downtimeActivities = activities;
    }
    if (options.directory)
      world.partyCharacters = t.purses
        .filter(
          (p) =>
            inParty(t, p) &&
            characterVisible(t, p) &&
            p.kind === "character" &&
            p.control !== "npc",
        )
        .map((p) => ({ id: p.id, name: p.name }));
    else delete world.partyCharacters;
    if (t.journal.world || options.directory) t.journal.world = world;
    const estate = readEstate(t.journal.propertyOperations);
    const visibleSites = new Set(
      estate.sites
        .filter((site) => canAccessEstate(t, estate, site.propertyId, seat))
        .map((site) => site.propertyId),
    );
    if (t.journal.fleet) {
      const fleet = t.journal.fleet;
      fleet.vessels = fleet.vessels
        .filter((v) => visibleSites.has(v.propertyId))
        .map((v) => ({ ...v, dmNotes: "" }));
      const currentFacilities = new Set(
        fleet.vessels.flatMap((v) => (v.facilityId ? [v.facilityId] : [])),
      );
      fleet.facilities = fleet.facilities.filter(
        (f) => facilityAccess(t, f, seat) || currentFacilities.has(f.id),
      );
      fleet.voyages = fleet.voyages
        .filter((v) => visibleSites.has(v.propertyId))
        .map((v) => ({
          ...v,
          ...(v.mapRoute && !world.maps.some((m) => m.id === v.mapRoute!.mapId)
            ? { mapRoute: undefined }
            : {}),
        }));
      fleet.aboard = fleet.aboard.filter((a) => visibleSites.has(a.propertyId));
      fleet.boarding = fleet.boarding.filter((r) => seat.purseIds.includes(r.purseId));
      fleet.work = fleet.work.filter((w) => visibleSites.has(w.propertyId));
    }
    const sharedOwners = new Set(
      t.holdings.filter((h) => visibleSites.has(h.id)).map((h) => h.purseId),
    );
    if (t.journal.propertyOperations) {
      estate.sites = estate.sites.filter((s) => visibleSites.has(s.propertyId));
      for (const field of [
        "jobs",
        "staff",
        "rentals",
        "letters",
        "shipments",
        "standingOrders",
        "suppliers",
        "withdrawals",
      ] as const)
        (estate[field] as { propertyId: string }[]) = estate[field].filter((r) =>
          visibleSites.has(r.propertyId),
        );
      t.journal.propertyOperations = estate;
    }
    // Quest log: only quests revealed to this seat, without DM-only parts (quests.ts).
    const hiddenGroups = new Set(
      (table.journal?.world?.groups ?? []).filter((g) => g.status === "active" && g.hidden && !groups.includes(g.id)).map((g) => g.id),
    );
    const questPlaces = projectQuests(table, t.journal, seat, {
      tabletopProjected: options.tabletopProjected,
      ...(options.questReceipt ? { receipt: options.questReceipt } : {}),
      readableNpcs,
      // A hidden group's place, unless the seat's own group or the party is there too.
      hiddenPlaces: new Set(
        (table.journal?.world?.groups ?? [])
          .filter((g) => hiddenGroups.has(g.id) && g.locationId)
          .map((g) => g.locationId!)
          .filter(
            (id) =>
              id !== table.journal?.market?.currentLocationId &&
              !(table.journal?.world?.groups ?? []).some(
                (g) => groups.includes(g.id) && g.status === "active" && g.locationId === id,
              ),
          ),
      ),
    });
    // Entries keep a quest link only when the quest is in this seat's log.
    const readableQuests = new Set(((t.journal as { quests?: { quests: { id: string }[] } }).quests?.quests ?? []).map((q) => q.id));
    t.journal.entries = t.journal.entries?.map((e) => {
      if (!e.questId || readableQuests.has(e.questId)) return e;
      const plain = { ...e };
      delete plain.questId;
      return plain;
    });
    const market = readMarketLocations(t.journal.market);
    if (t.journal.tradeEconomy) {
      const economy = t.journal.tradeEconomy;
      economy.settings = {
        ...readTradeEconomy().settings,
        enabled: economy.settings.enabled,
        mode: economy.settings.mode,
      };
      economy.exchanges = economy.exchanges.filter(
        (e) => economy.settings.enabled && e.visible && exchangeHere(table, e, groups),
      );
      economy.receipts = economy.receipts
        .filter((r) => seat.purseIds.includes(r.purseId))
        .map((receipt) => {
          const projected = { ...receipt };
          delete projected.settlement;
          delete projected.operationId;
          return projected;
        });
      economy.draws = [];
      economy.history = [];
      delete economy.pendingSeason;
    }
    t.shops = t.shops.filter((shop) => shopVisible(shop, table, groups));
    if (t.journal.blacksmith) {
      const smith = readBlacksmith(t.journal.blacksmith);
      smith.profiles = smith.profiles.filter(
        (p) => t.shops.some((s) => s.id === p.shopId) && readableNpcs.has(p.npcId),
      );
      // Only offered enchantments are public; approval drafts remain DM-only.
      smith.profiles = smith.profiles.map((p) => ({
        ...p,
        enchantments: p.enchantments.filter((e) => e.approved),
      }));
      smith.orders = smith.orders.filter((o) => seat.purseIds.includes(o.purseId));
      t.journal.blacksmith = smith;
    }
    if (t.journal.services) {
      // Players see providers at visible shops with readable NPCs and at least one approved offer,
      // only approved offers, rumour teasers without text or buyers, and only their own orders.
      const services = readServices(t.journal.services);
      services.providers = services.providers
        .filter((p) => t.shops.some((s) => s.id === p.shopId) && readableNpcs.has(p.npcId))
        // A fence deals only while the DM has the black market switched on (the check `sell` uses).
        .filter((p) => p.kind !== "fence" || !!world.blackMarketActive)
        .map((p) => {
          const projected = { ...p, offers: p.offers.filter((o) => o.approved) };
          // Courier: who this viewer's characters may write to, worked out here from the full table
          // (the NPCs they have threads with may be elsewhere and absent from the projection).
          if (p.kind === "courier")
            projected.recipients = seat.purseIds.flatMap((purseId) => courierRecipients(table, p, purseId));
          // Hire roles name an NPC only when the player can read that NPC.
          if (p.link?.roles)
            projected.link = {
              ...p.link,
              roles: p.link.roles.map((r) => {
                if (!r.npcId || readableNpcs.has(r.npcId)) return r;
                const plain = { ...r };
                delete plain.npcId;
                return plain;
              }),
            };
          if (p.rumours)
            projected.rumours = p.rumours.map((r) => {
              const mine = (r.buyers ?? []).filter((id) => seat.purseIds.includes(id));
              return {
                id: r.id,
                teaser: r.teaser,
                priceCopper: r.priceCopper,
                once: r.once,
                ...(mine.length ? { boughtBy: mine } : {}),
                ...(r.once === "party" && r.buyers?.length ? { boughtByParty: true } : {}),
              };
            });
          return projected;
        })
        .filter((p) => p.offers.length > 0 || isLinkKind(p.kind));
      services.orders = services.orders.filter((o) => seat.purseIds.includes(o.purseId));
      t.journal.services = services;
    }
    t.listings = t.listings.filter(
      (listing) =>
        propertyAvailableToGroups(listing, table, groups) &&
        listing.quantity !== 0 &&
        listing.status !== "withdrawn",
    );
    const shops = new Set(t.shops.map((shop) => shop.id));
    t.stock = t.stock.filter((line) => shops.has(line.shopId));
    if (t.journal.market)
      t.journal.market = publicMarketLocations(
        market,
        t.holdings
          .filter((h) => seat.purseIds.includes(h.purseId) || visibleSites.has(h.id))
          .flatMap((h) => (h.locationId ? [h.locationId] : []))
          .concat(
            world.maps.flatMap((m) => [
              ...(m.locationId ? [m.locationId] : []),
              ...m.anchors.map((a) => a.locationId),
              ...(m.connected?.placements??[]).filter(p=>p.visibility==='party'&&p.record.kind==='location').map(p=>p.record.id),
            ]),
            world.npcs.map((n) => n.locationId),
            t.journal.fleet?.facilities.map((f) => f.locationId) ?? [],
            t.journal.fleet?.voyages.flatMap((v) => [v.originId, v.destinationId]) ?? [],
            t.purses
              .filter((p) => characterVisible(t, p))
              .flatMap((p) => {
                const s = t.journal?.world?.characterPositions.find((s) => s.purseId === p.id);
                return s?.locationId ? [s.locationId] : [];
              }),
            t.shops.flatMap((s) => (s.locationId ? [s.locationId] : [])),
            // Split the party: the places of the groups this seat may see (hidden ones are cut).
            (world.groups ?? []).flatMap((g) => (g.locationId ? [g.locationId] : [])),
            t.journal.blacksmith?.orders.map((o) => o.terms.locationId) ?? [],
            t.journal.services?.orders.map((o) => o.terms.locationId) ?? [],
            t.listings.flatMap((l) => (l.locationId ? [l.locationId] : [])),
            t.journal.tradeEconomy?.exchanges.flatMap((e) =>
              e.locationId ? [e.locationId] : [],
            ) ?? [],
            questPlaces,
          ),
        !!world.partyPosition,
      );
    // Journeys: status, progress and terrain; private routes and fogged waypoints are cut here.
    projectJourneys(
      table,
      world,
      seat,
      new Set(readMarketLocations(t.journal.market).locations.map((l) => l.id)),
    );
    // DM setting: party companions' funds are readable by party players (decided on the unprojected table).
    const companions = new Set(
      table.purses.filter((p) => companionFundsReadable(table, p, seat)).map((p) => p.id),
    );
    t.ledger = t.ledger.filter(
      (l) => seat.purseIds.includes(l.purseId) || companions.has(l.purseId),
    );
    // Treasure pool: pooled party-fund lots are visible to seats with a party character
    // (owner decision, 2026-10-23); other fund items keep the "Allow party fund" rule.
    const poolFundIds = seatInParty(table, seat)
      ? new Set(partyFunds(table).map((p) => p.id))
      : new Set<string>();
    t.holdings = t.holdings.filter(
      (h) =>
        seat.purseIds.includes(h.purseId) ||
        (!!h.pool && poolFundIds.has(h.purseId)) ||
        (readableNpcs.has(h.purseId) && !h.custody && !h.reservedFor) ||
        visibleSites.has(h.id) ||
        (h.custody && visibleSites.has(h.custody.propertyId)),
    );
    if (t.journal.propertyOperations) {
      const keys = new Set([
        ...estate.sites.flatMap((site) => [site.templateKey, ...site.completedTemplates]),
        ...t.listings.flatMap((listing) =>
          [listing.estateTemplateKey, ...(listing.estateAttachments ?? [])].filter(Boolean),
        ),
        ...estate.jobs.flatMap((job) =>
          job.recipe.resultTemplateKey ? [job.recipe.resultTemplateKey] : [],
        ),
      ]);
      // Include referenced building templates, but never another private property's unrelated custom configuration.
      let changed = true;
      while (changed) {
        changed = false;
        for (const template of estate.templates.filter((template) => keys.has(template.key)))
          for (const recipe of template.recipes ?? [])
            if (recipe.resultTemplateKey && !keys.has(recipe.resultTemplateKey)) {
              keys.add(recipe.resultTemplateKey);
              changed = true;
            }
      }
      estate.templates = estate.templates.filter((template) => keys.has(template.key));
      const recipes = [
        ...estate.templates.flatMap((template) => template.recipes ?? []),
        ...estate.jobs.map((job) => job.recipe),
      ];
      const materials = new Set([
        ...t.holdings.map((holding) => holding.materialKey),
        ...estate.suppliers.map((supplier) => supplier.materialKey),
        ...recipes.flatMap((recipe) =>
          [...recipe.materials, ...(recipe.stages ?? []).flatMap((stage) => stage.materials)].map(
            (use) => use.materialKey,
          ),
        ),
        ...recipes.map((recipe) => recipe.output?.materialKey),
        ...(t.journal.tradeEconomy?.commodities.map((c) => c.materialKey) ?? []),
        ...(t.journal.blacksmith?.profiles.flatMap((p) => p.materials.map((m) => m.materialKey)) ??
          []),
      ]);
      estate.materials = estate.materials.filter((material) => materials.has(material.key));
    }
    if (t.journal.tradeEconomy) {
      const economy = t.journal.tradeEconomy;
      const goods = new Set([
        ...economy.exchanges.flatMap((e) => e.offers.map((o) => o.commodityId)),
        ...t.holdings.map((h) => h.commodityId),
        ...t.stock.map((s) => s.commodityId),
        ...economy.receipts.map((r) => r.commodityId),
      ]);
      economy.commodities = economy.commodities.filter((c) => goods.has(c.id));
      // A linked shop outside the visible exchange still retains its commodity identity, without disclosing that exchange.
      for (const line of t.stock)
        if (!economy.exchanges.some((e) => e.id === line.tradeExchangeId)) {
          delete line.tradeExchangeId;
          delete line.commodityId;
        }
    }
    const publicNames = new Set([
      ...(options.directory
        ? t.purses
            .filter((p) => p.kind === "character" && p.control !== "npc" && characterVisible(t, p))
            .map((p) => p.id)
        : []),
      ...(t.journal.tradeEconomy?.exchanges.map((e) => e.purseId) ?? []),
      ...world.conversations.map((c) => c.purseId),
      ...world.npcs.map((n) => n.id),
      ...world.trades.flatMap((o) => [o.left.purseId, o.right.purseId]),
      ...sharedOwners,
      // Quest co-recipients are named (owner decision D3).
      ...questNamedPurses(t.journal),
      ...t.holdings.map((h) => h.purseId),
      ...estate.jobs.flatMap((j) => [j.purseId, ...j.assignments.map((a) => a.purseId)]),
      ...estate.letters.map((l) => l.senderId),
      ...estate.withdrawals.map((r) => r.purseId),
      // Party members can name the party funds (a split's leftover and fund lines); balances
      // follow the party-balance rule in cloud.server.ts playerTable.
      ...(seatInParty(table, seat) ? partyFunds(table).map((p) => p.id) : []),
    ]);
    t.purses = t.purses
      .filter((p) => seat.purseIds.includes(p.id) || publicNames.has(p.id))
      .map((p) =>
        seat.purseIds.includes(p.id) && canReadCharacter(t, p, seat)
          ? p
          : {
              id: p.id,
              name: characterVisible(t, p) ? p.name : "Hidden character",
              kind: p.kind,
              ...(p.nonParty ? { nonParty: true } : {}),
              ...(p.control ? { control: p.control } : {}),
              ...(canReadCharacter(t, p, seat)
                ? { sheet: p.sheet, portrait: p.portrait, sheetRevision: p.sheetRevision }
                : {}),
              coins: companions.has(p.id) ? p.coins : { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
            },
      );
    const coinSplit = projectCoinSplit(table, t);
    if (Object.keys(coinSplit).length) t.journal.coinSplit = coinSplit;
    else delete t.journal.coinSplit;
    world.characterPositions = world.characterPositions
      .filter((s) => t.purses.some((p) => p.id === s.purseId))
      .map((s) => {
        const projected = { ...s, ...(s.downtime ? { downtime: undefined } : {}) };
        // Hidden characters are never shown as members of a group.
        const p = t.purses.find((p) => p.id === s.purseId);
        if (projected.groupId && (!p || !characterVisible(table, p))) delete projected.groupId;
        return projected;
      });
    if (t.journal.fleet) {
      t.journal.fleet.aboard = t.journal.fleet.aboard.filter((a) =>
        t.purses.some((p) => p.id === a.purseId),
      );
      for (const v of t.journal.fleet.voyages)
        v.crewPurseIds = v.crewPurseIds.filter((id) => t.purses.some((p) => p.id === id));
      for (const f of t.journal.fleet.facilities)
        f.accessPurseIds = f.accessPurseIds.filter((id) => t.purses.some((p) => p.id === id));
    }
    if (t.journal.finance) {
      const f = readFinance(t.journal.finance);
      t.journal.finance = {
        day: f.day,
        ...(f.minuteOfDay !== undefined ? { minuteOfDay: f.minuteOfDay } : {}),
        loans: f.loans.filter((l) => seat.purseIds.includes(l.purseId)),
        rules: f.rules.filter((r) => seat.purseIds.includes(r.purseId)),
        downtime: [],
      };
    }
    t.journal.requests = t.journal.requests.filter((r) => seat.purseIds.includes(r.purseId));
    // Treasure-pool events follow the pool's party rule (projectLoot); others keep theirs.
    const lootEvent = projectLoot(table, t, seat);
    t.journal.events = t.journal.events
      .flatMap((e) => {
        if (e.dmOnly) return [];
        const loot = lootEvent(e);
        if (loot !== undefined) return loot ? [loot] : [];
        return (
          e.propertyId
            ? visibleSites.has(e.propertyId) || (!!e.purseId && seat.purseIds.includes(e.purseId))
            : !e.purseId || seat.purseIds.includes(e.purseId)
        )
          ? [e]
          : [];
      })
      .map(({ change, ...e }) => e);
    t.loans = t.loans.filter((l) => seat.purseIds.includes(l.purseId));
    t.sheets = t.sheets.filter(
      (s) =>
        seat.purseIds.includes(s.purseId) &&
        t.purses.some((p) => p.id === s.purseId && canReadCharacter(t, p, seat)),
    );
  }
  if (!dm) projectConnectedMaps(t, seat);
  if (!dm && t.journal) projectQuestMapLinks(t.journal);
  for (const p of t.purses) delete p.editBaseline;
  return t;
}
type ArchivedReport = NonNullable<NonNullable<CloudTable["journal"]>["reports"]>[number];
type RecordSeat = Pick<CloudSeat, "role" | "purseIds"> & { id?: string };
/**
 * One archived session as `projectRecord` projects it for `seat` on the current `table`: its
 * snapshot projected by the same rules (players also get their fairness ledger figures), or the
 * unreadable-archive placeholder. Does not check the report's seat list (callers filter by it).
 * Used by `projectRecord` and, for history on demand (step 4), when a client opens one report.
 */
export function projectArchivedReport(
  r: ArchivedReport,
  table: CloudTable,
  seat: RecordSeat,
  options: { ownedDevice?: boolean; tabletopProjected?: boolean } = {},
): ArchivedReport {
  const dm = seat.role === "dm";
  if (!dm)
    seat = {
      ...seat,
      purseIds: seat.purseIds.filter((id) => {
        const p = table.purses.find((p) => p.id === id);
        return p && characterVisible(table, p);
      }),
    };
  const ownedDevice = options.ownedDevice === true && dm;
  // Fairness ledger (phase 3): whether this seat compares party totals is decided on the
  // current table (owner decision, 2026-10-24: players away from the party see only their own).
  const comparesParty = !dm && seatInParty(table, seat);
  try {
    const raw = readArchivedSnapshot(r.snapshot);
    const projected = projectRecord(raw, seat, {
      ownedDevice,
      tabletopProjected: options.tabletopProjected,
    });
    return {
      ...r,
      snapshot: JSON.stringify(
        dm
          ? projected
          : {
              ...projected,
              fairness: fairnessProjection(r.snapshot, raw, table, seat, comparesParty, projected.ledger),
            },
      ),
    };
  } catch {
    return {
      ...r,
      snapshot: JSON.stringify({
        purses: [],
        holdings: [],
        shops: [],
        stock: [],
        ledger: [],
        notes: [],
        sheets: [],
        loans: [],
        listings: [],
      }),
      error: "This archived report cannot be read. Keep its original backup for recovery.",
    };
  }
}
/**
 * A player's copy of the split settings. It must plan the same split the server will: the
 * designated party fund is resolved on the full table, and a rotation pointer to a purse the
 * player cannot list (an NPC) becomes the nearest listed purse before it in Party order, which
 * selects the same next recipient without naming the hidden purse.
 */
function projectCoinSplit(table: CloudTable, projected: CloudTable) {
  const settings = projected.journal?.coinSplit ?? {};
  const fund = designatedPartyFund(table);
  const listed = new Set(projected.purses.map((p) => p.id));
  const last = settings.rotation?.lastPurseId;
  let pointer: string | undefined;
  if (last) {
    const full = table.purses.map((p) => p.id);
    const at = full.indexOf(last);
    const lastPurse = table.purses[at];
    if (at >= 0 && listed.has(last) && lastPurse && !isNpc(table, lastPurse)) pointer = last;
    else for (let i = at - 1; i >= 0 && !pointer; i--) if (listed.has(full[i]!)) pointer = full[i];
  }
  return {
    ...(settings.remainderRule ? { remainderRule: settings.remainderRule } : {}),
    ...(fund ? { partyFundId: fund } : {}),
    ...(pointer ? { rotation: { lastPurseId: pointer } } : {}),
  };
}
/** Freeze a complete record before clearing active logs; never include prior snapshots recursively. */
export function archiveSession(table: CloudTable, id: string, name: string, at = Date.now()) {
  const journal = (table.journal = readJournal(table.journal));
  for (const p of table.purses.filter((p) => p.editingAllowed)) {
    const sheet = characterSheet(
      p,
      table.holdings,
      table.sheets.find((s) => s.purseId === p.id),
    );
    (journal.editReports ??= []).push({
      id: id + ":" + p.id,
      purseId: p.id,
      name: p.name,
      at,
      before: p.editBaseline || sheet,
      after: sheet,
    });
    p.editingAllowed = false;
    delete p.editBaseline;
  }
  const archived = structuredClone(table);
  delete archived.journal!.reports;
  // DM sees that a private message was sent, but its text stays restricted.
  for (const n of table.notes.filter((n) => n.to === "player"))
    archived.journal!.events.push({
      id: n.id + ":private",
      at: n.at,
      kind: "management",
      summary: "Private message sent between player characters",
      purseId: n.purseId,
    });
  const record = { id, name, at, snapshot: JSON.stringify(archived) };
  (journal.reports ??= []).push(record);
  table.ledger = [];
  table.notes = [];
  journal.events = [];
  journal.editReports = [];
  for (const p of table.purses) p.rolls = [];
  return record;
}
