import type { CloudTable, CloudSeat } from "./cloud.ts";
import { canReadNote } from "./chat-visibility.ts";
import { characterSheet } from "../characters/campaign-sheet.mjs";
import { readFinance } from "./finance.ts";
import { readJournal, readJournalForRecords, readArchivedSnapshot } from "./journal.ts";
import { readMarketLocations, publicMarketLocations, shopAvailableHere } from "./shop-locations.ts";
import { propertyAvailableHere } from "./property.ts";
import { canAccessEstate } from "./estate.ts";
import { readEstate } from "./estate-schema.ts";

/** Server/default projections enforce historical seats; verified local DM readers may retain their owned nested records. */
export function projectRecord(
  table: CloudTable,
  seat: Pick<CloudSeat, "role" | "purseIds"> & { id?: string },
  options: { ownedDevice?: boolean } = {},
): CloudTable {
  const t = structuredClone(table);
  const dm = seat.role === "dm";
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
      try {
        return {
          ...r,
          snapshot: JSON.stringify(
            projectRecord(readArchivedSnapshot(r.snapshot), seat, { ownedDevice }),
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
    });
  t.journal.editReports = t.journal.editReports?.filter(
    (r) => dm || seat.purseIds.includes(r.purseId),
  );
  if (!dm) {
    const estate = readEstate(t.journal.propertyOperations);
    const visibleSites = new Set(
      estate.sites
        .filter((site) => canAccessEstate(t, estate, site.propertyId, seat))
        .map((site) => site.propertyId),
    );
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
    const market = readMarketLocations(t.journal.market);
    t.shops = t.shops.filter((shop) => shopAvailableHere(shop, market));
    t.listings = t.listings.filter(
      (listing) =>
        propertyAvailableHere(listing, market) &&
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
          .flatMap((h) => (h.locationId ? [h.locationId] : [])),
      );
    t.ledger = t.ledger.filter((l) => seat.purseIds.includes(l.purseId));
    t.holdings = t.holdings.filter(
      (h) =>
        seat.purseIds.includes(h.purseId) ||
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
      ]);
      estate.materials = estate.materials.filter((material) => materials.has(material.key));
    }
    const publicNames = new Set([
      ...sharedOwners,
      ...t.holdings.map((h) => h.purseId),
      ...estate.jobs.flatMap((j) => [j.purseId, ...j.assignments.map((a) => a.purseId)]),
      ...estate.letters.map((l) => l.senderId),
      ...estate.withdrawals.map((r) => r.purseId),
    ]);
    t.purses = t.purses
      .filter((p) => seat.purseIds.includes(p.id) || publicNames.has(p.id))
      .map((p) =>
        seat.purseIds.includes(p.id)
          ? p
          : { id: p.id, name: p.name, kind: p.kind, coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } },
      );
    if (t.journal.finance) {
      const f = readFinance(t.journal.finance);
      t.journal.finance = {
        day: f.day,
        loans: f.loans.filter((l) => seat.purseIds.includes(l.purseId)),
        rules: f.rules.filter((r) => seat.purseIds.includes(r.purseId)),
        downtime: [],
      };
    }
    t.journal.requests = t.journal.requests.filter((r) => seat.purseIds.includes(r.purseId));
    t.journal.events = t.journal.events
      .filter((e) =>
        e.propertyId
          ? visibleSites.has(e.propertyId) || (!!e.purseId && seat.purseIds.includes(e.purseId))
          : !e.purseId || seat.purseIds.includes(e.purseId),
      )
      .map(({ change, ...e }) => e);
    t.loans = t.loans.filter((l) => seat.purseIds.includes(l.purseId));
    t.sheets = t.sheets.filter((s) => seat.purseIds.includes(s.purseId));
  }
  for (const p of t.purses) delete p.editBaseline;
  return t;
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
