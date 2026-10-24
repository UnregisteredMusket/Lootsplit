import { emptyCloudTable, type CloudTable, type CloudSeat } from "../cloud.ts";
import { applyCommand } from "../commands.ts";
import { readJournal } from "../journal.ts";
import { readFinance } from "../finance.ts";
import { readEstate } from "../estate-schema.ts";
import { estatePreset } from "../estate-catalogue.ts";
import { campaignMapSchema } from "../world-schema.ts";
import { newProvider } from "../services-presets.ts";
import { serviceQuote } from "../services.ts";
import type { ServiceProvider, ServiceRequest } from "../services-schema.ts";

// Harrowgate (a town): the Temple of the Dawn with Brother Aldous. Kael (player 1) and Thorn
// (player 2's character) are in the party; Wren is away on her own.
export const svcDm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
export const svcKael: CloudSeat = { id: "p1", token: "p1", name: "Kael's player", role: "player", purseIds: ["kael"] };
export const svcThorn: CloudSeat = { id: "p2", token: "p2", name: "Thorn's player", role: "player", purseIds: ["thorn"] };
const coins = (gp: number) => ({ cp: 0, sp: 0, ep: 0, gp, pp: 0 });

export function templeProvider(t?: CloudTable): ServiceProvider {
  void t;
  return newProvider("temple", { id: "temple", name: "Temple of the Dawn" }, "aldous", "dawn-temple");
}

export function servicesFixture(): CloudTable {
  let t: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      { id: "kael", name: "Kael", kind: "character", coins: coins(2340) },
      { id: "thorn", name: "Thorn", kind: "character", coins: coins(10) },
      { id: "wren", name: "Wren", kind: "character", coins: coins(500) },
      { id: "fund", name: "Party fund", kind: "party", coins: coins(100) },
    ],
    holdings: [
      { id: "diamond-500", purseId: "kael", name: "Diamond (500 gp)", kind: "item", quantity: 1, unitCopper: 50000, notes: "" },
      { id: "diamond-300", purseId: "kael", name: "Diamond", kind: "item", quantity: 1, unitCopper: 30000, notes: "" },
      { id: "ruby", purseId: "kael", name: "Big ruby", kind: "item", quantity: 1, unitCopper: 90000, notes: "", materialKey: "ruby" },
      { id: "thorn-diamond", purseId: "thorn", name: "Thorn's diamond", kind: "item", quantity: 1, unitCopper: 60000, notes: "" },
    ],
    shops: [
      {
        id: "temple",
        name: "Temple of the Dawn",
        keeper: "Aldous",
        place: "Harrowgate",
        locationId: "harrowgate",
        category: "general",
        wealth: "modest",
        sellRate: 1,
        buyRate: 0.5,
        priceScale: 1,
        notes: "",
      },
    ],
    journal: readJournal({
      propertyOperations: { materials: [{ key: "ruby", name: "Ruby", unit: "piece" }] },
      finance: { ...readFinance(), day: 41, minuteOfDay: 14 * 60 + 20 },
      market: {
        currentLocationId: "harrowgate",
        locations: [
          { id: "vale", name: "Vale of Harrow", kind: "region", parentId: null, description: "" },
          { id: "harrowgate", name: "Harrowgate", kind: "town", parentId: "vale", description: "" },
          { id: "saltmere", name: "Saltmere", kind: "city", parentId: "vale", description: "" },
        ],
      },
      world: {
        characterPositions: [
          { purseId: "wren", inParty: false, locationId: "saltmere", visible: true, sheetVisible: true },
        ],
      },
    }),
  };
  t = applyCommand(t, svcDm, {
    id: "aldous",
    kind: "npc-create",
    npc: {
      id: "aldous",
      name: "Brother Aldous",
      description: "Keeper of the Temple of the Dawn.",
      locationId: "harrowgate",
      visible: true,
      barterAllowed: false,
      controllerPurseId: null,
      services: ["temple"],
    },
    copper: 0,
    inventory: [],
  });
  return applyCommand(t, svcDm, {
    id: "temple-setup",
    kind: "service-provider",
    providerId: "dawn-temple",
    before: null,
    provider: templeProvider(),
  });
}

export function request(beneficiary: string, contributions: ServiceRequest["contributions"] = []): ServiceRequest {
  return { beneficiaryPurseIds: [beneficiary], units: 1, contributions };
}
/** A ready-to-send order command, quoted against `t` as `purseId` would see it. */
export function orderCommand(
  t: CloudTable,
  id: string,
  offerKey: string,
  purseId: string,
  req: ServiceRequest,
  providerId = "dawn-temple",
) {
  const q = serviceQuote(t, providerId, offerKey, purseId, req);
  return { id, kind: "service-order" as const, providerId, offerKey, purseId, request: req, before: q.before };
}

/**
 * Adds Old Tamsin's Remedies (alchemist) and a scribe at the temple run by Aldous, so Aldous
 * runs two providers. Kael carries 3 bundles of healing herbs.
 */
export function workshopFixture(): CloudTable {
  let t = servicesFixture();
  t.shops.push({ ...t.shops[0], id: "remedies", name: "Old Tamsin's Remedies", keeper: "Tamsin", category: "apothecary" });
  t.holdings.push({ id: "herbs", purseId: "kael", name: "Healing herbs", kind: "item", quantity: 3, unitCopper: 100, notes: "", materialKey: "healing-herbs" });
  t.journal!.propertyOperations!.materials.push({ key: "healing-herbs", name: "Healing herbs", unit: "bundle" });
  t = applyCommand(t, svcDm, {
    id: "tamsin",
    kind: "npc-create",
    npc: {
      id: "tamsin",
      name: "Old Tamsin",
      description: "Herbalist.",
      locationId: "harrowgate",
      visible: true,
      barterAllowed: false,
      controllerPurseId: null,
      services: ["workshop"],
    },
    copper: 0,
    inventory: [],
  });
  const aldous = t.journal!.world!.npcs.find((n) => n.id === "aldous")!;
  t = applyCommand(t, svcDm, { id: "aldous-workshop", kind: "npc-save", before: aldous, npc: { ...aldous, services: ["temple", "workshop"] } });
  t = applyCommand(t, svcDm, {
    id: "alchemist-setup",
    kind: "service-provider",
    providerId: "tamsin-brews",
    before: null,
    provider: newProvider("workshop", { id: "remedies", name: "Old Tamsin's Remedies" }, "tamsin", "tamsin-brews", "srd-5.2.1", "Alchemist"),
  });
  return applyCommand(t, svcDm, {
    id: "scribe-setup",
    kind: "service-provider",
    providerId: "dawn-scribe",
    before: null,
    provider: newProvider("workshop", { id: "temple", name: "Temple of the Dawn" }, "aldous", "dawn-scribe", "srd-5.2.1", "Scribe"),
  });
}

/** Adds the Gilded Goose with Bram Tolliver: SRD 5.2.1 rooms and two rumours. */
export function innFixture(): CloudTable {
  let t = servicesFixture();
  t.shops.push({ ...t.shops[0], id: "goose", name: "Gilded Goose", keeper: "Bram", category: "inn" });
  t = applyCommand(t, svcDm, {
    id: "bram",
    kind: "npc-create",
    npc: {
      id: "bram",
      name: "Bram Tolliver",
      description: "Innkeeper.",
      locationId: "harrowgate",
      visible: true,
      barterAllowed: false,
      controllerPurseId: null,
      services: ["inn"],
    },
    copper: 0,
    inventory: [],
  });
  const provider = newProvider("inn", { id: "goose", name: "Gilded Goose" }, "bram", "goose-inn");
  provider.rumours = [
    { id: "mill", teaser: "Lights at the old mill.", text: "SECRET: lanterns in the old mill three nights running.", priceCopper: 50, once: "character", buyers: [] },
    { id: "toll", teaser: "The toll-road bandits?", text: "SECRET: they camp by the ford.", priceCopper: 100, once: "party", buyers: [] },
  ];
  return applyCommand(t, svcDm, { id: "inn-setup", kind: "service-provider", providerId: "goose-inn", before: null, provider });
}

/**
 * Wave 2 links (docs/SERVICES.md): Rook fences at Rook's Back Room (a black-market shop), and
 * Ottilie Grane runs the Harrowgate Counting House's bank and hire links. The party fund owns a
 * townhouse in Harrowgate with property operations, party-member access.
 */
export function linksFixture(options: { property?: boolean } = {}): CloudTable {
  let t = servicesFixture();
  t.shops.push(
    { ...t.shops[0], id: "back-room", name: "Rook's Back Room", keeper: "Rook", category: "general", blackMarket: true, blackMarketPremium: 1.5, buyRate: 0.3 },
    { ...t.shops[0], id: "counting-house", name: "Harrowgate Counting House", keeper: "Ottilie", category: "general" },
  );
  if (options.property !== false) {
    t.holdings.push({
      id: "townhouse",
      name: "Townhouse on Mill Lane",
      purseId: "fund",
      kind: "property",
      unitCopper: 500000,
      quantity: 1,
      notes: "",
      locationId: "harrowgate",
      property: { type: "other", condition: "ready" },
    } as never);
    t.journal!.propertyOperations = readEstate({
      ...t.journal!.propertyOperations,
      templates: [estatePreset("house")],
      sites: [
        {
          propertyId: "townhouse",
          templateKey: estatePreset("house").key,
          enabled: true,
          access: "party-members",
          accessPurseIds: [],
          capacityWeight: null,
          completedTemplates: [],
          notes: "",
        },
      ],
    });
  }
  for (const [id, name, services] of [
    ["rook", "Rook", ["fence"]],
    ["ottilie", "Ottilie Grane", ["bank", "hire"]],
    ["brannoc", "Brannoc", []],
  ] as const)
    t = applyCommand(t, svcDm, {
      id,
      kind: "npc-create",
      npc: {
        id,
        name,
        description: "",
        locationId: "harrowgate",
        visible: true,
        barterAllowed: false,
        controllerPurseId: null,
        services: [...services],
      },
      copper: 0,
      inventory: [],
    });
  const fence = newProvider("fence", { id: "back-room", name: "Rook's Back Room" }, "rook", "rook-fence");
  const bank = newProvider("bank", { id: "counting-house", name: "Harrowgate Counting House" }, "ottilie", "ottilie-bank");
  const hire = newProvider("hire", { id: "counting-house", name: "Harrowgate Counting House" }, "ottilie", "ottilie-hire");
  hire.link!.roles![0].npcId = "brannoc";
  for (const provider of [fence, bank, hire])
    t = applyCommand(t, svcDm, { id: `${provider.id}-setup`, kind: "service-provider", providerId: provider.id, before: null, provider });
  return t;
}

/**
 * Wave 2 Sage: Magister Quillon at the Gilded Quill offers Identify (50 gp, DM review). Kael wears
 * a plain silver ring and carries a blue bottle; an old longsword is in storage and an odd brass
 * key belongs to the party fund.
 */
export function sageFixture(): CloudTable {
  let t = servicesFixture();
  t.shops.push({ ...t.shops[0], id: "quill", name: "The Gilded Quill", keeper: "Quillon", category: "general" });
  t.holdings.push(
    { id: "ring", purseId: "kael", name: "Plain silver ring", kind: "item", quantity: 1, unitCopper: 2500, notes: "Cold to the touch. No markings.", equipped: true },
    { id: "bottle", purseId: "kael", name: "Stoppered blue bottle", kind: "item", quantity: 1, unitCopper: 100, notes: "" },
    { id: "sword", purseId: "kael", name: "Old longsword", kind: "item", quantity: 1, unitCopper: 1500, notes: "" },
    { id: "key", purseId: "fund", name: "Odd brass key", kind: "item", quantity: 1, unitCopper: 10, notes: "" },
    { id: "thorn-amulet", purseId: "thorn", name: "Thorn's amulet", kind: "item", quantity: 1, unitCopper: 10, notes: "" },
  );
  t = applyCommand(t, svcDm, {
    id: "quillon",
    kind: "npc-create",
    npc: {
      id: "quillon",
      name: "Magister Quillon",
      description: "Sage of the Gilded Quill.",
      locationId: "harrowgate",
      visible: true,
      barterAllowed: false,
      controllerPurseId: null,
      services: ["sage"],
    },
    copper: 0,
    inventory: [],
  });
  return applyCommand(t, svcDm, {
    id: "sage-setup",
    kind: "service-provider",
    providerId: "quill-sage",
    before: null,
    provider: newProvider("sage", { id: "quill", name: "The Gilded Quill" }, "quillon", "quill-sage"),
  });
}
/** An Identify request for one carried item. */
export function identifyCommand(t: CloudTable, id: string, holdingId: string, purseId = "kael") {
  const req: ServiceRequest = { beneficiaryPurseIds: [], units: 1, contributions: [], itemHoldingId: holdingId };
  return orderCommand(t, id, "identify", purseId, req, "quill-sage");
}

/**
 * Wave 2 Trainer: Mistress Vey at the Tumbler's Lockworks teaches Thieves' tools at 2 gp a training
 * day. Downtime days 41–44 are approved: 64 hours for each character and for Vey (8-hour training days).
 */
export function trainerFixture(): CloudTable {
  let t = servicesFixture();
  t.shops.push({ ...t.shops[0], id: "lockworks", name: "The Tumbler's Lockworks", keeper: "Vey", category: "general" });
  t = applyCommand(t, svcDm, {
    id: "vey",
    kind: "npc-create",
    npc: {
      id: "vey",
      name: "Mistress Vey",
      description: "Locksmith.",
      locationId: "harrowgate",
      visible: true,
      barterAllowed: false,
      controllerPurseId: null,
      services: ["trainer"],
    },
    copper: 0,
    inventory: [],
  });
  t = applyCommand(t, svcDm, {
    id: "trainer-setup",
    kind: "service-provider",
    providerId: "vey-lessons",
    before: null,
    provider: newProvider("trainer", { id: "lockworks", name: "The Tumbler's Lockworks" }, "vey", "vey-lessons"),
  });
  t.journal!.downtimeActivities = {
    settings: { hoursPerDay: 16, trainingHoursPerDay: 8 },
    windows: [
      {
        id: "w41",
        name: "Downtime",
        fromDay: 41,
        days: 4,
        settings: { hoursPerDay: 16, trainingHoursPerDay: 8 },
        budgets: ["kael", "thorn", "vey", "aldous"].map((purseId) => ({ purseId, totalMinutes: 64 * 60, committedMinutes: 0 })),
      },
    ],
    requests: [],
    resets: [],
  };
  return t;
}
/** Book Thieves' tools lessons for a pupil (the payer by default). */
export function lessonsCommand(t: CloudTable, id: string, days: number, purseId = "kael", pupil = purseId) {
  return orderCommand(t, id, "thieves-tools", purseId, { beneficiaryPurseIds: [pupil], units: days, contributions: [] }, "vey-lessons");
}
/** Log a session of `hours` against an agreement. */
export function sessionCommand(id: string, orderId: string, hours: number, pupil = "kael") {
  return {
    id,
    kind: "downtime-training" as const,
    windowId: "w41",
    trainerId: pupil,
    npcId: "vey",
    category: "profession" as const,
    topic: "Thieves' tools",
    description: "Warded locks",
    className: "",
    minutes: hours * 60,
    lessonOrderId: orderId,
  };
}

/**
 * Wave 2 Courier: Pell Quickfoot at Harrowgate Post delivers to Saltmere (38.2 mi, 2 days) and
 * Greyford (61.1 mi, 3 days). Kael has threads with Lady Marrow (Saltmere), Captain Reyne
 * (Greyford), Old Tamsin (here) and a hidden spy; Thorn has a thread with Lady Marrow only.
 */
export function courierFixture(): CloudTable {
  let t = servicesFixture();
  t.journal!.market!.locations.push({ id: "greyford", name: "Greyford", kind: "town", parentId: "vale", description: "" } as never);
  t.journal!.market!.locations.push({ id: "saltmere-docks", name: "Saltmere docks", kind: "area", parentId: "saltmere", description: "" } as never);
  t.shops.push({ ...t.shops[0], id: "post", name: "Harrowgate Post", keeper: "Pell", category: "general" });
  for (const [id, name, locationId, visible, services] of [
    ["pell", "Pell Quickfoot", "harrowgate", true, ["courier"]],
    ["marrow", "Lady Marrow", "saltmere-docks", true, []],
    ["reyne", "Captain Reyne", "greyford", true, []],
    ["tamsin", "Old Tamsin", "harrowgate", true, []],
    ["spy", "The Grey Spy", "saltmere", false, []],
  ] as const)
    t = applyCommand(t, svcDm, {
      id,
      kind: "npc-create",
      npc: { id, name, description: "", locationId, visible, barterAllowed: false, controllerPurseId: null, services: [...services] },
      copper: 0,
      inventory: [],
    });
  const thread = (npcId: string, purseId: string) => ({
    id: `${npcId}:${purseId}`,
    npcId,
    purseId,
    messages: [{ id: `${npcId}-${purseId}-hello`, author: "character" as const, text: "Well met.", at: 1 }],
  });
  t.journal!.world!.conversations.push(
    thread("marrow", "kael"),
    thread("reyne", "kael"),
    thread("tamsin", "kael"),
    thread("spy", "kael"),
    thread("marrow", "thorn"),
  );
  const courier = newProvider("courier", { id: "post", name: "Harrowgate Post" }, "pell", "post-courier");
  courier.destinations = [
    { locationId: "saltmere", deciMiles: 382, days: 2 },
    { locationId: "greyford", deciMiles: 611, days: 3 },
  ];
  return applyCommand(t, svcDm, { id: "courier-setup", kind: "service-provider", providerId: "post-courier", before: null, provider: courier });
}
/** Send a letter. */
export function letterCommand(t: CloudTable, id: string, recipientNpcId: string, text = "My lady, the lights at the old mill were no rumour.", purseId = "kael") {
  const req: ServiceRequest = { beneficiaryPurseIds: [], units: 1, contributions: [], letter: { recipientNpcId, text } };
  return orderCommand(t, id, "letter", purseId, req, "post-courier");
}

/**
 * Wave 2 Stable: Hollin Marsh at Marsh's Livery & Coaching. Kael owns a riding horse, the party
 * fund a pack mule, Thorn a pony. The Vale of Harrow map (100 mi across) has the coach route to
 * Saltmere drawn (38.2 mi, 30 mi a day); the route to Old Mill Crossing isn't drawn yet.
 */
export function stableFixture(): CloudTable {
  let t = servicesFixture();
  t.journal!.market!.locations.push({ id: "mill", name: "Old Mill Crossing", kind: "town", parentId: "vale", description: "" } as never);
  t.shops.push({ ...t.shops[0], id: "livery", name: "Marsh's Livery & Coaching", keeper: "Hollin", category: "general" });
  t.holdings.push(
    { id: "horse", purseId: "kael", name: "Riding horse", kind: "item", quantity: 1, unitCopper: 7500, notes: "" },
    { id: "mule", purseId: "fund", name: "Pack mule", kind: "item", quantity: 1, unitCopper: 800, notes: "" },
    { id: "pony", purseId: "thorn", name: "Pony", kind: "item", quantity: 1, unitCopper: 3000, notes: "" },
  );
  t.journal!.world!.maps.push(
    campaignMapSchema.parse({
      id: "vale-map",
      name: "Vale of Harrow",
      image: "data:image/png;base64,YQ==",
      locationId: "vale",
      visible: true,
      type: "regional",
      anchors: [
        { locationId: "harrowgate", x: 0.2, y: 0.5 },
        { locationId: "saltmere", x: 0.582, y: 0.5 },
      ],
      markers: [],
      scale: { a: { x: 0, y: 0.5 }, b: { x: 1, y: 0.5 }, distance: 100, unit: "mi", aspect: 1 },
    }),
  );
  t = applyCommand(t, svcDm, {
    id: "hollin",
    kind: "npc-create",
    npc: { id: "hollin", name: "Hollin Marsh", description: "", locationId: "harrowgate", visible: true, barterAllowed: false, controllerPurseId: null, services: ["stable"] },
    copper: 0,
    inventory: [],
  });
  const stable = newProvider("stable", { id: "livery", name: "Marsh's Livery & Coaching" }, "hollin", "livery-stable");
  stable.routes = [
    {
      key: "saltmere",
      toLocationId: "saltmere",
      mapId: "vale-map",
      points: [
        { x: 0.2, y: 0.5, locationId: "harrowgate" },
        { x: 0.582, y: 0.5, locationId: "saltmere" },
      ],
      legs: [{ environment: "Roads" }],
      paceMilesPerDay: 30,
    },
    { key: "mill", toLocationId: "mill", paceMilesPerDay: 30 },
  ];
  return applyCommand(t, svcDm, { id: "stable-setup", kind: "service-provider", providerId: "livery-stable", before: null, provider: stable });
}
export function stablingCommand(t: CloudTable, id: string, animals: string[], nights = 3, feed = true, purseId = "kael") {
  const req: ServiceRequest = { beneficiaryPurseIds: [], units: nights, contributions: [], stabling: { animalHoldingIds: animals, feed } };
  return orderCommand(t, id, "stabling", purseId, req, "livery-stable");
}
export function coachCommand(t: CloudTable, id: string, routeKey = "saltmere", purseId = "kael") {
  const req: ServiceRequest = { beneficiaryPurseIds: [], units: 1, contributions: [], routeKey };
  return orderCommand(t, id, "coach", purseId, req, "livery-stable");
}
