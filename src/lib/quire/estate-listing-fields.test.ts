import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { emptyCloudTable, readCloudTable, type CloudTable, type CloudSeat } from "./cloud.ts";
import { applyCommand, type CommandInput } from "./commands.ts";
import { readEstate } from "./estate-schema.ts";
import { estateImportFingerprint } from "./estate-import.ts";
import { readJournal } from "./journal.ts";
import { readFinance } from "./finance.ts";
import { readListings } from "./market.ts";
import { applyCloudTable, buyListing, economySnapshot } from "./economy.ts";
import { setSeat, DM_SEAT } from "./table.ts";

// P3a (October 22 review): normalizeListing dropped estateTemplateKey and estateAttachments,
// so shared purchases of imported estate listings failed the `before` check and offline
// purchases skipped initializeEstatePurchase (no operating record).

const dm: CloudSeat = { id: "dm", name: "DM", token: "dm", role: "dm", purseIds: [] };
let receipt = 0;
const command = (t: CloudTable, input: CommandInput) =>
  applyCommand(t, dm, { ...input, id: `estate-listing-test-${++receipt}` });

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

const houseListing = (t: CloudTable) => t.listings.find((l) => l.name === "Lantern House")!;

test("listing normalization keeps estate template and attachment fields", () => {
  const raw = {
    id: "estate",
    name: "Lantern House",
    kind: "property",
    copper: 80000,
    quantity: 1,
    notes: "",
    status: "available",
    estateTemplateKey: "house",
    estateAttachments: ["garden", "well"],
  };
  const [listing] = readListings([raw]);
  assert.equal(listing.estateTemplateKey, "house");
  assert.deepEqual(listing.estateAttachments, ["garden", "well"]);
  assert.deepEqual(readListings(readListings([raw])), readListings([raw]));
  // Damaged estate fields must not make an old save unreadable.
  const [damaged] = readListings([{ ...raw, estateTemplateKey: "Not Valid!", estateAttachments: "x" }]);
  assert.equal(damaged.id, "estate");
  assert.equal(damaged.estateTemplateKey, undefined);
  assert.equal(damaged.estateAttachments, undefined);
  // Item listings never carry estate fields; the listing itself stays readable.
  const [item] = readListings([{ ...raw, kind: "item", status: undefined }]);
  assert.equal(item.kind, "item");
  assert.equal(item.estateTemplateKey, undefined);
});

test("imported estate listings survive the client cloud-table read unchanged", () => {
  const server = imported();
  const client = readCloudTable(structuredClone(server))!;
  assert.ok(client);
  assert.deepEqual(client.listings, server.listings);
  assert.equal(houseListing(client).estateTemplateKey, "house");
});

test("shared-room purchase of an imported estate listing accepts the client copy and creates the operating record", () => {
  const server = imported();
  const client = readCloudTable(structuredClone(server))!;
  const before = structuredClone(houseListing(client));
  const next = command(server, {
    kind: "listing",
    listingId: before.id,
    purseId: "party",
    quantity: 1,
    before,
  });
  const bought = next.holdings.find((h) => h.deed?.listingId === before.id)!;
  assert.ok(bought);
  const site = next.journal!.propertyOperations!.sites.find((s) => s.propertyId === bought.id);
  assert.equal(site?.templateKey, "house");
  assert.equal(site?.enabled, true);
});

test("offline purchase of an imported estate listing matches the shared engine", async () => {
  setSeat(DM_SEAT);
  const server = imported();
  const listingId = houseListing(server).id;
  const shared = command(structuredClone(server), {
    kind: "listing",
    listingId,
    purseId: "party",
    quantity: 1,
  });
  await applyCloudTable(structuredClone(server));
  assert.equal(
    (await economySnapshot()).listings.find((l) => l.id === listingId)?.estateTemplateKey,
    "house",
  );
  await buyListing({ listingId, purseId: "party", quantity: 1 });
  const offline = await economySnapshot();
  const sitesFor = (t: CloudTable) => {
    const holding = t.holdings.find((h) => h.deed?.listingId === listingId)!;
    assert.ok(holding, "the purchase created a deeded holding");
    const site = t.journal!.propertyOperations!.sites.find((s) => s.propertyId === holding.id);
    assert.ok(site, "the purchase created an operating record");
    return { ...site, propertyId: "bought" };
  };
  assert.deepEqual(sitesFor(offline), sitesFor(shared));
  assert.deepEqual(
    offline.purses.find((p) => p.id === "party")!.coins,
    shared.purses.find((p) => p.id === "party")!.coins,
  );
  assert.deepEqual(
    offline.listings.find((l) => l.id === listingId),
    shared.listings.find((l) => l.id === listingId),
  );
});
