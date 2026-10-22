import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { emptyCloudTable, readCloudTable, type CloudTable, type CloudSeat } from "./cloud.ts";
import { applyCommand, type CommandInput } from "./commands.ts";
import { readEstate, type EstateTemplate } from "./estate-schema.ts";
import { estateImportFingerprint } from "./estate-import.ts";
import { estatePreset } from "./estate-catalogue.ts";
import { estateSetupNeeds, purchaseSite } from "./estate.ts";
import { readJournal } from "./journal.ts";
import { readFinance } from "./finance.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { setSeat, DM_SEAT } from "./table.ts";

// Follow-up to P3a (PR #165): properties bought from an estate listing before the fix have a
// deed but no operating record. The DM repairs them explicitly; nothing changes automatically.

const dm: CloudSeat = { id: "dm", name: "DM", token: "dm", role: "dm", purseIds: [] };
const player: CloudSeat = {
  id: "player",
  name: "Player",
  token: "player",
  role: "player",
  purseIds: ["party"],
};
let receipt = 0;
const command = (t: CloudTable, input: CommandInput, seat = dm) =>
  applyCommand(t, seat, { ...input, id: `estate-repair-test-${++receipt}` });

function imported(): CloudTable {
  const doc = JSON.parse(
    readFileSync(
      new URL("../../../docs/examples/property-operations.sample.json", import.meta.url),
      "utf8",
    ),
  );
  const t: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      {
        id: "party",
        name: "Party treasury",
        kind: "party",
        coins: { cp: 1_000_000, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
    ],
    journal: readJournal({ finance: readFinance(), propertyOperations: readEstate() }),
  };
  return command(t, {
    kind: "estate-import",
    before: estateImportFingerprint(t),
    document: doc,
    owners: { "party-treasury": "party" },
    locations: {},
  });
}
const houseId = (t: CloudTable) => t.listings.find((l) => l.name === "Lantern House")!.id;
/** The pre-fix offline state: the stored listing lost its key, so the purchase made no record. */
function legacyPurchase(t: CloudTable, listingId: string) {
  const stripped = structuredClone(t);
  const listing = stripped.listings.find((l) => l.id === listingId)!;
  delete listing.estateTemplateKey;
  delete listing.estateAttachments;
  const next = command(stripped, { kind: "listing", listingId, purseId: "party", quantity: 1 });
  const bought = next.holdings.find((h) => h.deed?.listingId === listingId)!;
  assert.ok(bought.deed, "the legacy purchase wrote a deed");
  assert.ok(
    !readEstate(next.journal?.propertyOperations).sites.some((s) => s.propertyId === bought.id),
    "the legacy purchase made no operating record",
  );
  return { table: next, holding: bought };
}
const freshPurchase = (t: CloudTable, listingId: string) => {
  const next = command(structuredClone(t), {
    kind: "listing",
    listingId,
    purseId: "party",
    quantity: 1,
  });
  return { table: next, holding: next.holdings.find((h) => h.deed?.listingId === listingId)! };
};
const siteOf = (t: CloudTable, propertyId: string) => {
  const site = readEstate(t.journal?.propertyOperations).sites.find(
    (s) => s.propertyId === propertyId,
  );
  assert.ok(site, "an operating record exists");
  return { ...site, propertyId: "bought" };
};
const unchangedEconomy = (a: CloudTable, b: CloudTable) => {
  assert.deepEqual(b.purses, a.purses, "no coins move");
  assert.deepEqual(b.holdings, a.holdings, "no deed or holding changes");
  assert.deepEqual(b.ledger, a.ledger, "no ledger line is written");
  assert.deepEqual(b.listings, a.listings, "listings are untouched");
};
const setupInput = (template: EstateTemplate, propertyId: string, attachments: string[] = []) =>
  ({
    kind: "estate-site",
    before: null,
    site: purchaseSite(template, propertyId, attachments),
  }) as const;
const template = (t: CloudTable, key: string) =>
  readEstate(t.journal?.propertyOperations).templates.find((x) => x.key === key)!;

test("detection flags only deeded estate purchases that lack an operating record", () => {
  const base = imported();
  const { table, holding } = legacyPurchase(base, houseId(base));
  const needs = estateSetupNeeds(table, dm);
  assert.deepEqual(
    needs.map((n) => [n.holding.id, n.listingId, n.templateKey, n.receipt]),
    [[holding.id, houseId(base), "house", true]],
    "the template is inferred from the only residence template; the receipt is found",
  );
  // A client read of the shared table detects the same holdings.
  assert.deepEqual(estateSetupNeeds(readCloudTable(structuredClone(table))!, dm), needs);
  // Negative: a fresh purchase has its record; an imported owned holding already has a site.
  const fresh = freshPurchase(base, houseId(base));
  assert.deepEqual(estateSetupNeeds(fresh.table, dm), []);
  assert.deepEqual(estateSetupNeeds(base, dm), []);
  // Negative: an ordinary market property (not from an import, no template) is not flagged,
  // nor is a DM-added property without a deed.
  const plain = structuredClone(base);
  plain.listings.push({
    id: "market-cottage",
    name: "Cottage",
    kind: "property",
    copper: 100,
    quantity: 1,
    notes: "",
    property: { type: "residence" },
  });
  const boughtPlain = command(plain, {
    kind: "listing",
    listingId: "market-cottage",
    purseId: "party",
    quantity: 1,
  });
  boughtPlain.holdings.push({
    id: "dm-added",
    purseId: "party",
    name: "Old mill",
    kind: "property",
    quantity: 1,
    unitCopper: 0,
    notes: "",
  });
  assert.deepEqual(estateSetupNeeds(boughtPlain, dm), []);
  // The receipt is evidence, not a requirement: archived sessions close older ledger lines.
  assert.equal(estateSetupNeeds({ ...table, ledger: [] }, dm)[0]?.holding.id, holding.id);
  assert.equal(estateSetupNeeds({ ...table, ledger: [] }, dm)[0]?.receipt, false);
});

test("template inference prefers the listing's key and leaves ambiguous types to the DM", () => {
  const base = imported();
  const { table, holding } = legacyPurchase(base, houseId(base));
  const ambiguous = command(table, {
    kind: "estate-template",
    before: null,
    template: { ...template(table, "house"), key: "manor", name: "Manor" },
    materials: [],
  });
  assert.equal(estateSetupNeeds(ambiguous, dm)[0].templateKey, undefined);
  // A listing that still names its template (with attachments) is used as-is.
  const named = structuredClone(ambiguous);
  Object.assign(named.listings.find((l) => l.id === houseId(base))!, {
    estateTemplateKey: "house",
    estateAttachments: ["land", "missing-template"],
  });
  const need = estateSetupNeeds(named, dm)[0];
  assert.equal(need.holding.id, holding.id);
  assert.equal(need.templateKey, "house");
  assert.deepEqual(need.attachments, ["land"], "unknown attachment keys are not proposed");
});

test("players never receive the prompt and cannot apply either setup command", () => {
  const base = imported();
  const { table, holding } = legacyPurchase(base, houseId(base));
  assert.deepEqual(estateSetupNeeds(table, player), []);
  assert.throws(
    () => command(table, setupInput(template(table, "house"), holding.id), player),
    /Only the DM/,
  );
  const ship = command(table, {
    kind: "estate-template",
    before: null,
    template: estatePreset("ship"),
    materials: [],
  });
  assert.throws(
    () =>
      command(
        ship,
        { kind: "estate-ship-setup", propertyId: holding.id, templateKey: "ship", attachments: [] },
        player,
      ),
    /Only the DM/,
  );
});

test("setup creates the record a fresh purchase creates, without charge, and retries are refused", () => {
  const base = imported();
  const { table, holding } = legacyPurchase(base, houseId(base));
  const fresh = freshPurchase(base, houseId(base));
  const input = setupInput(template(table, "house"), holding.id);
  const repaired = command(table, input);
  assert.deepEqual(siteOf(repaired, holding.id), siteOf(fresh.table, fresh.holding.id));
  unchangedEconomy(table, repaired);
  assert.deepEqual(estateSetupNeeds(repaired, dm), []);
  // Idempotent: a retry (same or new command id) finds the record and changes nothing.
  assert.throws(() => command(repaired, input), /settings changed/);
  assert.throws(
    () => applyCommand(repaired, dm, { ...input, id: `estate-repair-test-${receipt}` }),
    /settings changed/,
  );
  assert.equal(
    readEstate(repaired.journal?.propertyOperations).sites.filter(
      (s) => s.propertyId === holding.id,
    ).length,
    1,
  );
});

function shipTable() {
  let t: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      {
        id: "party",
        name: "Treasury",
        kind: "party",
        coins: { cp: 1_000_000, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
    ],
    journal: readJournal({
      finance: readFinance(),
      market: {
        currentLocationId: "port",
        locations: [
          { id: "region", name: "Coast", kind: "region", parentId: null, description: "" },
          { id: "port", name: "Port", kind: "city", parentId: "region", description: "" },
        ],
      },
    }),
  };
  for (const key of ["ship", "shipyard"])
    t = command(t, {
      kind: "estate-template",
      before: null,
      template: estatePreset(key),
      materials: [],
    });
  for (const [id, name, key] of [
    ["r1-property-0", "Dawn Trader", "ship"],
    ["r1-property-1", "Harbor yard", "shipyard"],
  ])
    t.listings.push({
      id,
      name,
      kind: "property",
      copper: 5000,
      quantity: 1,
      notes: "",
      locationId: "port",
      property: { type: estatePreset(key).propertyType },
      estateTemplateKey: key,
    });
  return t;
}

test("ship and shipyard setup creates the same site and fleet record as a fresh purchase", () => {
  for (const [listingId, key] of [
    ["r1-property-0", "ship"],
    ["r1-property-1", "shipyard"],
  ]) {
    const base = shipTable();
    const { table, holding } = legacyPurchase(base, listingId);
    const fresh = freshPurchase(base, listingId);
    const need = estateSetupNeeds(table, dm).find((n) => n.holding.id === holding.id)!;
    assert.ok(need, `${key}: the legacy purchase is flagged`);
    // Ship templates need their fleet record: estate-site alone is not offered for them.
    const input = {
      kind: "estate-ship-setup",
      propertyId: holding.id,
      templateKey: key,
      attachments: [],
    } as const;
    const repaired = command(table, input);
    assert.deepEqual(siteOf(repaired, holding.id), siteOf(fresh.table, fresh.holding.id));
    const fleet = (t: CloudTable, id: string) => ({
      vessels: t
        .journal!.fleet!.vessels.filter((v) => v.propertyId === id)
        .map((v) => ({ ...v, propertyId: "bought" })),
      facilities: t
        .journal!.fleet!.facilities.filter((y) => y.propertyId === id)
        .map((y) => ({ ...y, id: "yard", propertyId: "bought" })),
    });
    assert.deepEqual(fleet(repaired, holding.id), fleet(fresh.table, fresh.holding.id));
    assert.equal(fleet(repaired, holding.id)[key === "ship" ? "vessels" : "facilities"].length, 1);
    unchangedEconomy(table, repaired);
    assert.deepEqual(estateSetupNeeds(repaired, dm), [], `${key}: no longer flagged`);
    assert.throws(() => command(repaired, input), /settings changed/);
  }
  // The ship command refuses ordinary templates; those use estate-site.
  const house = imported();
  const { table, holding } = legacyPurchase(house, houseId(house));
  assert.throws(
    () =>
      command(table, {
        kind: "estate-ship-setup",
        propertyId: holding.id,
        templateKey: "house",
        attachments: [],
      }),
    /ship or shipyard template/,
  );
});

test("offline setup through the device engine matches the shared engine", async () => {
  setSeat(DM_SEAT);
  const cases: [CloudTable, string, (h: string) => CommandInput][] = [];
  {
    const base = imported();
    cases.push([base, houseId(base), (h) => setupInput(template(base, "house"), h)]);
  }
  {
    const base = shipTable();
    cases.push([
      base,
      "r1-property-0",
      (h) => ({ kind: "estate-ship-setup", propertyId: h, templateKey: "ship", attachments: [] }),
    ]);
  }
  for (const [base, listingId, input] of cases) {
    const { table, holding } = legacyPurchase(base, listingId);
    const shared = command(structuredClone(table), input(holding.id));
    await applyCloudTable(structuredClone(table));
    const loaded = await economySnapshot();
    assert.deepEqual(
      estateSetupNeeds(loaded, dm).map((n) => n.holding.id),
      [holding.id],
      "the offline save is flagged",
    );
    const before = structuredClone(loaded);
    await executeLocalCommand(input(holding.id));
    const offline = await economySnapshot();
    assert.deepEqual(siteOf(offline, holding.id), siteOf(shared, holding.id));
    assert.deepEqual(offline.journal?.fleet?.vessels ?? [], shared.journal?.fleet?.vessels ?? []);
    assert.deepEqual(offline.purses, before.purses, "offline: no coins move");
    assert.deepEqual(offline.holdings, before.holdings, "offline: deed unchanged");
    assert.deepEqual(offline.listings, before.listings);
    assert.deepEqual(estateSetupNeeds(offline, dm), []);
    // A retry (double tap, reload) is refused and leaves one record.
    await assert.rejects(executeLocalCommand(input(holding.id)), /settings changed/);
    const retried = await economySnapshot();
    assert.deepEqual(
      readEstate(retried.journal?.propertyOperations).sites,
      readEstate(offline.journal?.propertyOperations).sites,
    );
  }
});
