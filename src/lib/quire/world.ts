import {
  readWorld,
  type WorldCommand,
  type Npc,
  type CampaignMap,
  type Trade,
} from "./world-schema.ts";
import type { CloudTable, CloudSeat } from "./cloud.ts";
import type { Holding } from "./types.ts";
import { canonicalJson } from "./canonical-json.ts";
import { locationPath, readMarketLocations } from "./shop-locations.ts";
import { assertCarried, assertEstateDisposable } from "./estate.ts";
import { transferPropertyDeed } from "./property-deed.ts";
import { fromCopper, toCopper } from "./money.ts";
import { advanceSessionTime } from "./session-time.ts";
import { applyCharacterPosition } from "./character-position.ts";

export function npcAvailableHere(npc: Npc, table: Pick<CloudTable, "journal">) {
  const market = readMarketLocations(table.journal?.market);
  const s = table.journal?.world?.characterPositions?.find((s) => s.purseId === npc.id);
  return (
    npc.visible &&
    (s?.visible ?? true) &&
    (s?.inParty ||
      (!!market.currentLocationId &&
        locationPath(market, market.currentLocationId).some(
          (l) => l.id === (s ? s.locationId : npc.locationId),
        )))
  );
}
export { shopVisible, shopAsking } from "./vendors.ts";
export function npcController(npc: Npc, seat: Pick<CloudSeat, "role" | "purseIds">) {
  return (
    seat.role === "dm" || (!!npc.controllerPurseId && seat.purseIds.includes(npc.controllerPurseId))
  );
}
export function worldImportFingerprint(t: CloudTable) {
  return canonicalJson({
    npcs: t.journal?.world?.npcs ?? [],
    purses: t.purses
      .map((p) => ({ id: p.id, name: p.name }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    market: t.journal?.market,
  });
}
export function validateWorld(t: CloudTable, projected = false) {
  const w = readWorld(t.journal?.world),
    market = readMarketLocations(t.journal?.market),
    locations = new Set(market.locations.map((l) => l.id));
  const unique = (ids: string[], label: string) => {
    if (new Set(ids).size !== ids.length) throw Error(`Duplicate ${label} IDs.`);
  };
  unique(
    w.characterPositions.map((s) => s.purseId),
    "character placement",
  );
  for (const s of w.characterPositions) {
    const p = t.purses.find((p) => p.id === s.purseId && p.kind === "character");
    if (
      !p ||
      (s.locationId && !locations.has(s.locationId)) ||
      (s.downtime &&
        (s.inParty ||
          s.downtime.finishMinute <= s.downtime.startedMinute ||
          (s.downtime.returnLocationId && !locations.has(s.downtime.returnLocationId))))
    )
      throw Error("Character placement or downtime references are invalid.");
    if (w.npcs.some((n) => n.id === s.purseId) && !!p.nonParty === s.inParty)
      throw Error("NPC party membership is inconsistent.");
  }
  unique(
    w.maps.map((m) => m.id),
    "map",
  );
  unique(
    w.npcs.map((n) => n.id),
    "NPC",
  );
  unique(
    w.trades.map((o) => o.id),
    "trade",
  );
  unique(
    w.conversations.map((c) => c.id),
    "conversation",
  );
  unique(
    w.timeHistory.map((c) => c.id),
    "time receipt",
  );
  for (const map of w.maps) {
    if (map.locationId && !locations.has(map.locationId)) throw Error("Map location is missing.");
    unique(
      map.anchors.map((a) => a.locationId),
      "map anchor",
    );
    unique(
      map.markers.map((m) => m.id),
      "map marker",
    );
    if (map.anchors.some((a) => !locations.has(a.locationId)))
      throw Error("A map anchor has a missing location.");
  }
  for (const npc of w.npcs) {
    const p = t.purses.find((p) => p.id === npc.id);
    if (
      !p ||
      p.kind !== "character" ||
      p.control !== "npc" ||
      p.name !== npc.name ||
      !locations.has(npc.locationId)
    )
      throw Error("NPC account or location is invalid.");
    if (
      !projected &&
      npc.controllerPurseId &&
      !t.purses.some(
        (p) =>
          p.id === npc.controllerPurseId &&
          !p.nonParty &&
          p.kind === "character" &&
          p.control !== "npc",
      )
    )
      throw Error("Choose an existing player character to act as this NPC.");
  }
  // Exchange treasuries are canonical non-party accounts configured by the
  // regional exchange, rather than people players can independently barter with.
  if (
    !projected &&
    t.purses.some(
      (p) =>
        p.nonParty &&
        !w.npcs.some((n) => n.id === p.id) &&
        !t.journal?.tradeEconomy?.exchanges.some((e) => e.purseId === p.id),
    )
  )
    throw Error("A non-party NPC is missing its configuration.");
  for (const trade of w.trades) {
    if (
      trade.left.purseId === trade.right.purseId ||
      ![trade.left.purseId, trade.right.purseId].includes(trade.awaitingId)
    )
      throw Error("Invalid trade participants.");
    for (const side of [trade.left, trade.right]) {
      unique(
        side.items.map((i) => i.holdingId),
        "offered item",
      );
      for (const item of side.items) {
        const h = JSON.parse(item.before) as Holding;
        if (h.id !== item.holdingId || h.purseId !== side.purseId || h.quantity < item.quantity)
          throw Error("Invalid trade inventory receipt.");
      }
    }
  }
  for (const shop of t.shops)
    if (
      shop.blackMarketPremium !== undefined &&
      (!Number.isFinite(shop.blackMarketPremium) ||
        shop.blackMarketPremium < 1.01 ||
        shop.blackMarketPremium > 100)
    )
      throw Error("Black-market premium must be greater than ordinary prices.");
}
/** The closest known ancestor supplies a position when an area has no separate anchor. */
export function anchorFor(
  map: CampaignMap,
  t: Pick<CloudTable, "journal">,
  locationId?: string | null,
) {
  return [...locationPath(readMarketLocations(t.journal?.market), locationId)]
    .reverse()
    .map((l) => map.anchors.find((a) => a.locationId === l.id))
    .find(Boolean);
}
export function recognizedAnchors(
  lines: { text: string; x: number; y: number; width: number; size: number }[],
  width: number,
  height: number,
  t: Pick<CloudTable, "journal">,
) {
  const normalize = (s: string) =>
    s
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const locations = readMarketLocations(t.journal?.market).locations;
  return lines
    .flatMap((line) => {
      const matches = locations.filter((l) => normalize(l.name) === normalize(line.text));
      return matches.length === 1
        ? [
            {
              locationId: matches[0].id,
              x: Math.max(0, Math.min(1, (line.x + line.width / 2) / width)),
              y: Math.max(0, Math.min(1, (-line.y + line.size / 2) / height)),
            },
          ]
        : [];
    })
    .filter((a, i, rows) => rows.findIndex((b) => b.locationId === a.locationId) === i);
}
function participant(t: CloudTable, seat: CloudSeat, id: string) {
  const npc = readWorld(t.journal?.world).npcs.find((n) => n.id === id);
  const p = t.purses.find((p) => p.id === id);
  if (!p) throw Error("This trade account no longer exists.");
  if (npc ? !npcController(npc, seat) : seat.role !== "dm" && !seat.purseIds.includes(id))
    throw Error("Only this participant or the DM can decide their side of the trade.");
  return p;
}
function eligible(t: CloudTable, trade: Pick<Trade, "left" | "right">) {
  const w = readWorld(t.journal?.world);
  for (const side of [trade.left, trade.right]) {
    if (!t.purses.some((p) => p.id === side.purseId))
      throw Error("Trade account no longer exists.");
    const npc = w.npcs.find((n) => n.id === side.purseId);
    if (npc && (!npc.barterAllowed || !npcAvailableHere(npc, t)))
      throw Error("This NPC is not available for bartering at the current location.");
    for (const item of side.items) {
      const h = t.holdings.find((h) => h.id === item.holdingId && h.purseId === side.purseId);
      if (!h || canonicalJson(h) !== item.before || h.quantity < item.quantity)
        throw Error("An offered lot changed. Review a fresh offer before accepting.");
      assertCarried(h);
      if (h.service) throw Error("Services cannot be transferred.");
      if (h.kind === "property") assertEstateDisposable(t, h.id);
    }
  }
}
function moveItems(t: CloudTable, side: Trade["left"], toId: string, receipt: string, at: number) {
  for (const [index, item] of side.items.entries()) {
    const h = t.holdings.find((h) => h.id === item.holdingId)!,
      recipient = t.purses.find((p) => p.id === toId)!;
    const nextId = `${receipt}-${index}`;
    h.quantity -= item.quantity;
    const next = {
      ...h,
      id: nextId,
      purseId: toId,
      quantity: item.quantity,
      equipped: false,
      ...(h.deed ? { deed: transferPropertyDeed(h.deed, recipient, receipt, at) } : {}),
    };
    t.holdings.push(next);
    if (h.kind === "property" && h.quantity === 0) {
      const site = t.journal?.propertyOperations?.sites.find((s) => s.propertyId === h.id);
      if (site) site.propertyId = nextId;
    }
  }
  t.holdings = t.holdings.filter((h) => h.quantity > 0);
}
export function applyWorldCommand(t: CloudTable, seat: CloudSeat, cmd: WorldCommand, at: number) {
  const journal = t.journal!,
    w = (journal.world = readWorld(journal.world));
  if (applyCharacterPosition(t, seat, cmd, at)) return;
  const dm = () => {
    if (seat.role !== "dm") throw Error("Only the DM can perform this action.");
  };
  const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
  const event = (summary: string, purseId?: string) =>
    journal.events.push({
      id: cmd.id + "-event",
      at,
      summary: summary.slice(0, 500),
      kind: "management",
      ...(purseId ? { purseId } : {}),
    });
  const addNpc = (
    npc: Npc,
    copper: number,
    inventory: Extract<WorldCommand, { kind: "npc-create" }>["inventory"],
  ) => {
    if (t.purses.some((p) => p.id === npc.id) || w.npcs.some((n) => n.id === npc.id))
      throw Error("NPC ID already exists.");
    w.npcs.push(npc);
    t.purses.push({
      id: npc.id,
      name: npc.name,
      kind: "character",
      control: "npc",
      nonParty: true,
      coins: fromCopper(copper),
      ...(npc.portrait ? { portrait: npc.portrait } : {}),
    });
    inventory.forEach((item, i) =>
      t.holdings.push({ ...item, id: `${npc.id}-item-${i}`, purseId: npc.id, kind: "item" }),
    );
  };
  if (cmd.kind === "map-save") {
    dm();
    const current = w.maps.find((m) => m.id === cmd.mapId) ?? null;
    if (!same(current, cmd.before))
      throw Error("This map changed. Reload before saving; your draft is retained.");
    if (cmd.map && cmd.map.id !== cmd.mapId) throw Error("Map identity cannot change.");
    w.maps = w.maps.filter((m) => m.id !== cmd.mapId);
    if (cmd.map) w.maps.push(cmd.map);
    event(cmd.map ? "Campaign map saved" : "Campaign map removed");
  } else if (cmd.kind === "map-marker") {
    dm();
    const map = w.maps.find((m) => m.id === cmd.mapId);
    if (!map) throw Error("Map no longer exists.");
    const current = map.markers.find((m) => m.id === cmd.markerId) ?? null;
    if (!same(current, cmd.before)) throw Error("This marker changed. Reload before saving.");
    if (cmd.marker && cmd.marker.id !== cmd.markerId) throw Error("Marker identity cannot change.");
    map.markers = map.markers.filter((m) => m.id !== cmd.markerId);
    if (cmd.marker) map.markers.push(cmd.marker);
    // Secret marker labels must never appear in the public event stream.
    event("Map markers updated");
  } else if (cmd.kind === "npc-create") {
    dm();
    addNpc(cmd.npc, cmd.copper, cmd.inventory);
    event("A non-party NPC was created.");
  } else if (cmd.kind === "npc-import") {
    dm();
    if (worldImportFingerprint(t) !== cmd.before)
      throw Error("Locations or NPCs changed. Review a fresh import.");
    cmd.document.npcs.forEach((n, i) => {
      const { copper, inventory, ...config } = n;
      addNpc({ ...config, id: `${cmd.id}-npc-${i}` }, copper, inventory);
    });
    event(`Imported ${cmd.document.npcs.length} non-party NPCs.`);
  } else if (cmd.kind === "npc-save") {
    dm();
    const current = w.npcs.find((n) => n.id === cmd.npc.id);
    if (!same(current, cmd.before) || cmd.before.id !== cmd.npc.id)
      throw Error("NPC configuration changed. Reload before saving.");
    Object.assign(current!, cmd.npc);
    const p = t.purses.find((p) => p.id === cmd.npc.id)!;
    if (
      cmd.npc.locationId !== cmd.before.locationId &&
      journal.finance?.downtime.some((d) => d.status === "pending")
    )
      throw Error("Approve or cancel pending campaign downtime before moving an NPC.");
    p.name = cmd.npc.name;
    p.portrait = cmd.npc.portrait;
    const position = w.characterPositions.find((s) => s.purseId === p.id);
    if (position) {
      if (position.downtime && cmd.npc.locationId !== cmd.before.locationId)
        throw Error("Cancel this character's downtime before moving them.");
      position.visible = cmd.npc.visible;
      if (cmd.npc.locationId !== cmd.before.locationId) {
        position.inParty = false;
        position.locationId = cmd.npc.locationId;
        p.nonParty = true;
      }
    }
    event("NPC configuration updated.");
  } else if (cmd.kind === "npc-funds") {
    dm();
    const p = t.purses.find((p) => p.id === cmd.npcId);
    if (!p || !w.npcs.some((n) => n.id === p.id)) throw Error("NPC no longer exists.");
    if (toCopper(p.coins) !== cmd.before)
      throw Error("NPC funds changed. Review the current balance.");
    p.coins = fromCopper(cmd.copper);
    t.ledger.push({
      id: cmd.id,
      at,
      purseId: p.id,
      shopId: null,
      summary: "DM adjusted NPC funds",
      copper: cmd.copper - cmd.before,
      transactionType: "adjustment",
    });
  } else if (cmd.kind === "npc-item" || cmd.kind === "npc-remove-item") {
    dm();
    if (!w.npcs.some((n) => n.id === cmd.npcId)) throw Error("NPC no longer exists.");
    if (cmd.kind === "npc-item")
      t.holdings.push({ ...cmd.item, id: cmd.id + "-item", purseId: cmd.npcId, kind: "item" });
    else {
      const h = t.holdings.find(
        (h) => h.id === cmd.holdingId && h.purseId === cmd.npcId && h.kind === "item",
      );
      if (!h || canonicalJson(h) !== cmd.before)
        throw Error("NPC inventory changed. Reload before removing.");
      assertCarried(h);
      t.holdings = t.holdings.filter((h) => h.id !== h!.id);
    }
    event("NPC inventory updated.");
  } else if (cmd.kind === "npc-message") {
    const npc = w.npcs.find((n) => n.id === cmd.npcId);
    if (!npc) throw Error("NPC no longer exists.");
    if (!t.purses.some((p) => p.id === cmd.purseId && p.kind === "character" && !p.nonParty))
      throw Error("Choose an existing party character.");
    if (cmd.asNpc) {
      if (!npcController(npc, seat)) throw Error("Only the configured NPC controller can respond.");
    } else {
      participant(t, seat, cmd.purseId);
      if (t.purses.find((p) => p.id === cmd.purseId)?.nonParty)
        throw Error("Choose a party character.");
    }
    if (!npcAvailableHere(npc, t))
      throw Error("This NPC is not available at the current location.");
    const conversationId = `${npc.id}:${cmd.purseId}`;
    let c = w.conversations.find((c) => c.id === conversationId);
    if (!c) {
      c = { id: conversationId, npcId: npc.id, purseId: cmd.purseId, messages: [] };
      w.conversations.push(c);
    }
    c.messages.push({ id: cmd.id, author: cmd.asNpc ? "npc" : "character", text: cmd.text, at });
  } else if (cmd.kind === "trade-offer") {
    participant(t, seat, cmd.actorId);
    const existing = w.trades.find((o) => o.id === cmd.tradeId);
    if (
      existing
        ? existing.status !== "pending" || existing.revision !== cmd.revision
        : cmd.revision !== null
    )
      throw Error("The offer changed or was already decided. Review it again.");
    if (
      ![cmd.left.purseId, cmd.right.purseId].includes(cmd.actorId) ||
      cmd.left.purseId === cmd.right.purseId
    )
      throw Error("Choose two different trade participants.");
    if (
      existing &&
      (existing.left.purseId !== cmd.left.purseId || existing.right.purseId !== cmd.right.purseId)
    )
      throw Error("Counteroffers must keep the same participants.");
    if (existing && existing.awaitingId !== cmd.actorId)
      throw Error("Wait for the other participant to respond, or cancel your offer.");
    if (seat.role !== "dm" && !existing && cmd.left.purseId !== cmd.actorId)
      throw Error("Start an offer from your own character.");
    if (seat.role !== "dm") {
      const other = cmd.actorId === cmd.left.purseId ? cmd.right : cmd.left,
        prior =
          existing && (cmd.actorId === existing.left.purseId ? existing.right : existing.left);
      // A request may quote visible NPC goods or the previously disclosed offer, never private guessed inventory.
      if (
        !w.npcs.some((n) => n.id === other.purseId) &&
        other.items.some(
          (i) => !prior?.items.some((p) => p.holdingId === i.holdingId && p.before === i.before),
        )
      )
        throw Error("Ask the other player to add their own inventory in a counteroffer.");
    }
    eligible(t, cmd);
    if (!cmd.left.copper && !cmd.right.copper && !cmd.left.items.length && !cmd.right.items.length)
      throw Error("Offer at least one item, property or some coins.");
    const offer: Trade = {
      id: cmd.tradeId,
      revision: (existing?.revision ?? -1) + 1,
      left: cmd.left,
      right: cmd.right,
      awaitingId: cmd.actorId === cmd.left.purseId ? cmd.right.purseId : cmd.left.purseId,
      status: "pending",
      note: cmd.note,
      at,
    };
    w.trades = w.trades.filter((o) => o.id !== offer.id);
    w.trades.push(offer);
  } else if (cmd.kind === "trade-decision") {
    participant(t, seat, cmd.actorId);
    const offer = w.trades.find((o) => o.id === cmd.tradeId);
    if (!offer || offer.status !== "pending" || offer.revision !== cmd.revision)
      throw Error("This offer changed or was already decided.");
    if (![offer.left.purseId, offer.right.purseId].includes(cmd.actorId))
      throw Error("Only a participant can decide this offer.");
    if (cmd.decision !== "cancelled" && offer.awaitingId !== cmd.actorId)
      throw Error("Only the recipient can accept or decline this offer.");
    if (cmd.decision === "accepted") {
      eligible(t, offer);
      const left = t.purses.find((p) => p.id === offer.left.purseId)!,
        right = t.purses.find((p) => p.id === offer.right.purseId)!;
      if (toCopper(left.coins) < offer.left.copper || toCopper(right.coins) < offer.right.copper)
        throw Error("A participant cannot afford their offered coins. Review a counteroffer.");
      const delta = offer.right.copper - offer.left.copper;
      for (const [p, change] of [
        [left, delta],
        [right, -delta],
      ] as const) {
        const balance = toCopper(p.coins) + change;
        if (!Number.isSafeInteger(balance) || balance > 1e12)
          throw Error("The resulting coin balance is too large.");
        p.coins = fromCopper(balance);
        t.ledger.push({
          id: cmd.id + "-" + p.id,
          at,
          purseId: p.id,
          shopId: null,
          summary: `Barter completed with ${p.id === left.id ? right.name : left.name}`,
          copper: change,
          transactionType: "transfer",
        });
      }
      moveItems(t, offer.left, right.id, cmd.id + "-left", at);
      moveItems(t, offer.right, left.id, cmd.id + "-right", at);
    }
    offer.status = cmd.decision;
    offer.decidedAt = at;
    offer.revision++;
  } else if (cmd.kind === "black-market") {
    dm();
    if (w.blackMarketActive !== cmd.before)
      throw Error("Black-market availability changed. Refresh before toggling.");
    w.blackMarketActive = cmd.active;
    event(`Black market ${cmd.active ? "available" : "hidden"}`);
  } else if (cmd.kind === "shop-black-market") {
    dm();
    const shop = t.shops.find((s) => s.id === cmd.shopId);
    if (!shop) throw Error("Shop no longer exists.");
    if (
      !same(
        { hidden: shop.blackMarket ?? false, premium: shop.blackMarketPremium ?? 1.5 },
        cmd.before,
      )
    )
      throw Error("Vendor configuration changed. Reload before saving.");
    shop.blackMarket = cmd.hidden;
    shop.blackMarketPremium = cmd.premium;
    event("Vendor availability rules updated.");
  } else if (cmd.kind === "session-time") {
    dm();
    advanceSessionTime(t, cmd, at);
  }
}
