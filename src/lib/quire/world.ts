import {
  readWorld,
  type WorldCommand,
  type Npc,
  type CampaignMap,
  type Trade,
} from "./world-schema.ts";
import type { CloudTable, CloudSeat } from "./cloud.ts";
import type { Holding } from "./types.ts";
import { validateConnectedMaps } from "./connected-maps.ts";
import { canonicalJson } from "./canonical-json.ts";
import { locationPath, readMarketLocations } from "./shop-locations.ts";
import { assertCarried, assertEstateDisposable } from "./estate.ts";
import { transferPropertyDeed } from "./property-deed.ts";
import { fromCopper, toCopper } from "./money.ts";
import { advanceSessionTime } from "./session-time.ts";
import { applyCharacterPosition } from "./character-position.ts";
import { readFleet } from "./ships-schema.ts";
import { legacyServiceKinds, serviceKinds } from "./services-schema.ts";
import { applyMoveRequestCommand, MOVE_REQUEST_KINDS, type MoveRequestCommand } from "./move-requests.ts";
import { applyZoneCommand, ZONE_COMMAND_KINDS, type ZoneCommand } from "./zone-commands.ts";
import { applyTabletopCommand, applyTokenFollow, keepMovement, validateTabletop, readTabletopSession, type TabletopExecution } from "./tabletop.ts";
import { tabletopCommands, type TabletopCommand } from "./tabletop-schema.ts";
import { tokenInsideGrid } from "./tabletop-geometry.ts";
import { fogSnapshotMap, legacyDiagonals, legacyTabletopMap, legacyTabletopToken, previousTabletopMap, withoutMapScale, withoutPlacementStyles } from "./tabletop-protocol.ts";
import { compactTabletopHistory } from "./fog-history.ts";
import { actingGroups, groupPlace, groupRefs, MAIN_GROUP, resolveGroup } from "./party-groups.ts";
import { applyGroupMapPosition } from "./party-groups-command.ts";
import { validatePartyGroups } from "./party-groups-validation.ts";

/**
 * The NPC is "here" for one of `groups` (split the party: the acting character's group, or a
 * seat's groups): a companion travelling in that group, or an NPC at or inside that group's
 * place. Without groups: any group, which is the party when it is whole.
 */
export function npcAvailableHere(
  npc: Npc,
  table: Pick<CloudTable, "journal">,
  groups: string[] = groupRefs(table),
) {
  const market = readMarketLocations(table.journal?.market);
  const s = table.journal?.world?.characterPositions?.find((s) => s.purseId === npc.id);
  if (!npc.visible || !(s?.visible ?? true)) return false;
  if (s?.inParty) return groups.includes(resolveGroup(table, s.groupId));
  return groups.some((g) => {
    const here = groupPlace(table, g).locationId;
    return !!here && locationPath(market, here).some((l) => l.id === (s ? s.locationId : npc.locationId));
  });
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
  validateTabletop(t, projected);
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
  validateConnectedMaps(t, projected);
  const combat=w.combat;
  if (combat) {
    const scene=w.maps.find(m=>m.id===combat.mapId);
    if (!scene || !w.maps.some(m=>m.id===combat.returnMapId)) throw Error("Return from the encounter map before removing its scene or return map.");
    if (combat.mode === "grid" && (!combat.scaleConfirmed || !scene.grid || (canonicalJson(scene.grid)!==combat.gridFingerprint && canonicalJson(legacyDiagonals(scene.grid))!==combat.gridFingerprint))) throw Error("Combat grid changed. Return to exploration and review the calibrated scale before starting again.");
    if (combat.showPlayers && !scene.visible) throw Error("Return from the shared encounter map before making it private.");
  }
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
    if (
      !projected &&
      map.propertyId &&
      !t.holdings.some((h) => h.id === map.propertyId && h.kind === "property")
    )
      throw Error("The map's linked property is missing.");
    unique(
      (map.tokens ?? []).map((token) => token.id),
      "combat token",
    );
    unique(
      (map.tokens ?? [])
        .filter((token) => token.entityId)
        .map((token) => `${token.kind}:${token.entityId}`),
      "combat entity",
    );
    for (const token of map.tokens ?? []) {
      if (!map.grid || !tokenInsideGrid(map.grid, token))
        throw Error("Combat tokens must fit inside the configured grid.");
      if (
        !projected &&
        token.kind === "character" &&
        !t.purses.some((p) => p.id === token.entityId && p.kind === "character")
      )
        throw Error("A combat token's character is missing.");
      if (
        !projected &&
        token.kind === "ship" &&
        !t.journal?.fleet?.vessels.some((s) => s.propertyId === token.entityId)
      )
        throw Error("A combat token's ship is missing.");
    }
  }
  if (
    w.partyPosition &&
    ((!projected &&
      (!w.partyPosition.mapId || !w.maps.some((m) => m.id === w.partyPosition!.mapId))) ||
      market.currentLocationId)
  )
    throw Error("Free party placement requires an existing map and no linked party location.");
  validatePartyGroups(t, projected);
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
/** Rechecks both sides of a barter: participants, NPC presence, exact lots, custody and deeds. */
export function barterEligible(t: CloudTable, trade: Pick<Trade, "left" | "right">) {
  eligible(t, trade);
}
function eligible(t: CloudTable, trade: Pick<Trade, "left" | "right">) {
  const w = readWorld(t.journal?.world);
  for (const side of [trade.left, trade.right]) {
    if (!t.purses.some((p) => p.id === side.purseId))
      throw Error("Trade account no longer exists.");
    const npc = w.npcs.find((n) => n.id === side.purseId);
    // Split the party: the NPC must be where the other participant's group is.
    const other = side === trade.left ? trade.right : trade.left;
    if (npc && (!npc.barterAllowed || !npcAvailableHere(npc, t, actingGroups(t, other.purseId))))
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
      for (const v of t.journal?.fleet?.vessels ?? [])
        if (v.propertyId === h.id) v.propertyId = nextId;
      for (const y of t.journal?.fleet?.facilities ?? [])
        if (y.propertyId === h.id) y.propertyId = nextId;
    }
  }
  t.holdings = t.holdings.filter((h) => h.quantity > 0);
}
/**
 * One atomic barter exchange: rechecks both sides, moves the net coins and the
 * exact lots, and writes one ledger line per participant keyed by `receipt`.
 */
export function settleExchange(
  t: CloudTable,
  leftSide: Trade["left"],
  rightSide: Trade["right"],
  receipt: string,
  at: number,
) {
  eligible(t, { left: leftSide, right: rightSide });
  const left = t.purses.find((p) => p.id === leftSide.purseId)!,
    right = t.purses.find((p) => p.id === rightSide.purseId)!;
  if (toCopper(left.coins) < leftSide.copper || toCopper(right.coins) < rightSide.copper)
    throw Error("A participant cannot afford their offered coins. Review a counteroffer.");
  const delta = rightSide.copper - leftSide.copper;
  for (const [p, change] of [
    [left, delta],
    [right, -delta],
  ] as const) {
    const balance = toCopper(p.coins) + change;
    if (!Number.isSafeInteger(balance) || balance > 1e12)
      throw Error("The resulting coin balance is too large.");
    p.coins = fromCopper(balance);
    t.ledger.push({
      id: receipt + "-" + p.id,
      at,
      purseId: p.id,
      shopId: null,
      summary: `Barter completed with ${p.id === left.id ? right.name : left.name}`,
      copper: change,
      transactionType: "transfer",
    });
  }
  moveItems(t, leftSide, right.id, receipt + "-left", at);
  moveItems(t, rightSide, left.id, receipt + "-right", at);
}
export function applyWorldCommand(t: CloudTable, seat: CloudSeat, cmd: WorldCommand, at: number, execution: TabletopExecution = {}) {
  const journal = t.journal!,
    w = (journal.world = readWorld(journal.world));
  if (tabletopCommands.some(schema => schema.shape.kind.value === cmd.kind)) {
    applyTabletopCommand(t, seat, cmd as TabletopCommand, at, execution);
    return;
  }
  if (cmd.kind === "map-token-follow") {
    applyTokenFollow(t, seat, cmd, at);
    return;
  }
  if (MOVE_REQUEST_KINDS.has(cmd.kind)) {
    applyMoveRequestCommand(t, seat, cmd as MoveRequestCommand, at, execution);
    return;
  }
  if (ZONE_COMMAND_KINDS.has(cmd.kind)) {
    applyZoneCommand(t, seat, cmd as ZoneCommand, at, execution);
    return;
  }
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
  if (cmd.kind === "map-combat-transition") {
    dm();
    if (!same(w.combat ?? null,cmd.before) || !same(w.tabletop ?? null,cmd.beforeSession)) throw Error("The encounter map or active scene changed. Refresh and review the transition.");
    const binding=cmd.binding, session=readTabletopSession(t);
    if (binding && w.combat && binding.id !== w.combat.id) throw Error("Finish or return from the current encounter map before starting another transition.");
    if (binding && w.combat && (binding.encounterId!==w.combat.encounterId || binding.mapId!==w.combat.mapId || binding.returnMapId!==w.combat.returnMapId || (w.combat.phase==='active'&&binding.phase!=='active'))) throw Error("A prepared encounter transition cannot change its identity or destination.");
    if (binding) {
      w.combat=binding;
      if (binding.phase==='active') { const scene=w.maps.find(m=>m.id===binding.mapId); if(scene)scene.encounterId=binding.encounterId; }
      if (binding.phase==='active' && binding.showPlayers) w.tabletop={...session,activeMapId:binding.mapId,activationId:binding.id,camera:null,presentation:{id:binding.id,mapId:binding.mapId,mode:binding.mode}};
    } else {
      if (w.combat && session.presentation?.id===w.combat.id && session.activeMapId===w.combat.mapId) {
        const destination=w.maps.find(m=>m.id===w.combat!.returnMapId&&m.visible);
        w.tabletop={...session,activeMapId:destination?.id??null,activationId:cmd.id,camera:null,presentation:null};
      }
      delete w.combat;
    }
    event(binding?.phase==='active'?"Encounter map opened":binding?"Encounter map transition prepared":"Returned from encounter map");
  } else if (cmd.kind === "party-map-position" && cmd.groupId && cmd.groupId !== MAIN_GROUP) {
    dm();
    applyGroupMapPosition(t, { ...cmd, groupId: cmd.groupId }, (summary, _purseId, dmOnly) =>
      journal.events.push({ id: cmd.id + "-event", at, summary: summary.slice(0, 500), kind: "management", ...(dmOnly ? { dmOnly: true } : {}) }),
    );
  } else if (cmd.kind === "party-map-position") {
    dm();
    const market = readMarketLocations(journal.market);
    if (
      !same(w.partyPosition ?? null, cmd.before) ||
      market.currentLocationId !== cmd.beforeLocationId
    )
      throw Error("The party moved. Refresh before placing it.");
    if (journal.finance?.downtime.some((d) => d.status === "pending"))
      throw Error("Approve or cancel pending downtime before moving the party.");
    // The party marker follows a journey under way; stop it before moving the party freely.
    if (w.journeys?.some((j) => (j.status === "active" || j.status === "arrived") && !j.groupId))
      throw Error("The party is on a journey. Stop it on the road before moving the party freely.");
    if (cmd.position) {
      w.partyPosition = cmd.position;
      journal.market = readMarketLocations({ ...market, currentLocationId: null });
    } else delete w.partyPosition;
    event(cmd.position ? "Party travel position updated" : "Free party position cleared");
  } else if (cmd.kind === "map-token") {
    dm();
    const map = w.maps.find((m) => m.id === cmd.mapId);
    if (!map || !same(map.grid, cmd.grid))
      throw Error("The combat grid changed. Reload before moving tokens.");
    const current = map.tokens?.find((token) => token.id === cmd.tokenId) ?? null;
    const legacy = current && cmd.before && !same(current, cmd.before) && same(legacyTabletopToken(current), cmd.before);
    if (!same(current, cmd.before) && !legacy)
      throw Error("This combat token moved or changed. Reload before saving.");
    if (cmd.token && cmd.token.id !== cmd.tokenId) throw Error("Token identity cannot change.");
    if (legacy && cmd.token) {
      if (current.kind !== cmd.token.kind || current.entityId !== cmd.token.entityId) throw Error("Open the updated website before changing this token's identity; existing tabletop permissions are retained.");
      cmd.token = { ...current, ...cmd.token };
    }
    if (
      current?.kind === "ship" &&
      cmd.token?.kind === "ship" &&
      current.entityId === cmd.token.entityId
    ) {
      const aboard = new Set(
        readFleet(journal.fleet)
          .aboard.filter((a) => a.propertyId === current.entityId)
          .map((a) => a.purseId),
      );
      for (const crew of map.tokens ?? [])
        if (crew.kind === "character" && aboard.has(crew.entityId!)) {
          crew.column += cmd.token.column - current.column;
          crew.row += cmd.token.row - current.row;
          if (!tokenInsideGrid(cmd.grid, crew))
            throw Error("Moving this ship would place an aboard character outside the grid.");
        }
    }
    map.tokens = [
      ...(map.tokens ?? []).filter((token) => token.id !== cmd.tokenId),
      ...(cmd.token ? [cmd.token] : []),
    ];
    if (map.tabletop && map.tabletop.vision !== "off") map.tabletop.revision++;
    event("Combat map tokens updated");
  } else if (cmd.kind === "map-tokens-place") {
    dm();
    if (!cmd.place.length && !cmd.remove?.length) throw Error("Choose tokens to place.");
    const map = w.maps.find((m) => m.id === cmd.mapId);
    if (!map || !same(map.grid, cmd.grid)) throw Error("The combat grid changed. Reload before placing tokens.");
    if (new Set(cmd.place.map((p) => p.tokenId)).size !== cmd.place.length)
      throw Error("Place each token only once.");
    // Removals first (Send to map / Move party to), so a token can change maps in one action.
    for (const r of cmd.remove ?? []) {
      const from = w.maps.find((m) => m.id === r.mapId);
      if (!from || !same(from.grid, r.grid)) throw Error("A map's combat grid changed. Reload before moving tokens.");
      const current = from.tokens?.find((t) => t.id === r.tokenId);
      if (!current || !same(current, r.before))
        throw Error("A token moved or changed. Refresh before placing.");
      from.tokens = from.tokens!.filter((t) => t.id !== r.tokenId);
      if (from.tabletop && from.tabletop.vision !== "off") from.tabletop.revision++;
    }
    const next = [...(map.tokens ?? [])];
    for (const p of cmd.place) {
      if (p.token.id !== p.tokenId) throw Error("Token identity cannot change.");
      const index = next.findIndex((t) => t.id === p.tokenId);
      const current = index >= 0 ? next[index] : null;
      if (!same(current, p.before)) throw Error("A token moved or changed. Refresh before placing.");
      if (current && (current.kind !== p.token.kind || current.entityId !== p.token.entityId))
        throw Error("Token identity cannot change.");
      if (index >= 0) next[index] = p.token;
      else next.push(p.token);
    }
    map.tokens = next;
    if (map.tabletop && map.tabletop.vision !== "off") map.tabletop.revision++;
    event(`${cmd.place.length} ${cmd.place.length === 1 ? "token" : "tokens"} placed on ${map.name}`);
  } else if (cmd.kind === "map-tokens-edit") {
    dm();
    const map = w.maps.find((m) => m.id === cmd.mapId);
    if (!map) throw Error("This map is unavailable.");
    if (new Set(cmd.edits.map((e) => e.tokenId)).size !== cmd.edits.length)
      throw Error("Choose each token only once.");
    const next = [...(map.tokens ?? [])];
    for (const e of cmd.edits) {
      const index = next.findIndex((t) => t.id === e.tokenId);
      if (index < 0 || !same(next[index], e.before))
        throw Error("A token moved or changed. Refresh before changing it.");
      if (e.token.id !== e.tokenId || e.token.kind !== e.before.kind || e.token.entityId !== e.before.entityId)
        throw Error("Token identity cannot change.");
      next[index] = e.token;
    }
    map.tokens = next;
    if (map.tabletop && map.tabletop.vision !== "off") map.tabletop.revision++;
    event(`${cmd.edits.length} ${cmd.edits.length === 1 ? "token" : "tokens"} changed on ${map.name}`);
  } else if (cmd.kind === "map-save") {
    dm();
    const current = w.maps.find((m) => m.id === cmd.mapId) ?? null;
    // Older apps (tabletop protocol 4 or earlier) never see placement pin styles, and protocol 5
    // or earlier never sees a map scale bar.
    const unscaled = current && withoutMapScale(current);
    const plain = unscaled && withoutPlacementStyles(unscaled);
    // Older apps (tabletop protocol 2 or earlier) saw full-snapshot fog history.
    // They also see an alternating diagonal grid as "equal" (legacyDiagonals).
    const expanded = plain && legacyDiagonals(fogSnapshotMap(plain));
    const legacy = current && cmd.before && !same(current, cmd.before) && (same(unscaled, cmd.before) || same(plain, cmd.before) || same(expanded, cmd.before) || same(legacyDiagonals(legacyTabletopMap(plain!)), cmd.before) || same(previousTabletopMap(expanded!), cmd.before));
    // An older app saving the map keeps the pin styles it cannot display.
    if (legacy && cmd.map?.connected && current?.connected)
      cmd.map.connected.placements = cmd.map.connected.placements.map((p) => {
        const old = current.connected!.placements.find((o) => o.id === p.id);
        return old?.style && p.style === undefined ? { ...p, style: old.style } : p;
      });
    // An older app saving the map keeps the scale bar it cannot display.
    if (legacy && cmd.map && current?.scale && cmd.map.scale === undefined && cmd.before?.scale === undefined)
      cmd.map = { ...cmd.map, scale: current.scale };
    // An older app saving the map unchanged keeps the alternating rule it cannot display.
    if (legacy && cmd.map?.grid && current?.grid?.diagonal === "alternating" && cmd.before?.grid?.diagonal === "equal" && cmd.map.grid.diagonal === "equal")
      cmd.map.grid = { ...cmd.map.grid, diagonal: "alternating" };
    if (!same(current, cmd.before) && !legacy)
      throw Error("This map changed. Reload before saving; your draft is retained.");
    if (cmd.map && cmd.map.id !== cmd.mapId) throw Error("Map identity cannot change.");
    if (!cmd.map && w.partyPosition?.mapId === cmd.mapId)
      throw Error("Move or clear the free party position before removing this map.");
    if (!cmd.map && w.groups?.some((g) => g.status === "active" && g.position?.mapId === cmd.mapId))
      throw Error("Move or clear the group's free position before removing this map.");
    if (
      !cmd.map &&
      readFleet(journal.fleet).voyages.some(
        (v) =>
          v.mapRoute?.mapId === cmd.mapId && ["proposed", "active", "blocked"].includes(v.status),
      )
    )
      throw Error("Resolve this map's ongoing ship routes before removing it.");
    if (
      !cmd.map &&
      w.journeys?.some(
        (j) => j.mapId === cmd.mapId && ["planned", "active", "arrived"].includes(j.status),
      )
    )
      throw Error("Finish or stop the journey on this map before removing it.");
    if (cmd.map?.connected) delete cmd.map.connected.placedRecords;
    if (cmd.map && current?.connected && cmd.map.connected === undefined) cmd.map.connected = current.connected;
    if (cmd.map && current?.tabletop) {
      cmd.map.tabletop = {
        ...(cmd.map.tabletop
          ? compactTabletopHistory(cmd.map.tabletop, cmd.before?.tabletop?.fog ?? current.tabletop.fog)
          : current.tabletop),
        revision: current.tabletop.revision + 1,
      };
      if (legacy && cmd.map.tokens) cmd.map.tokens = cmd.map.tokens.map(token => {
        const old = current.tokens?.find(t => t.id === token.id);
        if (!old) return token;
        if (old.kind !== token.kind || old.entityId !== token.entityId) throw Error("Open the updated website before changing a configured token's identity.");
        return { ...old, ...token };
      });
    }
    if (w.tabletop && (!cmd.map || !cmd.map.visible)) {
      if (w.tabletop.activeMapId === cmd.mapId) w.tabletop.activeMapId = null;
      if (w.tabletop.camera?.mapId === cmd.mapId) w.tabletop.camera = null;
    }
    // Player movement (protocol 15): a save without the movement choice keeps the stored one.
    if (cmd.map) keepMovement(cmd.map, current?.tabletop);
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
    // Clients before tabletop protocol 8 never see an NPC's service list (tabletop-protocol.ts):
    // compare without it and keep the stored list when both sides omit it.
    const legacy = cmd.before.services === undefined && cmd.npc.services === undefined;
    // Protocol 8 clients see the list without wave-2 kinds (tabletop protocol 9): compare
    // against that list and keep the stored wave-2 kinds they can't show.
    const wave2 = (current?.services ?? []).filter((k) => !legacyServiceKinds.includes(k as never));
    const wave1Client =
      !legacy &&
      wave2.length > 0 &&
      !!cmd.before.services &&
      !cmd.before.services.some((k) => wave2.includes(k)) &&
      !(cmd.npc.services ?? []).some((k) => wave2.includes(k));
    const compared =
      legacy && current
        ? { ...current, services: undefined }
        : wave1Client && current
          ? { ...current, services: current.services!.filter((k) => !wave2.includes(k)) }
          : current;
    if (!same(compared, cmd.before) || cmd.before.id !== cmd.npc.id)
      throw Error("NPC configuration changed. Reload before saving.");
    Object.assign(
      current!,
      cmd.npc,
      legacy && current?.services
        ? { services: current.services }
        : wave1Client
          ? { services: serviceKinds.filter((k) => (cmd.npc.services ?? []).includes(k) || wave2.includes(k)) }
          : {},
    );
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
        delete position.groupId;
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
    if (!npcAvailableHere(npc, t, actingGroups(t, cmd.purseId)))
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
    if (cmd.decision === "accepted") settleExchange(t, offer.left, offer.right, cmd.id, at);
    offer.status = cmd.decision;
    offer.decidedAt = at;
    offer.revision++;
  } else if (cmd.kind === "black-market") {
    dm();
    if (w.blackMarketActive !== cmd.before)
      throw Error("Black-market availability changed. Refresh before toggling.");
    w.blackMarketActive = cmd.active;
    event(`Black market ${cmd.active ? "available" : "hidden"}`);
  } else if (cmd.kind === "companion-funds-visibility") {
    dm();
    if ((w.companionFundsVisible ?? false) !== cmd.before)
      throw Error("Companion funds visibility changed. Refresh before toggling.");
    if (cmd.visible) w.companionFundsVisible = true;
    else delete w.companionFundsVisible;
    event(`Party companion NPC funds ${cmd.visible ? "shown to the party" : "kept private"}`);
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
