import type { CloudTable, CloudSeat } from "./cloud.ts";
import type { Holding } from "./types.ts";
import { canonicalJson } from "./canonical-json.ts";
import { locationPath, readMarketLocations, shopAvailableHere } from "./shop-locations.ts";
import { toCopper, fromCopper, spendCoins, priceAfterCharisma } from "./money.ts";
import { charismaScore } from "./sheet.ts";
import { isService } from "./merchant.ts";
import { transferPropertyDeed } from "./property-deed.ts";
import {
  readEstate,
  type Estate,
  type EstateCommand,
  type EstateJob,
  type EstateOrder,
  type EstateSite,
  type EstateTemplate,
} from "./estate-schema.ts";

type Table = Pick<CloudTable, "purses" | "holdings" | "journal" | "shops" | "stock">;
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const property = (t: Table, id: string) => {
  const h = t.holdings.find((h) => h.id === id && h.kind === "property" && h.quantity > 0);
  if (!h) throw Error("This property no longer exists.");
  return h;
};
export function estateTemplates(state: Estate, site: EstateSite): EstateTemplate[] {
  return [site.templateKey, ...site.completedTemplates]
    .map((key) => state.templates.find((t) => t.key === key))
    .filter((t): t is EstateTemplate => !!t);
}
export function estateCapabilities(state: Estate, site: EstateSite) {
  return new Set(estateTemplates(state, site).flatMap((t) => t.capabilities));
}
export function physicallyHere(t: Table, h: Holding) {
  const market = readMarketLocations(t.journal?.market);
  return (
    !!h.locationId &&
    !!market.currentLocationId &&
    locationPath(market, market.currentLocationId).some((l) => l.id === h.locationId)
  );
}
export function canAccessEstate(
  t: Pick<Table, "purses" | "holdings">,
  state: Estate,
  propertyId: string,
  seat: Pick<CloudSeat, "role" | "purseIds">,
) {
  if (seat.role === "dm") return true;
  const h = t.holdings.find((h) => h.id === propertyId && h.kind === "property"),
    site = state.sites.find((s) => s.propertyId === propertyId);
  if (!h || !site || !seat.purseIds.some((id) => t.purses.some((p) => p.id === id))) return false;
  return (
    seat.purseIds.includes(h.purseId) ||
    (site.access === "party-members" &&
      t.purses.some((p) => p.id === h.purseId && p.kind === "party")) ||
    (site.access === "selected" && site.accessPurseIds.some((id) => seat.purseIds.includes(id)))
  );
}
export function storageWeight(t: Pick<Table, "holdings">, propertyId: string) {
  const items = t.holdings.filter(
    (h) => h.custody?.kind === "property" && h.custody.propertyId === propertyId,
  );
  return {
    weight: items.reduce((n, h) => n + (h.weight ?? 0) * h.quantity, 0),
    unknown: items.some((h) => h.weight === undefined),
  };
}
function capacity(t: Pick<Table, "holdings">, site: EstateSite, item: Holding, count: number) {
  if (site.capacityWeight === null) return;
  const used = storageWeight(t, site.propertyId);
  if (used.unknown || item.weight === undefined)
    throw Error("The DM must set the missing item weights before using weight-limited storage.");
  if (used.weight + item.weight * count > site.capacityWeight)
    throw Error("This storage has insufficient remaining capacity.");
}
export function assertCarried(h: Holding) {
  if (h.custody || h.reservedFor)
    throw Error(
      "Retrieve this item from its property first. Goods in storage, delivery or reserved for work cannot be equipped, consumed, sold or given remotely.",
    );
}
export function assertEstateDisposable(t: Table, propertyId: string) {
  const s = readEstate(t.journal?.propertyOperations);
  if (
    t.holdings.some((h) => h.custody?.propertyId === propertyId) ||
    s.jobs.some(
      (j) =>
        j.propertyId === propertyId && !["completed", "cancelled", "denied"].includes(j.status),
    ) ||
    s.staff.some(
      (c) => c.propertyId === propertyId && ["active", "paused", "proposed"].includes(c.status),
    ) ||
    s.rentals.some((r) => r.propertyId === propertyId && (r.active || r.occupied)) ||
    s.letters.some(
      (l) => l.propertyId === propertyId && ["in-transit", "blocked"].includes(l.status),
    ) ||
    s.standingOrders.some((o) => o.propertyId === propertyId && o.active) ||
    s.withdrawals.some(
      (r) => r.propertyId === propertyId && ["pending", "approved"].includes(r.status),
    ) ||
    t.journal?.finance?.rules.some((r) => r.holdingId === propertyId && (r.active || r.arrears))
  )
    throw Error(
      "Resolve stored goods, work, staff, tenants, orders and unpaid expenses before selling or giving this property. The DM can record an explicit handover that keeps its contents and agreements.",
    );
}
export function initializeEstatePurchase(
  t: CloudTable,
  holding: Holding,
  templateKey?: string,
  attachments: string[] = [],
) {
  if (!templateKey) return;
  if (holding.quantity !== 1)
    throw Error(
      "Acquire an operating property's legal parcel one at a time. Each parcel receives its own deed and operating record.",
    );
  const s = readEstate(t.journal?.propertyOperations),
    template = s.templates.find((x) => x.key === templateKey);
  if (!template)
    throw Error(
      "This listing's property template is missing; ask the DM to repair it before purchase.",
    );
  s.sites.push({
    propertyId: holding.id,
    templateKey,
    enabled: true,
    access: template.storage?.defaultAccess ?? "owner",
    accessPurseIds: [],
    capacityWeight: template.storage?.capacityWeight ?? null,
    completedTemplates: attachments,
    notes: "",
  });
  t.journal!.propertyOperations = s;
}
export function removeEstateSite(t: CloudTable, propertyId: string) {
  if (!t.journal?.propertyOperations) return;
  const s = t.journal.propertyOperations;
  s.sites = s.sites.filter((site) => site.propertyId !== propertyId);
  s.rentals = s.rentals.filter((r) => r.propertyId !== propertyId);
}
export function validateEstate(t: Table, projected = false) {
  if (
    !t.journal?.propertyOperations &&
    !t.holdings.some((h) => h.custody || h.reservedFor || h.materialKey)
  )
    return;
  const s = readEstate(t.journal?.propertyOperations),
    templates = new Set(s.templates.map((x) => x.key)),
    materials = new Set(s.materials.map((x) => x.key));
  const sites = new Map(s.sites.map((x) => [x.propertyId, x]));
  for (const template of s.templates)
    for (const recipe of template.recipes ?? []) {
      if (recipe.resultTemplateKey && !templates.has(recipe.resultTemplateKey))
        throw Error("A recipe refers to a missing result template.");
      for (const use of [
        ...recipe.materials,
        ...(recipe.stages ?? []).flatMap((stage) => stage.materials),
      ])
        if (!materials.has(use.materialKey)) throw Error("A recipe refers to an unknown material.");
      if (recipe.output?.materialKey && !materials.has(recipe.output.materialKey))
        throw Error("A produced item refers to an unknown material.");
    }
  for (const site of s.sites) {
    property(t, site.propertyId);
    if (property(t, site.propertyId).quantity !== 1)
      throw Error("An operating property must identify one legal parcel.");
    if (
      !templates.has(site.templateKey) ||
      site.completedTemplates.some((key) => !templates.has(key))
    )
      throw Error("A property template is missing.");
    if (
      !projected &&
      site.accessPurseIds.some((id) => !t.purses.some((p) => p.id === id && p.kind === "character"))
    )
      throw Error("A property permission refers to a missing character.");
  }
  for (const h of t.holdings) {
    if ((h.custody || h.reservedFor || h.materialKey) && h.kind !== "item")
      throw Error("Only ordinary items can be stored, reserved or marked as materials.");
    if (h.custody && (h.equipped || !sites.has(h.custody.propertyId)))
      throw Error("Stored goods need an existing property and cannot be equipped.");
    if (h.materialKey && !materials.has(h.materialKey))
      throw Error("An item refers to an unknown material definition.");
    if (
      h.reservedFor &&
      !s.jobs.some(
        (j) =>
          j.id === h.reservedFor &&
          ["active", "paused", "blocked"].includes(j.status) &&
          j.propertyId === h.custody?.propertyId,
      )
    )
      throw Error("Reserved materials need an active property project.");
    if (
      h.custody?.kind === "transit" &&
      !s.shipments.some(
        (x) =>
          x.id === h.custody?.shipmentId &&
          x.holdingId === h.id &&
          ["in-transit", "blocked"].includes(x.status),
      )
    )
      throw Error("Goods in transit need their delivery receipt.");
  }
  for (const j of s.jobs.filter((j) => !["completed", "cancelled", "denied"].includes(j.status))) {
    const h = property(t, j.propertyId);
    if (
      !sites.has(h.id) ||
      !t.purses.some((p) => p.id === j.purseId) ||
      (!projected &&
        j.assignments.some(
          (a) => !t.purses.some((p) => p.id === a.purseId && p.kind === "character"),
        ))
    )
      throw Error("A project has missing property, payer or worker records.");
    const stages = jobStages(j);
    if (j.stage >= stages.length || j.progress > stages[j.stage].laborDays * 100)
      throw Error("Invalid project stage progress.");
    if (j.recipe.resultTemplateKey && !templates.has(j.recipe.resultTemplateKey))
      throw Error("Missing building result template.");
  }
  for (const row of [
    ...s.withdrawals.filter((r) => ["pending", "approved"].includes(r.status)),
    ...s.staff.filter((c) => !["dismissed", "denied"].includes(c.status)),
    ...s.rentals,
    ...s.letters.filter((l) => l.status === "in-transit"),
    ...s.standingOrders.filter((o) => o.active),
  ])
    if (!sites.has(row.propertyId))
      throw Error("An operating agreement refers to a missing property.");
  for (const request of s.withdrawals.filter((r) => ["pending", "approved"].includes(r.status)))
    if (!t.purses.some((p) => p.id === request.purseId))
      throw Error("Cancel pending storage withdrawals before removing their receiving character.");
  const labor = new Map<string, number>();
  for (const j of s.jobs.filter((j) => ["active", "blocked"].includes(j.status)))
    for (const a of j.assignments) labor.set(a.purseId, (labor.get(a.purseId) || 0) + a.share);
  if ([...labor.values()].some((n) => n > 100))
    throw Error(
      "A character cannot be booked for more than one full downtime day across active projects.",
    );
}
function jobStages(j: EstateJob) {
  return (
    j.recipe.stages ?? [
      {
        name: j.recipe.name,
        laborDays: j.recipe.laborDays,
        laborCostCopper: j.recipe.laborCostCopper,
        materials: j.recipe.materials,
        requirement: j.recipe.requirement ?? "",
      },
    ]
  );
}
function reserve(t: Table, state: Estate, j: EstateJob, receipt: string) {
  const stage = jobStages(j)[j.stage];
  for (const material of stage.materials) {
    const already = t.holdings
      .filter((h) => h.reservedFor === j.id && h.materialKey === material.materialKey)
      .reduce((n, h) => n + h.quantity, 0);
    let need = material.quantity - already;
    for (const h of [...t.holdings].filter(
      (h) =>
        h.kind === "item" &&
        h.custody?.kind === "property" &&
        h.custody.propertyId === j.propertyId &&
        h.materialKey === material.materialKey &&
        !h.reservedFor &&
        (h.purseId === j.purseId || t.purses.some((p) => p.id === h.purseId && p.kind === "party")),
    )) {
      const n = Math.min(need, h.quantity);
      if (!n) break;
      if (n === h.quantity) h.reservedFor = j.id;
      else {
        h.quantity -= n;
        t.holdings.push({
          ...h,
          id: `${receipt}-reserve-${t.holdings.length}`,
          quantity: n,
          reservedFor: j.id,
        });
      }
      need -= n;
    }
    if (need > 0) {
      j.message = `Waiting for ${need} ${state.materials.find((m) => m.key === material.materialKey)?.name ?? material.materialKey}.`;
      return false;
    }
  }
  return true;
}
function staffed(t: Table, s: Estate, site: EstateSite, purpose: "operation" | "automation") {
  return estateTemplates(s, site)
    .flatMap((x) => x.staff ?? [])
    .filter((r) => r.purpose === purpose)
    .every(
      (required) =>
        s.staff.filter(
          (c) =>
            c.propertyId === site.propertyId &&
            c.role === required.role &&
            c.status === "active" &&
            !t.journal?.finance?.rules.some((r) => r.id === `estate-wage-${c.id}` && r.arrears > 0),
        ).length >= required.minimum,
    );
}
function healthy(t: Table, s: Estate, site: EstateSite) {
  const h = property(t, site.propertyId);
  return (
    site.enabled &&
    !["repairs", "ruin"].includes(h.property?.condition ?? "ready") &&
    staffed(t, s, site, "operation") &&
    !t.journal?.finance?.rules.some(
      (r) => r.holdingId === h.id && r.estateOperation && r.arrears > 0,
    )
  );
}
export function estateRuleEligible(
  t: Table,
  rule: { id: string; holdingId: string; estateOperation?: "rent" | "upkeep" | "wage" },
) {
  if (!rule.estateOperation || rule.estateOperation !== "rent") return true;
  const s = readEstate(t.journal?.propertyOperations),
    site = s.sites.find((x) => x.propertyId === rule.holdingId),
    rental = s.rentals.find((r) => r.propertyId === rule.holdingId);
  return !!site && !!rental?.active && rental.occupied && healthy(t, s, site);
}
function charge(
  t: CloudTable,
  purseId: string,
  copper: number,
  id: string,
  summary: string,
  at: number,
  shopId: string | null = null,
) {
  const p = t.purses.find((p) => p.id === purseId);
  if (!p) throw Error("The paying account no longer exists.");
  const coins = spendCoins(p.coins, copper);
  if (!coins) throw Error("Insufficient available funds.");
  p.coins = coins;
  if (copper)
    t.ledger.push({
      id,
      at,
      purseId,
      shopId,
      summary,
      copper: -copper,
      transactionType: shopId ? "purchase" : "payment",
    });
}
function syncRules(t: CloudTable, s: Estate) {
  const f = t.journal!.finance!;
  const upsert = (rule: Omit<(typeof f.rules)[number], "carryDays" | "arrears">) => {
    const old = f.rules.find((r) => r.id === rule.id);
    if (old && old.periodDays !== rule.periodDays && old.carryDays)
      throw Error("Finish the current wage or rental period before changing its length.");
    if (old) Object.assign(old, rule);
    else f.rules.push({ ...rule, carryDays: 0, arrears: 0 });
  };
  for (const staff of s.staff) {
    const h = t.holdings.find((h) => h.id === staff.propertyId);
    if (!h) continue;
    const old = f.rules.find((r) => r.id === `estate-wage-${staff.id}`);
    if (staff.wageCopper)
      upsert({
        id: `estate-wage-${staff.id}`,
        name: `${staff.name}: ${staff.role}`.slice(0, 100),
        purseId: h.purseId,
        kind: "expense",
        copper: staff.wageCopper,
        holdingId: h.id,
        periodDays: staff.periodDays,
        active: staff.status === "active",
        estateOperation: "wage",
      });
    else if (old) old.active = false;
  }
  for (const rent of s.rentals) {
    const h = property(t, rent.propertyId);
    for (const [kind, copper] of [
      ["income", rent.incomeCopper],
      ["expense", rent.upkeepCopper],
    ] as const) {
      const ruleId = `estate-${kind}-${h.id}`,
        old = f.rules.find((r) => r.id === ruleId);
      if (copper)
        upsert({
          id: ruleId,
          name: `${h.name}: ${kind === "income" ? "rent" : "upkeep"}`.slice(0, 100),
          purseId: h.purseId,
          kind,
          copper,
          holdingId: h.id,
          periodDays: rent.periodDays,
          active: rent.active && (kind === "expense" || rent.occupied),
          estateOperation: kind === "income" ? "rent" : "upkeep",
        });
      else if (old) old.active = false;
    }
  }
}
function delivery(
  t: CloudTable,
  s: Estate,
  args: {
    propertyId: string;
    purseId: string;
    stockId: string;
    quantity: number;
    materialKey: string;
    deliveryDays: number;
    deliveryCopper: number;
  },
  receipt: string,
  at: number,
) {
  const h = property(t, args.propertyId),
    site = s.sites.find((x) => x.propertyId === h.id),
    line = t.stock.find((x) => x.id === args.stockId),
    shop = t.shops.find((x) => x.id === line?.shopId);
  if (
    !site?.enabled ||
    !["storage", "construction-site"].some((c) =>
      estateCapabilities(s, site).has(c as "storage" | "construction-site"),
    )
  )
    throw Error("The destination needs active storage or a construction staging site.");
  if (!line || !shop || shop.closed || isService(line))
    throw Error("Choose stocked physical goods from an open shop.");
  if (!s.materials.some((m) => m.key === args.materialKey))
    throw Error("Choose a DM-reviewed material definition.");
  if (line.quantity !== null && line.quantity < args.quantity)
    throw Error("The supplier no longer has that quantity.");
  if (
    !h.locationId ||
    !shop.locationId ||
    !locationPath(readMarketLocations(t.journal?.market), h.locationId).some(
      (l) => l.id === shop.locationId,
    )
  )
    throw Error("Choose a supplier serving the property's location.");
  const payer = t.purses.find((p) => p.id === args.purseId)!;
  const cha =
    payer.kind === "party"
      ? null
      : (payer.sheet?.scores.cha ?? charismaScore(t.sheets.find((x) => x.purseId === payer.id)));
  const unitCopper = priceAfterCharisma(line.copper, cha),
    cost = unitCopper * args.quantity + args.deliveryCopper;
  const approvedSupplier = s.suppliers.find(
    (x) =>
      x.propertyId === h.id &&
      x.stockId === line.id &&
      x.materialKey === args.materialKey &&
      x.deliveryDays === args.deliveryDays &&
      x.deliveryCopper === args.deliveryCopper,
  );
  if (!Number.isSafeInteger(cost) || cost > 1e12)
    throw Error("This delivery exceeds the supported cost.");
  charge(
    t,
    payer.id,
    cost,
    receipt,
    `Property materials: ${args.quantity} ${line.name}; delivery to ${h.name}`,
    at,
    shop.id,
  );
  if (line.quantity !== null) line.quantity -= args.quantity;
  const item: Holding = {
    id: `${receipt}-goods`,
    purseId: payer.id,
    name: line.name,
    kind: "item",
    quantity: args.quantity,
    unitCopper,
    notes: line.notes,
    materialKey: args.materialKey,
    ...(approvedSupplier ? { weight: approvedSupplier.weight } : {}),
    custody: { kind: "transit", propertyId: h.id, shipmentId: receipt },
    equipped: false,
  };
  // Stock has no authoritative weight. Finite storage requires a DM weight review on arrival.
  t.holdings.push(item);
  s.shipments.push({
    id: receipt,
    propertyId: h.id,
    ownerId: payer.id,
    holdingId: item.id,
    sentDay: t.journal!.finance!.day,
    dueDay: t.journal!.finance!.day + args.deliveryDays,
    status: "in-transit",
    message: "Purchased goods awaiting delivery; usable only after receipt.",
  });
  return cost;
}
export function applyEstateCommand(t: CloudTable, seat: CloudSeat, cmd: EstateCommand, at: number) {
  const journal = t.journal!,
    state = readEstate(journal.propertyOperations),
    f = journal.finance!;
  const dm = () => {
    if (seat.role !== "dm") throw Error("Only the DM can approve property rules and agreements.");
  };
  const own = (id: string) => {
    if (
      !t.purses.some((p) => p.id === id) ||
      (seat.role === "player" && !seat.purseIds.includes(id))
    )
      throw Error("Choose your assigned character.");
  };
  const access = (id: string) => {
    if (!canAccessEstate(t, state, id, seat))
      throw Error("You do not have permission to use this property.");
    return property(t, id);
  };
  if (f.downtime.some((d) => d.status === "pending"))
    throw Error(
      "Cancel or apply the pending downtime preview before changing property operations.",
    );
  if (cmd.kind === "estate-template") {
    dm();
    const prior = state.templates.find((x) => x.key === cmd.template.key) ?? null;
    if (!same(prior, cmd.before)) throw Error("This template changed. Reload your draft.");
    state.templates = [...state.templates.filter((x) => x.key !== cmd.template.key), cmd.template];
    for (const material of cmd.materials) {
      const old = state.materials.find((m) => m.key === material.key);
      if (old && !same(old, material))
        throw Error("Keep existing material keys stable; add a new key to change their meaning.");
      if (!old) state.materials.push(material);
    }
  } else if (cmd.kind === "estate-site") {
    dm();
    property(t, cmd.site.propertyId);
    const prior = state.sites.find((x) => x.propertyId === cmd.site.propertyId) ?? null;
    if (!same(prior, cmd.before))
      throw Error("This property's settings changed. Reload your draft.");
    if (cmd.site.capacityWeight !== null) {
      const used = storageWeight(t, cmd.site.propertyId);
      if (used.unknown || used.weight > cmd.site.capacityWeight)
        throw Error("Review unknown weights or remove excess goods before limiting storage.");
    }
    state.sites = [...state.sites.filter((x) => x.propertyId !== cmd.site.propertyId), cmd.site];
  } else if (cmd.kind === "estate-withdrawal-review") {
    const request = state.withdrawals.find((r) => r.id === cmd.requestId);
    if (!request || canonicalJson(request) !== cmd.before)
      throw Error("This withdrawal request changed. Reload before reviewing it.");
    if (!["pending", "approved"].includes(request.status))
      throw Error("This withdrawal request is already closed.");
    if (cmd.status !== "cancelled") dm();
    else if (seat.role !== "dm" && request.requestedBy !== seat.id)
      throw Error("Only the requester or DM can cancel this withdrawal.");
    if (cmd.status === "approved") {
      const item = t.holdings.find((i) => i.id === request.holdingId);
      if (
        !item ||
        canonicalJson(item) !== request.itemBefore ||
        item.reservedFor ||
        item.custody?.kind !== "property" ||
        item.custody.propertyId !== request.propertyId
      )
        throw Error("The requested goods changed. Deny this request and submit a new one.");
    }
    request.status = cmd.status;
    request.reason = cmd.reason;
    journal.events.push({
      id: cmd.id,
      at,
      kind: "management",
      propertyId: request.propertyId,
      summary: `Storage withdrawal ${cmd.status}: ${request.quantity} items. ${cmd.reason}`.slice(
        0,
        500,
      ),
    });
  } else if (cmd.kind === "estate-storage") {
    const h = access(cmd.propertyId),
      site = state.sites.find((x) => x.propertyId === h.id)!;
    own(cmd.purseId);
    if (cmd.override) dm();
    if (!cmd.override && !physicallyHere(t, h))
      throw Error(
        "The party must be at this property's location to move stored goods. Ask the DM to set the party location.",
      );
    if (
      !site.enabled ||
      !["storage", "construction-site"].some((c) =>
        estateCapabilities(state, site).has(c as "storage" | "construction-site"),
      )
    )
      throw Error("Storage or construction staging is not active at this property.");
    const item = t.holdings.find((x) => x.id === cmd.holdingId);
    if (
      !item ||
      item.kind !== "item" ||
      item.service ||
      item.quantity < cmd.quantity ||
      item.reservedFor
    )
      throw Error("Choose available physical items; reserved materials cannot be moved.");
    if (cmd.direction === "deposit") {
      own(item.purseId);
      assertCarried(item);
      capacity(t, site, item, cmd.quantity);
    } else if (item.custody?.kind !== "property" || item.custody.propertyId !== h.id)
      throw Error("This item is not in this property's storage.");
    if (
      cmd.direction === "withdraw" &&
      seat.role !== "dm" &&
      (site.withdrawalApproval || cmd.approvalId)
    ) {
      if (!cmd.approvalId) {
        if (
          state.withdrawals.some(
            (r) =>
              r.propertyId === h.id &&
              r.holdingId === item.id &&
              r.purseId === cmd.purseId &&
              r.requestedBy === seat.id &&
              ["pending", "approved"].includes(r.status),
          )
        )
          throw Error("A withdrawal for this lot is already awaiting review or collection.");
        state.withdrawals.push({
          id: cmd.id,
          propertyId: h.id,
          holdingId: item.id,
          purseId: cmd.purseId,
          requestedBy: seat.id,
          quantity: cmd.quantity,
          itemBefore: canonicalJson(item),
          status: "pending",
          reason: "",
        });
        journal.events.push({
          id: cmd.id,
          at,
          kind: "request",
          propertyId: h.id,
          summary:
            `Requested withdrawal of ${cmd.quantity} ${item.name} for ${t.purses.find((p) => p.id === cmd.purseId)!.name}.`.slice(
              0,
              500,
            ),
        });
        journal.propertyOperations = readEstate(state);
        validateEstate(t);
        return;
      }
      const request = state.withdrawals.find((r) => r.id === cmd.approvalId);
      if (
        !request ||
        request.status !== "approved" ||
        request.requestedBy !== seat.id ||
        request.propertyId !== h.id ||
        request.holdingId !== item.id ||
        request.purseId !== cmd.purseId ||
        request.quantity !== cmd.quantity ||
        request.itemBefore !== canonicalJson(item)
      )
        throw Error(
          "An unchanged DM-approved withdrawal is required. Submit a fresh request if the goods changed.",
        );
      request.status = "fulfilled";
    }
    let moved = item;
    if (cmd.quantity !== item.quantity) {
      item.quantity -= cmd.quantity;
      moved = { ...item, id: `${cmd.id}-lot`, quantity: cmd.quantity };
      t.holdings.push(moved);
    }
    moved.equipped = false;
    if (cmd.direction === "deposit") {
      moved.custody = { kind: "property", propertyId: h.id };
      if (cmd.donate) moved.purseId = h.purseId;
    } else {
      delete moved.custody;
      moved.purseId = cmd.purseId;
    }
    journal.events.push({
      id: cmd.id,
      at,
      kind: "management",
      purseId: h.purseId,
      propertyId: h.id,
      summary:
        `${t.purses.find((p) => p.id === cmd.purseId)!.name} ${cmd.direction === "deposit" ? "stored" : "retrieved"} ${cmd.quantity} ${item.name} at ${h.name}${cmd.donate && cmd.direction === "deposit" ? "; donated to the property owner for shared use" : ""}${cmd.override ? " (DM location override)" : ""}.`.slice(
          0,
          500,
        ),
    });
  } else if (cmd.kind === "estate-material") {
    dm();
    const item = t.holdings.find((h) => h.id === cmd.holdingId && h.kind === "item");
    if (!item || !state.materials.some((m) => m.key === cmd.materialKey))
      throw Error("Choose an existing item and material definition.");
    item.materialKey = cmd.materialKey;
    item.weight = cmd.weight;
  } else if (cmd.kind === "estate-job") {
    const h = access(cmd.job.propertyId),
      prior = state.jobs.find((x) => x.id === cmd.job.id) ?? null,
      site = state.sites.find((s) => s.propertyId === h.id)!;
    if (!same(prior, cmd.before)) throw Error("This project changed. Reload before submitting.");
    if (prior && (prior.propertyId !== cmd.job.propertyId || prior.purseId !== cmd.job.purseId))
      throw Error("Project property and payer cannot change.");
    if (seat.role === "player") {
      own(cmd.job.purseId);
      const recipe = estateTemplates(state, site)
        .flatMap((t) => t.recipes ?? [])
        .find((r) => r.key === cmd.job.recipeKey);
      if (
        !recipe ||
        !same(recipe, cmd.job.recipe) ||
        (prior && prior.status !== "draft") ||
        cmd.job.status !== "draft" ||
        cmd.job.stage ||
        cmd.job.progress ||
        cmd.job.paidCopper ||
        cmd.job.approvedChecks ||
        cmd.job.assignments.some((a) => !seat.purseIds.includes(a.purseId))
      )
        throw Error(
          "Submit a draft using the DM's recipe and your assigned workers. The DM approves work and checks.",
        );
    } else {
      dm();
      if (prior && ["completed", "cancelled", "denied"].includes(prior.status))
        throw Error("This project is closed. Create a new project for further work.");
      if (
        prior &&
        (cmd.job.progress !== prior.progress ||
          cmd.job.paidProgress !== prior.paidProgress ||
          cmd.job.stage !== prior.stage ||
          cmd.job.paidCopper !== prior.paidCopper)
      )
        throw Error(
          "Progress is applied through reviewed downtime. Pause or cancel this job and create a correction recipe when necessary.",
        );
      if (
        !prior &&
        (cmd.job.progress || cmd.job.stage || cmd.job.paidCopper || cmd.job.status === "completed")
      )
        throw Error("New projects start with zero progress.");
      if (
        prior &&
        (prior.progress || prior.stage || prior.paidCopper) &&
        !same(prior.recipe, cmd.job.recipe)
      )
        throw Error(
          "Do not rewrite a partially completed recipe. Cancel it and create a correction project.",
        );
    }
    const next = {
      ...cmd.job,
      requestedBy: prior?.requestedBy ?? seat.id,
      createdDay: prior?.createdDay ?? f.day,
    };
    if (prior && !same(prior.recipe, next.recipe))
      for (const item of t.holdings.filter((h) => h.reservedFor === next.id))
        delete item.reservedFor;
    if (["cancelled", "denied"].includes(next.status))
      for (const item of t.holdings.filter((h) => h.reservedFor === next.id))
        delete item.reservedFor;
    state.jobs = [...state.jobs.filter((x) => x.id !== next.id), next];
    if (next.status === "active") {
      if (!site.enabled) throw Error("Activate the property before approving work.");
      reserve(t, state, next, cmd.id);
    }
  } else if (cmd.kind === "estate-job-resolution") {
    dm();
    const job = state.jobs.find((j) => j.id === cmd.jobId);
    if (!job || !same(job, cmd.before) || ["completed", "cancelled", "denied"].includes(job.status))
      throw Error("Review an ongoing project before applying a DM correction.");
    const site = state.sites.find((s) => s.propertyId === job.propertyId)!,
      h = property(t, job.propertyId);
    if (cmd.action === "complete") {
      if (job.recipe.output) {
        const out = job.recipe.output;
        capacity(
          t,
          site,
          { ...out, id: "output", purseId: job.purseId, kind: "item", notes: "" },
          out.quantity,
        );
        t.holdings.push({
          ...out,
          id: `${job.id}-output`,
          purseId: job.purseId,
          kind: "item",
          notes: `DM completion: ${cmd.reason}`,
          custody: { kind: "property", propertyId: h.id },
        });
      }
      t.holdings = t.holdings.filter((item) => item.reservedFor !== job.id);
      if (job.recipe.resultTemplateKey) site.completedTemplates.push(job.recipe.resultTemplateKey);
      if (job.recipe.resultCondition && h.property)
        h.property.condition = job.recipe.resultCondition;
      job.status = "completed";
      job.completedDay = f.day;
    } else {
      const stages = jobStages(job);
      if (!stages[cmd.stage] || cmd.progress > stages[cmd.stage].laborDays * 100)
        throw Error("Choose progress within the selected stage.");
      for (const item of t.holdings.filter((h) => h.reservedFor === job.id))
        delete item.reservedFor;
      job.paidProgress = cmd.stage === job.stage ? Math.min(job.paidProgress, cmd.progress) : 0;
      job.stage = cmd.stage;
      job.progress = cmd.progress;
    }
    job.message = `DM correction: ${cmd.reason}`;
    journal.events.push({
      id: `${cmd.id}-correction`,
      at,
      kind: "management",
      purseId: job.purseId,
      summary: `${job.name}: ${job.message}`.slice(0, 500),
      propertyId: job.propertyId,
    });
  } else if (cmd.kind === "estate-staff") {
    const h = access(cmd.staff.propertyId),
      prior = state.staff.find((x) => x.id === cmd.staff.id) ?? null;
    if (!same(prior, cmd.before)) throw Error("This staff contract changed. Reload before saving.");
    if (prior && prior.propertyId !== h.id)
      throw Error("A staff contract stays with its original property.");
    if (
      seat.role === "player" &&
      (cmd.staff.status !== "proposed" ||
        (prior && prior.status !== "proposed") ||
        cmd.staff.budgetSpentCopper ||
        cmd.staff.budgetStartDay !== f.day)
    )
      throw Error("Submit a proposed hire for DM review.");
    if (prior && cmd.staff.budgetSpentCopper !== prior.budgetSpentCopper)
      throw Error("Budget spending is recorded by approved operations and cannot be overwritten.");
    if (
      cmd.staff.npcId &&
      !t.purses.some(
        (p) => p.id === cmd.staff.npcId && p.kind === "character" && p.control === "npc",
      )
    )
      throw Error("Choose an existing NPC for this optional staff link.");
    state.staff = [
      ...state.staff.filter((x) => x.id !== cmd.staff.id),
      { ...cmd.staff, budgetStartDay: prior?.budgetStartDay ?? f.day },
    ];
  } else if (cmd.kind === "estate-rent") {
    dm();
    const h = property(t, cmd.rental.propertyId),
      site = state.sites.find((x) => x.propertyId === h.id);
    if (!site || !estateCapabilities(state, site).has("rental"))
      throw Error("Enable a rental-capable property template first.");
    if (!same(state.rentals.find((x) => x.propertyId === h.id) ?? null, cmd.before))
      throw Error("This tenancy changed. Reload before saving.");
    if (
      cmd.rental.active &&
      f.rules.some(
        (r) => r.holdingId === h.id && r.kind === "income" && r.active && !r.estateOperation,
      )
    )
      throw Error(
        "Pause the existing property income schedule before activating rent so it is not counted twice.",
      );
    state.rentals = [...state.rentals.filter((x) => x.propertyId !== h.id), cmd.rental];
  } else if (cmd.kind === "estate-supplier") {
    dm();
    property(t, cmd.supplier.propertyId);
    if (!same(state.suppliers.find((x) => x.id === cmd.supplier.id) ?? null, cmd.before))
      throw Error("Supplier terms changed. Reload before saving.");
    if (
      !t.stock.some((x) => x.id === cmd.supplier.stockId) ||
      !state.materials.some((x) => x.key === cmd.supplier.materialKey)
    )
      throw Error("Choose existing stock and a reviewed material definition.");
    state.suppliers = [...state.suppliers.filter((x) => x.id !== cmd.supplier.id), cmd.supplier];
  } else if (cmd.kind === "estate-postal") {
    dm();
    if (!same(state.postal, cmd.before))
      throw Error("Postal settings changed. Reload before saving.");
    for (const office of cmd.postal.offices)
      if (!t.shops.some((s) => s.id === office.shopId))
        throw Error("Select an existing shop as the post office.");
    state.postal = cmd.postal;
  } else if (cmd.kind === "estate-letter") {
    const h = access(cmd.propertyId);
    own(cmd.senderId);
    if (
      seat.role === "player" &&
      !seat.purseIds.includes(h.purseId) &&
      !t.purses.some((p) => p.id === h.purseId && p.kind === "party")
    )
      throw Error("Only the owner or an assigned party character may send management orders.");
    const market = readMarketLocations(journal.market),
      path = locationPath(market, market.currentLocationId),
      settlement = [...path].reverse().find((l) => l.kind === "city" || l.kind === "town");
    const office = state.postal.offices.find((o) => {
      const shop = t.shops.find((s) => s.id === o.shopId);
      return (
        shop &&
        !shop.closed &&
        !!shop.locationId &&
        shopAvailableHere(shop, market) &&
        !!settlement &&
        (settlement.kind === "city" || o.allowTown)
      );
    });
    if (!market.currentLocationId || !settlement || !office)
      throw Error("Visit a city with an open, DM-designated post office to send a letter.");
    const manager = state.staff.find(
      (c) => c.id === cmd.managerId && c.propertyId === h.id && c.manager && c.status === "active",
    );
    if (!manager) throw Error("Choose an active property manager to receive the letter.");
    charge(t, cmd.senderId, state.postal.feeCopper, cmd.id, `Postage: letter to ${h.name}`, at);
    state.letters.push({
      id: cmd.id,
      propertyId: h.id,
      ownerId: h.purseId,
      senderId: cmd.senderId,
      managerId: manager.id,
      originId: market.currentLocationId,
      sentDay: f.day,
      dueDay: f.day + state.postal.deliveryDays,
      feeCopper: state.postal.feeCopper,
      budgetCopper: cmd.budgetCopper,
      order: cmd.order,
      status: "in-transit",
      receipt: "Awaiting campaign-day delivery and permission review.",
    });
  } else if (cmd.kind === "estate-letter-cancel") {
    const letter = state.letters.find((l) => l.id === cmd.letterId);
    if (!letter || !["in-transit", "blocked"].includes(letter.status))
      throw Error("This letter is already closed.");
    own(letter.senderId);
    letter.status = "cancelled";
    letter.receipt = "Cancelled; postage remains a recorded expense.";
  } else if (cmd.kind === "estate-order") {
    dm();
    property(t, cmd.order.propertyId);
    if (!same(state.standingOrders.find((o) => o.id === cmd.order.id) ?? null, cmd.before))
      throw Error("This standing order changed. Reload before saving.");
    if (
      !state.staff.some(
        (c) => c.id === cmd.order.managerId && c.propertyId === cmd.order.propertyId && c.manager,
      )
    )
      throw Error("Choose this property's manager.");
    state.standingOrders = [
      ...state.standingOrders.filter((o) => o.id !== cmd.order.id),
      cmd.order,
    ];
  } else if (cmd.kind === "estate-delivery") {
    const h = access(cmd.propertyId);
    own(cmd.purseId);
    if (seat.role !== "dm" && !physicallyHere(t, h))
      throw Error(
        "Place delivery orders at the property, or send a pre-approved supply order to its manager by post.",
      );
    // Delivery terms are DM rules; players request supply orders through the reviewed manager workflow.
    dm();
    delivery(t, state, cmd, cmd.id, at);
  } else if (cmd.kind === "estate-shipment") {
    const shipment = state.shipments.find((x) => x.id === cmd.shipmentId);
    if (!shipment || !["blocked", "in-transit"].includes(shipment.status))
      throw Error("This shipment is closed.");
    const h = access(shipment.propertyId);
    if (cmd.override) dm();
    if (cmd.action === "return") {
      own(shipment.ownerId);
      if (!cmd.override && !physicallyHere(t, h))
        throw Error(
          "Retrieve a failed delivery at its destination, or ask the DM for an override.",
        );
      const item = t.holdings.find((h) => h.id === shipment.holdingId);
      if (!item) throw Error("The shipment goods are missing.");
      delete item.custody;
      shipment.status = "cancelled";
      shipment.message = "Goods retrieved; purchase and postage are not refunded.";
    } else {
      dm();
      shipment.status = "in-transit";
      shipment.dueDay = f.day;
      shipment.message = "Delivery will be retried during the next approved downtime.";
    }
  } else if (cmd.kind === "estate-arrears") {
    const rule = f.rules.find((r) => r.id === cmd.ruleId && r.estateOperation);
    if (!rule || cmd.copper > rule.arrears)
      throw Error("Payment exceeds the recorded property arrears.");
    own(rule.purseId);
    charge(t, rule.purseId, cmd.copper, cmd.id, `Property arrears: ${rule.name}`, at);
    rule.arrears -= cmd.copper;
  } else if (cmd.kind === "estate-handover") {
    dm();
    const h = property(t, cmd.propertyId),
      recipient = t.purses.find((p) => p.id === cmd.toId);
    if (!recipient || recipient.id === h.purseId) throw Error("Choose a different campaign owner.");
    const old = h.purseId;
    h.purseId = recipient.id;
    if (h.deed) h.deed = transferPropertyDeed(h.deed, recipient, cmd.id, at);
    for (const item of t.holdings.filter(
      (x) => x.custody?.propertyId === h.id && x.purseId === old,
    ))
      item.purseId = recipient.id;
    for (const job of state.jobs.filter((j) => j.propertyId === h.id && j.purseId === old))
      job.purseId = recipient.id;
    for (const rule of f.rules.filter((r) => r.holdingId === h.id && r.purseId === old))
      rule.purseId = recipient.id;
    for (const letter of state.letters.filter(
      (l) => l.propertyId === h.id && ["in-transit", "blocked"].includes(l.status),
    )) {
      letter.status = "blocked";
      letter.receipt = "Ownership changed; send a new order after reviewing the handover.";
    }
    for (const shipment of state.shipments.filter(
      (x) => x.propertyId === h.id && x.ownerId === old,
    ))
      shipment.ownerId = recipient.id;
    for (const request of state.withdrawals.filter(
      (r) => r.propertyId === h.id && ["pending", "approved"].includes(r.status),
    )) {
      request.status = "cancelled";
      request.reason = "Ownership changed; submit a new request after reviewing access.";
    }
    for (const order of state.standingOrders.filter((o) => o.propertyId === h.id)) {
      order.active = false;
      order.receipt = "Paused for owner review after handover.";
    }
    journal.events.push({
      id: `${cmd.id}-handover`,
      at,
      kind: "management",
      purseId: recipient.id,
      summary: `DM handover of ${h.name} to ${recipient.name}: ${cmd.reason}`.slice(0, 500),
      propertyId: h.id,
    });
  }
  journal.propertyOperations = readEstate(state);
  if (["estate-staff", "estate-rent", "estate-handover"].includes(cmd.kind)) syncRules(t, state);
  validateEstate(t);
  if (!["estate-storage", "estate-withdrawal-review"].includes(cmd.kind))
    journal.events.push({
      id: cmd.id,
      at,
      kind: cmd.kind === "estate-job" || cmd.kind === "estate-staff" ? "request" : "management",
      ...("propertyId" in cmd
        ? { propertyId: cmd.propertyId }
        : "job" in cmd
          ? { propertyId: cmd.job.propertyId }
          : "staff" in cmd
            ? { propertyId: cmd.staff.propertyId }
            : "rental" in cmd
              ? { propertyId: cmd.rental.propertyId }
              : "site" in cmd
                ? { propertyId: cmd.site.propertyId }
                : {}),
      summary: `Property operation recorded: ${cmd.kind.replace("estate-", "").replaceAll("-", " ")}.`,
    });
}

/** Pure simulation. Every output is included in the existing DM downtime quote. */
export function previewEstate(t: CloudTable, days: number, balances: Map<string, number>) {
  if (!t.journal?.propertyOperations) return undefined;
  const before = canonicalJson({
    estate: t.journal.propertyOperations,
    holdings: t.holdings,
    stock: t.stock,
    shops: t.shops,
    owners: t.purses.map((p) => ({
      id: p.id,
      kind: p.kind,
      coins: p.coins,
      cha: p.sheet?.scores.cha,
    })),
    market: t.journal.market,
    sheets: t.sheets,
  });
  const working = structuredClone(t),
    s = readEstate(working.journal!.propertyOperations),
    start = working.journal!.finance!.day;
  working.journal!.propertyOperations = s;
  for (const p of working.purses) p.coins = fromCopper(balances.get(p.id)!);
  working.ledger = [];
  const notices: { propertyId: string; summary: string }[] = [];
  const blocked = (error: unknown) =>
    error instanceof Error ? error.message : "This operation needs DM review.";
  const runOrder = (
    propertyId: string,
    managerId: string,
    order: EstateOrder,
    budget: number,
    ownerId: string,
    day: number,
    receipt: string,
  ) => {
    const h = property(working, propertyId),
      site = s.sites.find((x) => x.propertyId === propertyId),
      manager = s.staff.find(
        (c) =>
          c.id === managerId && c.propertyId === propertyId && c.manager && c.status === "active",
      );
    if (
      h.purseId !== ownerId ||
      !site?.enabled ||
      !manager ||
      !staffed(working, s, site, "automation") ||
      working.journal!.finance!.rules.some((r) => r.id === `estate-wage-${manager.id}` && r.arrears)
    )
      throw Error("Current ownership, manager or wage requirements block this order.");
    const duty = (
      {
        message: "reports",
        report: "reports",
        project: "projects",
        rent: "rent",
        staff: "staff",
        supply: "supplies",
      } as const
    )[order.kind];
    if (!manager.duties.includes(duty)) throw Error("The manager is not authorized for this duty.");
    if (day >= manager.budgetStartDay + manager.budgetPeriodDays) {
      manager.budgetStartDay +=
        Math.floor((day - manager.budgetStartDay) / manager.budgetPeriodDays) *
        manager.budgetPeriodDays;
      manager.budgetSpentCopper = 0;
    }
    if (order.kind === "supply") {
      if (
        !s.suppliers.some(
          (x) =>
            x.propertyId === propertyId &&
            x.stockId === order.stockId &&
            x.materialKey === order.materialKey &&
            x.deliveryDays === order.deliveryDays &&
            x.deliveryCopper === order.deliveryCopper,
        )
      )
        throw Error(
          "The DM must review this supplier, material and delivery terms before remote orders can execute.",
        );
      const line = working.stock.find((x) => x.id === order.stockId),
        payer = working.purses.find((p) => p.id === h.purseId)!;
      if (!line) throw Error("The selected supply stock is missing.");
      const cha =
        payer.kind === "party"
          ? null
          : (payer.sheet?.scores.cha ??
            charismaScore(working.sheets.find((x) => x.purseId === payer.id)));
      const cost = priceAfterCharisma(line.copper, cha) * order.quantity + order.deliveryCopper;
      if (cost > budget || manager.budgetSpentCopper + cost > manager.budgetCopper)
        throw Error("The order exceeds its authorized spending budget.");
      delivery(working, s, { ...order, propertyId, purseId: ownerId }, receipt, 0);
      manager.budgetSpentCopper += cost;
      return `Purchased ${order.quantity} ${line.name} for ${cost} cp; delivery due day ${day + order.deliveryDays}.`;
    }
    if (order.kind === "project") {
      const job = s.jobs.find((j) => j.id === order.jobId && j.propertyId === propertyId);
      if (!job || !["active", "paused", "blocked"].includes(job.status))
        throw Error("Only already approved projects may be managed by letter.");
      if (order.active)
        for (const assignment of job.assignments) {
          const booked = s.jobs
            .filter((j) => j.id !== job.id && ["active", "blocked"].includes(j.status))
            .flatMap((j) => j.assignments)
            .filter((a) => a.purseId === assignment.purseId)
            .reduce((n, a) => n + a.share, 0);
          if (booked + assignment.share > 100)
            throw Error("The worker is already booked for a full downtime day.");
        }
      job.status = order.active ? "active" : "paused";
      return `${job.name}: ${job.status}.`;
    }
    if (order.kind === "staff") {
      const staff = s.staff.find((c) => c.id === order.staffId && c.propertyId === propertyId);
      if (!staff || !["active", "paused"].includes(staff.status))
        throw Error("Only reviewed existing contracts may be activated or paused.");
      staff.status = order.active ? "active" : "paused";
      return `${staff.name}: ${staff.status}; wage changes take effect after this downtime receipt.`;
    }
    if (order.kind === "rent") {
      const rent = s.rentals.find((r) => r.propertyId === propertyId);
      if (!rent) throw Error("The DM must approve tenancy terms first.");
      rent.active = order.active;
      return `Rental management ${order.active ? "enabled" : "paused"}; financial schedules update for the next approved period.`;
    }
    if (order.kind === "message") return `Delivered to ${manager.name}: ${order.text}`;
    const stored = working.holdings
      .filter((x) => x.custody?.propertyId === h.id && x.custody.kind === "property")
      .reduce((n, x) => n + x.quantity, 0);
    return `${h.name}: ${stored} stored items; ${s.jobs.filter((j) => j.propertyId === h.id && ["active", "blocked"].includes(j.status)).length} ongoing projects; ${s.staff.filter((c) => c.propertyId === h.id && c.status === "active").length} active staff.`;
  };
  for (let offset = 1; offset <= days; offset++) {
    const day = start + offset;
    working.journal!.finance!.day = day;
    for (const job of s.jobs.filter((j) => ["active", "blocked"].includes(j.status))) {
      const site = s.sites.find((x) => x.propertyId === job.propertyId)!;
      if (!site.enabled) {
        job.status = "blocked";
        job.message = "Property operations are disabled.";
        continue;
      }
      if (job.recipe.output && !healthy(working, s, site)) {
        job.status = "blocked";
        job.message =
          "Production needs a usable property, required operating staff and settled wages / upkeep.";
        continue;
      }
      if (!job.approvedChecks && jobStages(job)[job.stage].requirement) {
        job.status = "blocked";
        job.message = "DM approval of tools, skills or checks is required.";
        continue;
      }
      if (!reserve(working, s, job, `${job.id}-day-${day}`)) {
        job.status = "blocked";
        continue;
      }
      const remote = !physicallyHere(working, property(working, job.propertyId)),
        supervisor = remote
          ? s.staff.find(
              (c) =>
                c.propertyId === job.propertyId &&
                c.manager &&
                c.status === "active" &&
                c.duties.includes("projects") &&
                !working.journal!.finance!.rules.some(
                  (r) => r.id === `estate-wage-${c.id}` && r.arrears,
                ),
            )
          : undefined;
      if (job.paidWorkers && remote && (!supervisor || !staffed(working, s, site, "automation"))) {
        job.status = "blocked";
        job.message = "Paid work away from the party requires an authorized, paid manager.";
        continue;
      }
      const stage = jobStages(job)[job.stage],
        required = stage.laborDays * 100;
      const characterWork = physicallyHere(working, property(working, job.propertyId))
        ? job.assignments.reduce((n, a) => n + a.share, 0)
        : 0;
      const labor = Math.min(required - job.progress, characterWork + job.paidWorkers * 100);
      const paidWork = Math.max(0, labor - characterWork),
        cost =
          Math.floor(((job.paidProgress + paidWork) * stage.laborCostCopper) / required) -
          Math.floor((job.paidProgress * stage.laborCostCopper) / required);
      if (supervisor) {
        if (day >= supervisor.budgetStartDay + supervisor.budgetPeriodDays) {
          supervisor.budgetStartDay +=
            Math.floor((day - supervisor.budgetStartDay) / supervisor.budgetPeriodDays) *
            supervisor.budgetPeriodDays;
          supervisor.budgetSpentCopper = 0;
        }
        if (supervisor.budgetSpentCopper + cost > supervisor.budgetCopper) {
          job.status = "blocked";
          job.message = "Remote contractor work exceeds the manager's authorized spending cap.";
          continue;
        }
      }
      if (!labor && job.progress !== required) {
        job.status = "blocked";
        job.message = "Assign workers at this location or hire contractors.";
        continue;
      }
      try {
        charge(
          working,
          job.purseId,
          cost,
          `${job.id}-labor-${day}`,
          `Property work: ${job.name} (${stage.name}), day ${day}`,
          0,
        );
      } catch (e) {
        job.status = "blocked";
        job.message = blocked(e);
        continue;
      }
      if (supervisor) supervisor.budgetSpentCopper += cost;
      job.progress += labor;
      job.paidProgress += paidWork;
      job.paidCopper += cost;
      job.status = "active";
      job.message = `${stage.name}: ${job.progress / 100}/${stage.laborDays} labor days.`;
      if (job.progress === required) {
        // Validate output capacity before consumption. A blocked completion retains its inputs once.
        if (job.stage === jobStages(job).length - 1 && job.recipe.output) {
          const out = job.recipe.output;
          try {
            capacity(
              { holdings: working.holdings.filter((item) => item.reservedFor !== job.id) },
              site,
              { ...out, id: "output", purseId: job.purseId, kind: "item", notes: "" },
              out.quantity,
            );
          } catch (e) {
            job.status = "blocked";
            job.message = blocked(e);
            continue;
          }
        }
        working.holdings = working.holdings.filter((h) => h.reservedFor !== job.id);
        if (job.stage + 1 < jobStages(job).length) {
          job.stage++;
          job.progress = 0;
          job.paidProgress = 0;
          job.message = `Ready for ${jobStages(job)[job.stage].name}.`;
        } else {
          if (job.recipe.resultTemplateKey) {
            site.completedTemplates.push(job.recipe.resultTemplateKey);
            const result = s.templates.find((t) => t.key === job.recipe.resultTemplateKey)!;
            if (result.storage && site.capacityWeight === null)
              site.capacityWeight = result.storage.capacityWeight;
          }
          if (job.recipe.resultCondition) {
            const h = property(working, job.propertyId);
            if (h.property) h.property.condition = job.recipe.resultCondition;
          }
          if (job.recipe.output) {
            const out = job.recipe.output;
            working.holdings.push({
              ...out,
              id: `${job.id}-output`,
              purseId: job.purseId,
              kind: "item",
              notes: `Produced by ${job.name}; approved day ${day}.`,
              equipped: false,
              custody: { kind: "property", propertyId: job.propertyId },
            });
          }
          job.status = "completed";
          job.completedDay = day;
          job.message = "Completed through approved downtime.";
          notices.push({
            propertyId: job.propertyId,
            summary: `${job.name} completed on day ${day}.`,
          });
        }
      }
    }
    for (const shipment of s.shipments.filter(
      (x) => x.status === "in-transit" && x.dueDay <= day,
    )) {
      const site = s.sites.find((x) => x.propertyId === shipment.propertyId),
        item = working.holdings.find((x) => x.id === shipment.holdingId);
      try {
        if (
          !site?.enabled ||
          !item ||
          !["storage", "construction-site"].some((c) =>
            estateCapabilities(s, site).has(c as "storage" | "construction-site"),
          )
        )
          throw Error("Destination storage or shipment goods are unavailable.");
        const h = property(working, site.propertyId);
        if (item.purseId !== shipment.ownerId)
          throw Error("Shipment ownership changed; ask the DM to review delivery.");
        if (
          !physicallyHere(working, h) &&
          !s.staff.some(
            (c) =>
              c.propertyId === h.id &&
              c.status === "active" &&
              c.manager &&
              c.duties.includes("deliveries") &&
              !working.journal!.finance!.rules.some(
                (r) => r.id === `estate-wage-${c.id}` && r.arrears,
              ),
          )
        )
          throw Error("An authorized manager or the party must receive this delivery.");
        capacity(working, site, item, item.quantity);
        item.custody = { kind: "property", propertyId: h.id };
        shipment.status = "delivered";
        shipment.message = `Received on day ${day}.`;
        notices.push({
          propertyId: h.id,
          summary: `Materials delivered to ${h.name} on day ${day}.`,
        });
      } catch (e) {
        shipment.status = "blocked";
        shipment.message = blocked(e);
        notices.push({ propertyId: shipment.propertyId, summary: shipment.message });
      }
    }
    for (const letter of s.letters.filter((l) => l.status === "in-transit" && l.dueDay <= day)) {
      try {
        letter.receipt = runOrder(
          letter.propertyId,
          letter.managerId,
          letter.order,
          letter.budgetCopper,
          letter.ownerId,
          day,
          letter.id,
        );
        letter.status = "delivered";
      } catch (e) {
        letter.status = "blocked";
        letter.receipt = blocked(e);
      }
      notices.push({
        propertyId: letter.propertyId,
        summary: `Letter: ${letter.receipt}`.slice(0, 1000),
      });
    }
    for (const order of s.standingOrders.filter((o) => o.active && o.nextDay <= day)) {
      const ownerId = property(working, order.propertyId).purseId;
      try {
        order.receipt = runOrder(
          order.propertyId,
          order.managerId,
          order.order,
          order.budgetCopper,
          ownerId,
          day,
          `${order.id}-day-${day}`,
        );
      } catch (e) {
        order.receipt = blocked(e);
        order.active = false;
        notices.push({
          propertyId: order.propertyId,
          summary: `Standing order paused: ${order.receipt}`,
        });
      }
      order.nextDay = day + order.periodDays;
    }
  }
  syncRules(working, s);
  // Orders may activate future schedules, but this receipt's settlement order remains unchanged.
  const movements = working.ledger.map((l) => ({
    id: l.id,
    purseId: l.purseId,
    copper: -l.copper,
    summary: l.summary,
    ...(l.shopId ? { shopId: l.shopId } : {}),
  }));
  for (const p of working.purses) balances.set(p.id, toCopper(p.coins));
  validateEstate(working);
  return {
    before,
    state: readEstate(s),
    holdings: working.holdings,
    stock: working.stock,
    movements,
    notices,
    rules: working.journal!.finance!.rules,
  };
}
