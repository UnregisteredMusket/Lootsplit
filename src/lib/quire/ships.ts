import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { Holding } from "./types.ts";
import { canonicalJson } from "./canonical-json.ts";
import { characterLocation, characterPosition } from "./character-position.ts";
import { readWorld } from "./world-schema.ts";
import { readMarketLocations, locationPath } from "./shop-locations.ts";
import { readEstate, type EstateJob } from "./estate-schema.ts";
import { applyEstateCommand, canAccessEstate, storageWeight } from "./estate.ts";
import { readFinance, financeMove } from "./finance.ts";
import { toCopper } from "./money.ts";
import {
  readFleet,
  type Fleet,
  type Vessel,
  type ShipFacility,
  type ShipCommand,
  type ShipVoyage,
} from "./ships-schema.ts";

type Table = Pick<CloudTable, "purses" | "holdings" | "journal">;
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const closed = (v: ShipVoyage) =>
  ["arrived", "cancelled", "dm-overridden", "denied"].includes(v.status);
const holding = (t: Table, id: string) => {
  const h = t.holdings.find((h) => h.id === id && h.kind === "property" && h.quantity === 1);
  if (!h) throw Error("Choose an existing single ship/property holding.");
  return h;
};
export function shipFingerprint(t: Table, propertyId: string) {
  const vessel = t.journal?.fleet?.vessels.find((v) => v.propertyId === propertyId);
  const publicVessel = vessel ? { ...vessel, dmNotes: "" } : null;
  return canonicalJson({
    vessel: publicVessel,
    holding: t.holdings.find((h) => h.id === propertyId),
    cargo: t.holdings.filter((h) => h.custody?.propertyId === propertyId),
    jobs: t.journal?.propertyOperations?.jobs.filter((j) => j.propertyId === propertyId),
  });
}
export function shipHere(t: Table, h: Holding, purseId?: string) {
  const s = t.journal?.fleet?.vessels.find((s) => s.propertyId === h.id);
  if (!s) return undefined;
  if (
    purseId &&
    t.journal?.fleet?.aboard.some((a) => a.purseId === purseId && a.propertyId === h.id)
  )
    return true;
  if (s.mode === "sailing") return false;
  const p = t.purses.find((p) => p.id === purseId),
    m = readMarketLocations(t.journal?.market);
  const location = p?.kind === "character" ? characterLocation(t, p) : m.currentLocationId;
  return (
    !!location && !!h.locationId && locationPath(m, location).some((l) => l.id === h.locationId)
  );
}
export function facilityAccess(
  t: Table,
  f: ShipFacility,
  seat: Pick<CloudSeat, "role" | "purseIds">,
) {
  if (seat.role === "dm" || f.public || f.accessPurseIds.some((id) => seat.purseIds.includes(id)))
    return true;
  return (
    !!f.propertyId &&
    canAccessEstate(t, readEstate(t.journal?.propertyOperations), f.propertyId, seat)
  );
}
function checkBerth(
  t: Table,
  s: Vessel,
  f: ShipFacility,
  seat: Pick<CloudSeat, "role" | "purseIds">,
  atLocation?: string,
) {
  if (!facilityAccess(t, f, seat)) throw Error("This shipyard is private.");
  if (f.locationId !== (atLocation ?? holding(t, s.propertyId).locationId))
    throw Error("Travel to the facility's location first.");
  const used =
    t.journal?.fleet?.vessels.filter(
      (v) => v.propertyId !== s.propertyId && v.facilityId === f.id && v.mode !== "sailing",
    ).length ?? 0;
  if (s.stats.lengthFeet > f.maxLengthFeet) throw Error("This ship is too long for the facility.");
  if (used >= f.slots) throw Error("This facility has no available berth/storage slots.");
}
function occupants(t: Table, shipId: string) {
  const ids = new Set(
    t.journal?.fleet?.aboard.filter((a) => a.propertyId === shipId).map((a) => a.purseId),
  );
  return t.journal?.world?.characterPositions.filter((p) => ids.has(p.purseId)) ?? [];
}
function pauseWork(t: Table, shipId: string, reason: string) {
  const jobs = new Set(
    t.journal?.fleet?.work.filter((w) => w.propertyId === shipId && !w.applied).map((w) => w.jobId),
  );
  for (const j of t.journal?.propertyOperations?.jobs ?? [])
    if (jobs.has(j.id) && ["active", "blocked"].includes(j.status)) {
      j.status = "paused";
      j.message = reason;
    }
}
function move(t: CloudTable, s: Vessel, locationId: string | null) {
  const h = holding(t, s.propertyId);
  if (locationId) h.locationId = locationId;
  else delete h.locationId;
  for (const p of occupants(t, h.id)) {
    p.locationId = locationId;
    const npc = t.journal?.world?.npcs.find((n) => n.id === p.purseId);
    if (npc && locationId) npc.locationId = locationId;
  }
}
function board(t: CloudTable, s: Vessel, purseId: string, action: "board" | "disembark") {
  const p = t.purses.find((p) => p.id === purseId && p.kind === "character");
  if (!p || t.journal?.tradeEconomy?.exchanges.some((e) => e.purseId === purseId))
    throw Error("Choose an existing character.");
  const h = holding(t, s.propertyId),
    w = (t.journal!.world ??= readWorld()),
    position = characterPosition(t, p);
  if (position.downtime)
    throw Error("Cancel this character's downtime before boarding or leaving.");
  if (s.mode === "sailing")
    throw Error("A sailing ship must arrive or be teleported before boarding or disembarking.");
  if (!h.locationId) throw Error("The ship needs a known location.");
  if (action === "board") {
    if (position.shipId) throw Error("Disembark from the current ship first.");
    if (!shipHere(t, h, purseId)) throw Error("The character must be at the ship to board.");
    if (occupants(t, h.id).length >= s.stats.passengers)
      throw Error("The ship has no passenger capacity.");
    w.characterPositions = w.characterPositions.filter((x) => x.purseId !== purseId);
    w.characterPositions.push({ ...position, inParty: false, locationId: h.locationId });
    t.journal!.fleet!.aboard.push({ purseId, propertyId: h.id, returnInParty: position.inParty });
  } else {
    if (position.shipId !== h.id) throw Error("This character is not aboard this ship.");
    const { shipId: unusedShip, shipReturnInParty: returnInParty, ...rest } = position;
    void unusedShip;
    t.journal!.fleet!.aboard = t.journal!.fleet!.aboard.filter((a) => a.purseId !== purseId);
    const party = readMarketLocations(t.journal?.market).currentLocationId;
    w.characterPositions = w.characterPositions.filter((x) => x.purseId !== purseId);
    w.characterPositions.push({
      ...rest,
      inParty: !!returnInParty && party === h.locationId,
      locationId: h.locationId,
    });
  }
  const npc = w.npcs.find((n) => n.id === p.id);
  if (npc) {
    p.nonParty = !w.characterPositions.find((x) => x.purseId === p.id)!.inParty;
    npc.locationId = h.locationId;
  }
}
export function assertShipTradingHere(t: Table, purseId: string) {
  if (!t.journal?.fleet?.aboard.some((a) => a.purseId === purseId)) return;
  const position = t.journal?.world?.characterPositions.find((p) => p.purseId === purseId);
  if (!position) throw Error("Aboard character position is missing.");
  const market = readMarketLocations(t.journal?.market);
  if (
    !position.locationId ||
    !market.currentLocationId ||
    !locationPath(market, position.locationId).some((l) => l.id === market.currentLocationId)
  )
    throw Error(
      "This character is aboard a ship away from the party market. Trade at the ship's port through reviewed manager orders or ask the DM to review the party location.",
    );
}
export function initializeShipPurchase(
  t: CloudTable,
  h: Holding,
  template: import("./estate-schema.ts").EstateTemplate,
) {
  if (!template.ship && !template.shipyard) return;
  const f = (t.journal!.fleet ??= readFleet());
  if (template.ship)
    f.vessels.push({
      ...structuredClone(template.ship),
      propertyId: h.id,
      mode: "docked",
      facilityId: null,
      installed: [],
      arrearsCopper: 0,
      expenseRemainder: 0,
      dmNotes: "",
    });
  if (template.shipyard) {
    if (!h.locationId) throw Error("A shipyard purchase requires a location.");
    f.facilities.push({
      ...structuredClone(template.shipyard),
      id: `yard-${h.id}`,
      propertyId: h.id,
      name: h.name,
      locationId: h.locationId,
      public: false,
      accessPurseIds: [],
    });
  }
}
export function assertShipDisposable(t: Table, id: string) {
  const f = t.journal?.fleet;
  if (!f) return;
  if (
    occupants(t, id).length ||
    f.voyages.some((v) => v.propertyId === id && !closed(v)) ||
    f.vessels.some((v) => v.propertyId === id && v.arrearsCopper) ||
    f.facilities.some((y) => y.propertyId === id && f.vessels.some((v) => v.facilityId === y.id))
  )
    throw Error(
      "Resolve occupants, voyages, ship arrears and stored vessels before selling or transferring this property.",
    );
}
export function removeShip(t: Table, id: string) {
  const f = t.journal?.fleet;
  if (!f) return;
  f.vessels = f.vessels.filter((v) => v.propertyId !== id);
  f.facilities = f.facilities.filter((y) => y.propertyId !== id);
  // Closed records remain as history; validation permits historical references.
}
export function validateFleet(t: Table, projected = false) {
  if (!t.journal?.fleet) return;
  const f = readFleet(t.journal.fleet),
    m = readMarketLocations(t.journal.market),
    estate = readEstate(t.journal.propertyOperations);
  const locations = new Set(m.locations.map((l) => l.id)),
    purses = new Set(t.purses.map((p) => p.id));
  for (const v of f.vessels) {
    const h = holding(t, v.propertyId),
      site = estate.sites.find((s) => s.propertyId === h.id);
    if (!site || site.capacityWeight !== v.stats.cargoWeight)
      throw Error("Ship cargo capacity must match its property storage.");
    if (
      v.facilityId &&
      !f.facilities.some((y) => y.id === v.facilityId && y.locationId === h.locationId)
    )
      throw Error("A ship's berth must match its location.");
    if (v.mode === "sailing" && (h.locationId || v.facilityId))
      throw Error("An underway ship cannot also occupy a berth.");
    const used = storageWeight(t, h.id);
    if (used.unknown || used.weight > v.stats.cargoWeight)
      throw Error("Ship cargo needs known weights within capacity.");
    if (occupants(t, h.id).length > v.stats.passengers)
      throw Error("Ship passenger capacity is exceeded.");
    if (
      new Set(v.upgrades.map((u) => u.key)).size !== v.upgrades.length ||
      new Set(v.installed).size !== v.installed.length
    )
      throw Error("Ship upgrade identities must be unique.");
  }
  for (const y of f.facilities) {
    if (
      !locations.has(y.locationId) ||
      (y.propertyId &&
        (!projected || t.holdings.some((h) => h.id === y.propertyId)) &&
        holding(t, y.propertyId).locationId !== y.locationId)
    )
      throw Error("A dock or shipyard needs its property's current location.");
    if (y.propertyId && f.vessels.some((v) => v.propertyId === y.propertyId))
      throw Error("A ship cannot be its own shipyard.");
    if (f.vessels.some((v) => v.facilityId === y.id && v.stats.lengthFeet > y.maxLengthFeet))
      throw Error("A stored ship exceeds the facility length limit.");
    if (f.vessels.filter((v) => v.facilityId === y.id).length > y.slots)
      throw Error("Shipyard capacity is exceeded.");
  }
  for (const aboard of f.aboard) {
    const v = f.vessels.find((v) => v.propertyId === aboard.propertyId);
    const s = t.journal.world?.characterPositions.find((s) => s.purseId === aboard.purseId);
    if ((!s || !v) && projected) continue;
    if (
      !v ||
      !s ||
      s.inParty ||
      s.downtime ||
      s.locationId !== (holding(t, v.propertyId).locationId ?? null)
    )
      throw Error("Aboard character placement must follow its ship.");
  }
  for (const v of f.voyages)
    if (!closed(v)) {
      if (
        !f.vessels.some((s) => s.propertyId === v.propertyId) ||
        !locations.has(v.originId) ||
        !locations.has(v.destinationId) ||
        (!projected && !purses.has(v.payerId)) ||
        v.elapsedMinutes > v.durationMinutes
      )
        throw Error("An ongoing voyage has missing or invalid references.");
      if (f.voyages.filter((x) => x.propertyId === v.propertyId && !closed(x)).length > 1)
        throw Error("A ship can have only one ongoing voyage.");
    }
  for (const work of f.work)
    if (
      !work.applied &&
      estate.jobs.some((j) => j.id === work.jobId && !["cancelled", "denied"].includes(j.status))
    )
      if (
        !f.vessels.some((v) => v.propertyId === work.propertyId) ||
        !f.facilities.some((y) => y.id === work.facilityId)
      )
        throw Error("Ship work needs its ship and facility.");
}
function voyageBlock(t: CloudTable, s: Vessel, v: ShipVoyage) {
  if (!t.journal!.propertyOperations!.sites.find((x) => x.propertyId === s.propertyId)?.enabled)
    return "Ship operations are disabled.";
  if (s.mode !== "sailing") return "Launch the ship before travel.";
  if (s.stats.milesPerDay <= 0) return "The ship needs a positive travel pace.";
  if (s.arrearsCopper) return "Settle ship maintenance arrears before sailing.";
  if (s.stats.components.some((c) => ["hull", "helm", "movement"].includes(c.kind) && c.hp === 0))
    return "Repair disabled hull, helm or movement components first.";
  const e = t.journal!.propertyOperations!,
    staff = e.staff.filter(
      (c) =>
        c.propertyId === s.propertyId &&
        c.status === "active" &&
        /captain|sailor|crew|navigator/i.test(c.role) &&
        !t.journal!.finance!.rules.some((r) => r.id === `estate-wage-${c.id}` && r.arrears),
    );
  const crew = new Set(
    staff
      .filter((c) => !c.npcId || occupants(t, s.propertyId).some((p) => p.purseId === c.npcId))
      .map((c) => c.npcId ?? `staff:${c.id}`),
  );
  for (const id of v.crewPurseIds) {
    if (!occupants(t, s.propertyId).some((p) => p.purseId === id))
      return "Assigned crew characters must remain aboard.";
    if (
      e.jobs.some(
        (j) =>
          ["active", "blocked"].includes(j.status) && j.assignments.some((a) => a.purseId === id),
      )
    )
      return "Sailing crew cannot also perform property project labor.";
    crew.add(id);
  }
  if (crew.size < s.stats.minimumCrew)
    return "The ship needs its minimum paid crew or assigned aboard characters.";
  const captain = staff.find(
    (c) =>
      c.id === v.captainId &&
      c.manager &&
      (!c.npcId || occupants(t, s.propertyId).some((p) => p.purseId === c.npcId)),
  );
  if (!v.crewPurseIds.length && !captain)
    return "An unattended voyage needs an active, paid captain with manager authority.";
  if (v.destinationFacilityId) {
    const facility = t.journal!.fleet!.facilities.find((f) => f.id === v.destinationFacilityId);
    try {
      if (!facility) return "The destination berth is missing.";
      checkBerth(
        t,
        s,
        facility,
        { role: "player", purseIds: [holding(t, s.propertyId).purseId, ...v.crewPurseIds] },
        v.destinationId,
      );
    } catch (e) {
      return e instanceof Error ? e.message : "Destination berth unavailable.";
    }
  }
  return "";
}
export function applyShipCommand(t: CloudTable, seat: CloudSeat, cmd: ShipCommand, at: number) {
  const j = t.journal!,
    f = (j.fleet ??= readFleet());
  j.finance ??= readFinance();
  j.propertyOperations ??= readEstate();
  const dm = () => {
    if (seat.role !== "dm") throw Error("Only the DM can approve ship rules or use this override.");
  };
  if (j.finance.downtime.some((d) => d.status === "pending"))
    throw Error("Approve or cancel pending downtime before changing ships.");
  const access = (id: string) => {
    if (!canAccessEstate(t, j.propertyOperations!, id, seat))
      throw Error("You do not have access to this ship.");
    const s = f.vessels.find((s) => s.propertyId === id);
    if (!s) throw Error("This ship is missing.");
    return s;
  };
  const stale = (before: string, propertyId: string) => {
    if (before !== shipFingerprint(t, propertyId))
      throw Error("The ship or campaign changed. Review a fresh action.");
  };
  let propertyId = "",
    summary = "";
  if (cmd.kind === "ship-configure") {
    dm();
    const v = cmd.vessel,
      h = holding(t, v.propertyId),
      old = f.vessels.find((x) => x.propertyId === h.id) ?? null;
    if (!same(old, cmd.before)) throw Error("Ship settings changed. Reload before saving.");
    if (
      old &&
      (old.mode !== v.mode ||
        old.facilityId !== v.facilityId ||
        old.arrearsCopper !== v.arrearsCopper ||
        old.expenseRemainder !== v.expenseRemainder ||
        !same(old.installed, v.installed))
    )
      throw Error("Use berth, travel, upgrades and arrears controls to change operating records.");
    if (
      !old &&
      (v.mode !== "docked" ||
        v.facilityId ||
        v.installed.length ||
        v.arrearsCopper ||
        v.expenseRemainder)
    )
      throw Error("New ships start docked without operating history.");
    if (!h.locationId && !old)
      throw Error("Set the ship's initial location before configuring it.");
    const key = `ship-${h.id}`
      .slice(0, 80)
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "-");
    let site = j.propertyOperations.sites.find((s) => s.propertyId === h.id);
    if (!site) {
      j.propertyOperations.templates.push({
        key,
        name: "Ship operations",
        propertyType: "other",
        capabilities: ["storage", "transport", "trade"],
        recipes: [],
      });
      site = {
        propertyId: h.id,
        templateKey: key,
        enabled: true,
        access:
          t.purses.find((p) => p.id === h.purseId)?.kind === "party" ? "party-members" : "owner",
        accessPurseIds: [],
        capacityWeight: v.stats.cargoWeight,
        completedTemplates: [],
        notes: "",
      };
      j.propertyOperations.sites.push(site);
    }
    site.capacityWeight = v.stats.cargoWeight;
    f.vessels = [...f.vessels.filter((x) => x.propertyId !== h.id), structuredClone(v)];
    propertyId = h.id;
    summary = "Ship stat block, expenses and work definitions reviewed by DM.";
  } else if (cmd.kind === "ship-facility") {
    dm();
    const y = cmd.facility,
      old = f.facilities.find((x) => x.id === y.id) ?? null;
    if (!same(old, cmd.before)) throw Error("Facility changed. Reload before saving.");
    if (
      old &&
      (old.propertyId !== y.propertyId || old.locationId !== y.locationId) &&
      f.vessels.some((v) => v.facilityId === y.id)
    )
      throw Error("Move stored ships before changing the facility's identity or location.");
    f.facilities = [...f.facilities.filter((x) => x.id !== y.id), structuredClone(y)];
    propertyId = y.propertyId ?? "";
    summary = `Reviewed ${y.name} storage and shipyard terms.`;
  } else if (cmd.kind === "ship-board-review") {
    dm();
    const r = f.boarding.find((r) => r.id === cmd.requestId);
    if (!r || r.status !== "pending" || !same(r, cmd.before))
      throw Error("This boarding request changed or is already reviewed.");
    const s = access(r.propertyId);
    if (cmd.approve) {
      if (
        !canAccessEstate(t, j.propertyOperations, r.propertyId, {
          role: "player",
          purseIds: [r.purseId],
        })
      )
        throw Error("The requester no longer has ship access.");
      board(t, s, r.purseId, r.action);
    }
    r.status = cmd.approve ? "approved" : "denied";
    propertyId = s.propertyId;
    summary = `${r.action} request ${r.status}.`;
  } else if (cmd.kind === "ship-voyage") {
    const v = structuredClone(cmd.voyage),
      s = access(v.propertyId),
      h = holding(t, s.propertyId),
      old = f.voyages.find((x) => x.id === v.id) ?? null;
    if (!same(old, cmd.before)) throw Error("The voyage changed. Reload before reviewing.");
    if (old && closed(old)) throw Error("This voyage is already closed.");
    if (
      old &&
      (v.propertyId !== old.propertyId ||
        v.elapsedMinutes !== old.elapsedMinutes ||
        v.spentCopper !== old.spentCopper ||
        v.travelExpenseRemainder !== old.travelExpenseRemainder)
    )
      throw Error("Voyage progress changes only through approved downtime.");
    if (
      !old &&
      (v.elapsedMinutes || v.spentCopper || v.travelExpenseRemainder || v.originId !== h.locationId)
    )
      throw Error(
        "A new voyage starts at the ship's current location with no elapsed time or spending.",
      );
    if (seat.role !== "dm") {
      if (
        v.status !== "proposed" ||
        (old && old.status !== "proposed") ||
        (old && old.requestedBy !== seat.id) ||
        !seat.purseIds.includes(v.payerId) ||
        v.crewPurseIds.some((id) => !seat.purseIds.includes(id))
      )
        throw Error("Propose travel using your own payer and crew; the DM approves it.");
    } else {
      dm();
      if (!["proposed", "active", "cancelled", "denied"].includes(v.status))
        throw Error("Use downtime for arrival/progress and teleport for DM movement.");
    }
    v.requestedBy = old?.requestedBy ?? seat.id;
    if (v.status === "active" && !["active", "blocked"].includes(old?.status ?? "")) {
      if (s.mode !== "docked")
        throw Error("Launch from dry storage/shipyard before approving travel.");
      if (h.locationId !== v.originId) throw Error("The voyage origin changed.");
      s.mode = "sailing";
      s.facilityId = null;
      const issue = voyageBlock(t, s, v);
      if (issue) throw Error(issue);
      pauseWork(t, s.propertyId, "Ship departed; yard work paused for review.");
      move(t, s, null);
    }
    if (v.status === "cancelled" && old && ["active", "blocked"].includes(old.status))
      throw Error("Use DM Teleport Ship to place a voyage already underway, then close it.");
    f.voyages = [...f.voyages.filter((x) => x.id !== v.id), v];
    propertyId = s.propertyId;
    summary = `Voyage ${v.status}; ${v.durationMinutes / 1440} downtime days proposed.`;
  } else {
    const s = access(cmd.propertyId),
      h = holding(t, s.propertyId);
    propertyId = h.id;
    if ("before" in cmd && cmd.kind !== "ship-name") stale(cmd.before, h.id);
    if (cmd.kind === "ship-name") {
      if (h.name !== cmd.before) throw Error("The ship name changed. Reload before saving.");
      h.name = cmd.name;
      summary = `Ship named ${cmd.name}.`;
    } else if (cmd.kind === "ship-berth") {
      if (s.mode === "sailing") throw Error("Finish or teleport the active voyage first.");
      if (seat.role !== "dm" && !seat.purseIds.some((id) => shipHere(t, h, id)))
        throw Error("Visit the ship to change storage.");
      const y = f.facilities.find((y) => y.id === cmd.facilityId);
      if (cmd.facilityId && !y) throw Error("Choose an existing facility.");
      if (y) checkBerth(t, s, y, seat);
      if (cmd.mode !== "docked" && !y)
        throw Error("Dry storage and shipyard storage require a facility.");
      if (s.facilityId !== cmd.facilityId || s.mode !== cmd.mode)
        pauseWork(t, h.id, "Ship left its work facility; review before resuming.");
      s.facilityId = cmd.facilityId;
      s.mode = cmd.mode;
      summary = `Ship placed in ${cmd.mode}.`;
    } else if (cmd.kind === "ship-board") {
      if (seat.role !== "dm" && !seat.purseIds.includes(cmd.purseId))
        throw Error("Request movement only for your assigned character.");
      if (seat.role === "dm") board(t, s, cmd.purseId, cmd.action);
      else {
        if (!shipHere(t, h, cmd.purseId) || s.mode === "sailing")
          throw Error("Be present at a moored ship to request boarding/disembarking.");
        if (
          f.boarding.some(
            (r) => r.propertyId === h.id && r.purseId === cmd.purseId && r.status === "pending",
          )
        )
          throw Error("This character already has a pending boarding request.");
        f.boarding.push({
          id: cmd.id,
          propertyId: h.id,
          purseId: cmd.purseId,
          action: cmd.action,
          status: "pending",
          requestedBy: seat.id,
        });
      }
      summary = `${cmd.action}${seat.role === "dm" ? " recorded" : " proposed for DM review"}.`;
    } else if (cmd.kind === "ship-damage") {
      dm();
      const c = s.stats.components.find((c) => c.id === cmd.componentId);
      if (!c) throw Error("Choose a ship component.");
      const taken = cmd.damage < c.threshold ? 0 : cmd.damage;
      c.hp = Math.max(0, c.hp - taken);
      summary = `${c.name}: ${taken} damage after threshold; ${c.hp}/${c.maxHp} HP. ${cmd.reason}`;
    } else if (cmd.kind === "ship-teleport") {
      dm();
      if (!readMarketLocations(j.market).locations.some((l) => l.id === cmd.destinationId))
        throw Error("Choose an existing destination.");
      const y = f.facilities.find((y) => y.id === cmd.facilityId);
      if (cmd.facilityId && !y) throw Error("The destination facility is missing.");
      if (y) checkBerth(t, s, y, seat, cmd.destinationId);
      for (const v of f.voyages.filter((v) => v.propertyId === h.id && !closed(v))) {
        v.status = "dm-overridden";
        v.message = `DM teleported the ship. ${cmd.reason}`;
      }
      pauseWork(t, h.id, "DM teleport moved the ship; former yard work paused for review.");
      s.mode = "docked";
      s.facilityId = y?.id ?? null;
      move(t, s, cmd.destinationId);
      summary = `DM teleported ship, all cargo and aboard characters to ${cmd.destinationId}; no travel time or expense. ${cmd.reason}`;
    } else if (cmd.kind === "ship-arrears") {
      if (seat.role !== "dm" && !seat.purseIds.includes(cmd.payerId))
        throw Error("Use your own paying character.");
      if (cmd.copper > s.arrearsCopper) throw Error("Payment exceeds recorded arrears.");
      financeMove(t, cmd.payerId, -cmd.copper, cmd.id, "Ship maintenance arrears", at);
      s.arrearsCopper -= cmd.copper;
      summary = "Paid recorded ship arrears.";
    } else if (cmd.kind === "ship-work") {
      if (
        seat.role !== "dm" &&
        (!seat.purseIds.includes(cmd.payerId) ||
          cmd.assignments.some((a) => !seat.purseIds.includes(a.purseId)))
      )
        throw Error("Propose your own payer and workers.");
      if (!t.purses.some((p) => p.id === cmd.payerId))
        throw Error("Choose an existing paying purse.");
      const y = f.facilities.find((y) => y.id === s.facilityId);
      if (!y || !["shipyard", "dry-storage"].includes(s.mode))
        throw Error("Place the ship in a repair shipyard or dry storage first.");
      if (!facilityAccess(t, y, seat)) throw Error("This shipyard is private.");
      if (!!cmd.upgradeKey === !!cmd.componentId)
        throw Error("Choose either a repair or an upgrade.");
      let effect: Fleet["work"][number]["effect"], days: number, cost: number;
      let inputs: { materialKey: string; quantity: number }[], name: string;
      if (cmd.componentId) {
        const c = s.stats.components.find((c) => c.id === cmd.componentId);
        if (!y.repair || !c || !cmd.hp || cmd.hp > c.maxHp - c.hp)
          throw Error(
            "Choose damaged HP within this component's repair limit at a repair facility.",
          );
        days = Math.ceil(cmd.hp / s.repairHpPerDay);
        cost = cmd.hp * s.repairCopperPerHp;
        inputs = s.repairMaterials.map((m) => ({ ...m, quantity: m.quantity * cmd.hp! }));
        name = `Repair ${c.name}: ${cmd.hp} HP`;
        effect = { kind: "repair", componentId: c.id, hp: cmd.hp };
      } else {
        const u = s.upgrades.find((u) => u.key === cmd.upgradeKey);
        if (
          !y.upgrades ||
          !u ||
          s.installed.includes(u.key) ||
          f.work.some(
            (w) =>
              !w.applied &&
              w.effect.kind === "upgrade" &&
              w.effect.upgrade.key === u.key &&
              w.propertyId === h.id &&
              j.propertyOperations!.jobs.some(
                (j) => j.id === w.jobId && !["cancelled", "denied"].includes(j.status),
              ),
          )
        )
          throw Error("Choose an available upgrade at an upgrade-capable shipyard.");
        days = u.laborDays;
        cost = u.laborCopper;
        inputs = u.materials;
        name = u.name;
        effect = { kind: "upgrade", upgrade: structuredClone(u) };
      }
      const recipe = {
        key: `ship-work-${cmd.id}`
          .slice(0, 80)
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, "-"),
        name,
        laborDays: days,
        laborCostCopper: cost,
        materials: inputs,
      };
      const job: EstateJob = {
        id: cmd.id,
        propertyId: h.id,
        purseId: cmd.payerId,
        name,
        recipeKey: recipe.key,
        recipe,
        status: "draft",
        stage: 0,
        progress: 0,
        paidProgress: 0,
        paidCopper: 0,
        assignments: cmd.assignments,
        paidWorkers: cmd.paidWorkers,
        approvedChecks: false,
        checkNotes: "Ship work; DM review required.",
        message: "",
        requestedBy: seat.id,
        createdDay: j.finance.day,
      };
      // All player-owned inputs and the DM-defined quote were checked above. The existing
      // project engine creates only a draft; no supplies, coins or progress are applied here.
      applyEstateCommand(
        t,
        { ...seat, role: "dm" },
        { id: cmd.id, kind: "estate-job", before: null, job },
        at,
      );
      f.work.push({
        jobId: job.id,
        propertyId: h.id,
        facilityId: y.id,
        effect,
        recipeFingerprint: canonicalJson(recipe),
        applied: false,
      });
      summary = `Proposed ${name}; review the existing property project to approve labor and materials.`;
    }
  }
  validateFleet(t);
  j.events.push({
    id: cmd.id + "-ship",
    at,
    kind: "management",
    ...(propertyId
      ? { propertyId, purseId: t.holdings.find((h) => h.id === propertyId)?.purseId }
      : {}),
    summary: summary.slice(0, 500),
  });
}

export function shipWorkBlock(t: CloudTable, job: EstateJob) {
  const w = t.journal?.fleet?.work.find((w) => w.jobId === job.id && !w.applied);
  if (!w) return "";
  const s = t.journal!.fleet!.vessels.find((s) => s.propertyId === w.propertyId),
    y = t.journal!.fleet!.facilities.find((y) => y.id === w.facilityId);
  if (!s || !y || s.facilityId !== y.id || !["shipyard", "dry-storage"].includes(s.mode))
    return "Return the ship to its reviewed work facility before resuming this job.";
  if (!same(job.recipe, JSON.parse(w.recipeFingerprint)))
    return "Ship work recipe changed; cancel and propose a fresh reviewed work quote.";
  if ((w.effect.kind === "repair" && !y.repair) || (w.effect.kind === "upgrade" && !y.upgrades))
    return "The facility no longer supports this work.";
  return "";
}
export function finishShipWork(t: CloudTable) {
  for (const w of t.journal?.fleet?.work ?? []) {
    const job = t.journal!.propertyOperations!.jobs.find((j) => j.id === w.jobId);
    if (w.applied || job?.status !== "completed") continue;
    const s = t.journal!.fleet!.vessels.find((s) => s.propertyId === w.propertyId)!;
    if (w.effect.kind === "repair") {
      const componentId = w.effect.componentId;
      const c = s.stats.components.find((c) => c.id === componentId);
      if (!c)
        throw Error(
          "The repaired component changed. Restore it or cancel/requote work before completing.",
        );
      c.hp = Math.min(c.maxHp, c.hp + w.effect.hp);
    } else {
      const u = w.effect.upgrade,
        h = s.stats.components.find((c) => c.kind === "hull")!;
      if (s.installed.includes(u.key)) throw Error("This upgrade is already installed.");
      h.maxHp += u.hullHp;
      h.hp += u.hullHp;
      h.ac += u.hullAc;
      s.stats.cargoWeight += u.cargoWeight;
      s.stats.speedFeet += u.speedFeet;
      s.stats.milesPerDay += u.milesPerDay;
      s.stats.passengers += u.passengers;
      if (u.component) {
        if (s.stats.components.some((c) => c.id === u.component!.id))
          throw Error("The upgrade component identity is already installed.");
        s.stats.components.push(structuredClone(u.component));
      }
      s.installed.push(u.key);
      t.journal!.propertyOperations!.sites.find(
        (x) => x.propertyId === s.propertyId,
      )!.capacityWeight = s.stats.cargoWeight;
    }
    w.applied = true;
  }
}
/** Called by the existing property preview, once per approved interval, never wall time. */
export function advanceShips(
  t: CloudTable,
  minutes: number,
  allowTravel: boolean,
  receiptId: string,
  notices: { propertyId: string; summary: string }[],
) {
  const fleet = t.journal?.fleet;
  if (!fleet) return;
  for (const s of fleet.vessels) {
    const h = holding(t, s.propertyId),
      v = fleet.voyages.find(
        (v) => v.propertyId === h.id && ["active", "blocked"].includes(v.status),
      );
    let travel = 0,
      block = "";
    if (v && allowTravel) {
      block = voyageBlock(t, s, v);
      if (!block) travel = Math.min(minutes, v.durationMinutes - v.elapsedMinutes);
    }
    const y = fleet.facilities.find((y) => y.id === s.facilityId);
    const privateFree = !!y?.propertyId && holding(t, y.propertyId).purseId === h.purseId;
    const fee =
      y && !privateFree
        ? s.mode === "dry-storage"
          ? y.dryCopper
          : s.mode === "shipyard"
            ? y.yardCopper
            : y.dockCopper
        : 0;
    let daily =
      (s.mode === "sailing"
        ? s.sailingCopper
        : s.mode === "docked"
          ? s.dockedCopper
          : s.storedCopper) + fee;
    const destination = v?.destinationFacilityId
      ? fleet.facilities.find((y) => y.id === v.destinationFacilityId)
      : undefined;
    const arrivalFee =
      destination &&
      !(destination.propertyId && holding(t, destination.propertyId).purseId === h.purseId)
        ? destination.dockCopper
        : 0;
    let numerator = daily * minutes + s.expenseRemainder;
    if (v && travel && v.elapsedMinutes + travel === v.durationMinutes)
      numerator =
        s.sailingCopper * travel +
        (s.dockedCopper + arrivalFee) * (minutes - travel) +
        s.expenseRemainder;
    let due = Math.floor(numerator / 1440);
    const payerId = v?.payerId ?? h.purseId;
    const payer = t.purses.find((p) => p.id === payerId);
    if (!payer) throw Error("Ship expense payer is missing.");
    const captain = v?.captainId
      ? t.journal!.propertyOperations!.staff.find((c) => c.id === v.captainId)
      : undefined;
    if (captain) {
      const day = t.journal!.finance!.day;
      if (day >= captain.budgetStartDay + captain.budgetPeriodDays) {
        captain.budgetStartDay +=
          Math.floor((day - captain.budgetStartDay) / captain.budgetPeriodDays) *
          captain.budgetPeriodDays;
        captain.budgetSpentCopper = 0;
      }
    }
    if (
      v &&
      travel &&
      (due + s.arrearsCopper > toCopper(payer.coins) ||
        v.spentCopper + Math.ceil((s.sailingCopper * travel + v.travelExpenseRemainder) / 1440) >
          v.budgetCopper ||
        (captain &&
          captain.budgetSpentCopper +
            Math.ceil((s.sailingCopper * travel + v.travelExpenseRemainder) / 1440) >
            captain.budgetCopper))
    ) {
      block = "Insufficient voyage funds, budget or captain spending authority.";
      travel = 0;
      daily = s.dockedCopper;
      numerator = daily * minutes + s.expenseRemainder;
      due = Math.floor(numerator / 1440);
    }
    s.expenseRemainder = numerator % 1440;
    const total = due + s.arrearsCopper,
      paid = Math.min(total, toCopper(payer.coins));
    s.arrearsCopper = total - paid;
    financeMove(
      t,
      payerId,
      -paid,
      `${receiptId}-${h.id}`,
      `${h.name}: maintenance, storage and provisions${s.arrearsCopper ? `; ${s.arrearsCopper} cp unpaid` : ""}`,
      0,
    );
    if (v && travel) {
      const travelNumerator = s.sailingCopper * travel + v.travelExpenseRemainder;
      const spent = Math.floor(travelNumerator / 1440);
      v.travelExpenseRemainder = travelNumerator % 1440;
      v.spentCopper += spent;
      if (captain) {
        const day = t.journal!.finance!.day;
        if (day >= captain.budgetStartDay + captain.budgetPeriodDays) {
          captain.budgetStartDay = day;
          captain.budgetSpentCopper = 0;
        }
        captain.budgetSpentCopper += spent;
      }
      v.elapsedMinutes += travel;
      v.status = "active";
      v.message = `${v.elapsedMinutes / 1440}/${v.durationMinutes / 1440} downtime days travelled.`;
      if (v.elapsedMinutes === v.durationMinutes) {
        v.status = "arrived";
        v.message = "Arrived through approved downtime.";
        s.mode = "docked";
        s.facilityId = v.destinationFacilityId;
        move(t, s, v.destinationId);
        notices.push({
          propertyId: h.id,
          summary: `${h.name} arrived at ${v.destinationId}; aboard characters and cargo retained.`,
        });
      }
    } else if (v && allowTravel) {
      v.status = "blocked";
      v.message = block;
    }
    notices.push({
      propertyId: h.id,
      summary: `${h.name}: ${paid} cp paid, ${s.arrearsCopper} cp arrears${v ? `; ${v.message}` : ""}.`,
    });
  }
}
