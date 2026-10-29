import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { canonicalJson } from "./canonical-json";
import type { CloudTable } from "./cloud";
import type { CommandRequest } from "./commands";
import { useEconomy } from "./economy-context";
import type { EconomyMutationOutcome } from "./mutation-outcome";
import { followMe } from "./follow-pref";
import { groupPlace, MAIN_GROUP, purseGroup, resolveGroup } from "./party-groups";
import type { CloudSeat } from "./cloud";
import { occupiedSquares, sceneTokenPoint, snapTokenPosition, tokenFootprint } from "./tabletop-geometry";
import { combatOnMap, mapPointVisibleTo, movementMode, readMapTabletop, readTabletopSession } from "./tabletop";
import type { CampaignMap, MapToken } from "./world-schema";
import { crossing, zoneName, zoneOf } from "./zones";

type Seat = Pick<CloudSeat, "role" | "purseIds">;
/** Debounce: the token follows 1.5 s after the view settles, so quick browsing sends nothing. */
export const FOLLOW_DELAY_MS = 1500;

/** Where the token arrives (plan section 6): the entrance back, the party marker, the start view, the middle. */
function arrival(table: Pick<CloudTable, "journal" | "purses">, from: CampaignMap | undefined, to: CampaignMap, purseId: string) {
  const back = from && to.connected?.links.find((l) => l.targetMapId === from.id);
  if (back) return { x: back.x, y: back.y };
  const position = groupPlace(table, resolveGroup(table, purseGroup(table, purseId) ?? MAIN_GROUP)).position;
  if (position?.mapId === to.id && position.x !== undefined && position.y !== undefined) return { x: position.x, y: position.y };
  const start = readMapTabletop(to).initialView;
  return start ? { x: start.x, y: start.y } : { x: 0.5, y: 0.5 };
}

/** The first free square the seat can see, nearest the arrival point (rings outward). */
export function followSquare(table: Pick<CloudTable, "journal" | "purses">, to: CampaignMap, seat: Seat, point: { x: number; y: number }, token?: MapToken) {
  if (!to.grid) return undefined;
  const at = snapTokenPosition(to.grid, {}, point) ?? { column: 0, row: 0 };
  const taken = occupiedSquares(to.tokens ?? []);
  const n = Math.max(1, Math.ceil(token ? tokenFootprint(token) : 1));
  const visible = mapPointVisibleTo(table, to, seat);
  for (let radius = 0; radius < Math.max(to.grid.columns, to.grid.rows); radius++)
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const column = at.column + dx,
          row = at.row + dy;
        if (column < 0 || row < 0 || column + n > to.grid.columns || row + n > to.grid.rows) continue;
        let free = true;
        for (let c = column; c < column + n && free; c++) for (let r = row; r < row + n && free; r++) if (taken.has(`${c},${r}`)) free = false;
        if (!free) continue;
        const place = { ...(token ?? {}), column, row };
        delete (place as Partial<MapToken>).offsetX;
        delete (place as Partial<MapToken>).offsetY;
        if (!visible(sceneTokenPoint(to.grid, place as MapToken))) continue;
        return { column, row };
      }
}

/**
 * Token follows the player's map view (map tokens PR 7; owner, 2026-10-29). When the DM turned
 * it on and the player's "Follow me" is on, opening another map moves the player's character
 * token there (1.5 s after the view settles), in the same zone only, never during combat. A toast
 * says what happened, with Undo; when it can't follow, the toast says why ("Viewing only — …").
 * A pending or refused follow never blocks the map switch.
 */
export function useTokenFollow({
  map,
  maps,
  table,
  seat,
  scope,
  viewOnly,
  proposeJourney,
}: {
  /** "Propose a journey" on the far-zone toast: opens the player's journey proposal. */
  proposeJourney?: () => void;
  map: CampaignMap;
  maps: CampaignMap[];
  table: Pick<CloudTable, "journal" | "purses">;
  seat: Seat;
  scope: string;
  viewOnly: boolean;
}) {
  const { commandOutcome } = useEconomy();
  const latest = useRef({ maps, table, seat, scope, viewOnly, commandOutcome, proposeJourney });
  latest.current = { maps, table, seat, scope, viewOnly, commandOutcome, proposeJourney };
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    const before = previous.current;
    previous.current = map.id;
    if (!before || before === map.id) return;
    const timer = setTimeout(() => void followNow(map.id, latest.current, () => latest.current.maps), FOLLOW_DELAY_MS);
    return () => clearTimeout(timer);
    // Once per map switch; everything else is read when the timer fires.
  }, [map.id]);
}

async function send(
  commandOutcome: (input: CommandRequest) => Promise<EconomyMutationOutcome>,
  input: CommandRequest,
) {
  const outcome = await commandOutcome(input);
  if (outcome.status !== "committed") throw Error("Your token will move when your pending actions are submitted.");
}

/** Builds and sends the follow for each of the seat's characters (read from the latest state). */
async function followNow(
  toId: string,
  { maps, table, seat, scope, viewOnly, commandOutcome, proposeJourney }: {
    proposeJourney?: () => void;
    maps: CampaignMap[];
    table: Pick<CloudTable, "journal" | "purses">;
    seat: Seat;
    scope: string;
    viewOnly: boolean;
    commandOutcome: (input: CommandRequest) => Promise<EconomyMutationOutcome>;
  },
  currentMaps: () => CampaignMap[],
) {
  if (seat.role !== "player" || viewOnly || !readTabletopSession(table).followView || !followMe(scope)) return;
  const to = maps.find((m) => m.id === toId);
  if (!to?.grid || !to.visible) return;
  for (const purseId of seat.purseIds) {
    const person = table.purses.find((p) => p.id === purseId && p.kind === "character");
    if (!person) continue;
    const from = maps.find((m) => m.id !== to.id && (m.tokens ?? []).some((t) => t.kind === "character" && t.entityId === purseId));
    const beforeFrom = from?.tokens?.find((t) => t.kind === "character" && t.entityId === purseId) ?? null;
    const beforeTo = to.tokens?.find((t) => t.kind === "character" && t.entityId === purseId) ?? null;
    if (!from) continue; // Nothing to bring along (Place my token puts a first token on a map).
    const combat = combatOnMap(table, from.id) ?? combatOnMap(table, to.id);
    if (combat) {
      toast.info(`In combat: your token stays on ${from.name}`);
      continue;
    }
    if ([from, to].some((m) => movementMode(m) !== "auto" || m.tabletop?.lockedPurseIds?.includes(purseId)) || beforeFrom?.locked) continue;
    // Zones (PR 7A): same zone, joining another group, an adjacent zone under the split rule,
    // or a journey.
    const move = crossing(table, purseId, person.name, to.id, from.id);
    const here = zoneName(table, zoneOf(table, from.id));
    if (move.kind === "refused") {
      toast.info(move.message, { description: "Your token stays where it is; you're just looking." });
      continue;
    }
    if (move.kind === "far") {
      toast.info(`This trip takes about ${move.days} ${move.days === 1 ? "day" : "days"}. Ask your DM to plan the journey.`, {
        description: `${to.name} isn't next to ${zoneName(table, move.from)} (about ${move.miles} miles at ${move.pace} mi/day). Your token stays in ${zoneName(table, move.from)}; you're just looking.`,
        duration: 12000,
        ...(proposeJourney ? { action: { label: "Propose a journey", onClick: proposeJourney } } : {}),
        cancel: { label: "OK", onClick: () => undefined },
      });
      continue;
    }
    if (move.kind === "split" && !move.rule.allow && move.rule.rule === "block") {
      toast.info("The DM is keeping the party together here.", { description: `Ask your DM if ${person.name} should split off to ${to.name}.` });
      continue;
    }
    const square = beforeTo ? { column: beforeTo.column, row: beforeTo.row } : followSquare(table, to, seat, arrival(table, from, to, purseId), beforeFrom ?? undefined);
    if (!square) continue;
    if (move.kind === "split" && !move.rule.allow) {
      // Wait until end of session, or a party vote: the request waits; the token stays.
      try {
        await send(commandOutcome, { kind: "zone-request", requestId: crypto.randomUUID(), purseId, fromMapId: from.id, toMapId: to.id, grid: canonicalJson(to.grid), at: square });
      } catch (e) {
        toast.info(e instanceof Error ? e.message : "Your token stays where it is.");
      }
      continue;
    }
    const input = {
      kind: "map-token-follow" as const,
      mapId: to.id,
      grid: canonicalJson(to.grid),
      purseId,
      fromMapId: from.id,
      beforeFrom,
      beforeTo,
      tokenId: beforeTo?.id ?? beforeFrom?.id ?? crypto.randomUUID(),
      at: square,
    };
    try {
      await send(commandOutcome, input);
      const zone = zoneName(table, zoneOf(table, to.id));
      if (move.kind === "split") {
        toast.warning(`You left ${here}. You're now separate from the party.`, {
          description: `${person.name} is in ${to.name}. Come back to ${here} to rejoin.`,
          duration: 12000,
          action: undoAction(),
        });
        continue;
      }
      if (move.kind === "join") {
        toast.success(`${person.name} is back with the party`, { description: `Your token moved to ${to.name} (${zone}).` });
        continue;
      }
      toast.success(`Your token moved to ${to.name}`, {
        description: `Still with the party: same zone (${zone})`,
        duration: 10000,
        action: undoAction(),
      });
      function undoAction() {
        const toMap = to!,
          fromMap = from!;
        return beforeFrom
          ? {
              label: "Undo",
              onClick: () => {
                // The inverse follow, with the same checks; valid until something else changes the token.
                const fresh = currentMaps();
                const now = { to: fresh.find((m) => m.id === toMap.id) ?? toMap, from: fresh.find((m) => m.id === fromMap.id) ?? fromMap };
                const moved = now.to.tokens?.find((t) => t.kind === "character" && t.entityId === purseId) ?? null;
                void send(commandOutcome, {
                  kind: "map-token-follow",
                  mapId: fromMap.id,
                  grid: canonicalJson(now.from.grid ?? fromMap.grid),
                  purseId,
                  fromMapId: toMap.id,
                  beforeFrom: moved,
                  beforeTo: null,
                  tokenId: moved?.id ?? beforeFrom.id,
                  at: { column: beforeFrom.column, row: beforeFrom.row, ...(beforeFrom.offsetX !== undefined ? { offsetX: beforeFrom.offsetX } : {}), ...(beforeFrom.offsetY !== undefined ? { offsetY: beforeFrom.offsetY } : {}) },
                }).catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Your token couldn't go back. Move it yourself."));
              },
            }
          : undefined;
      }
    } catch (e) {
      toast.info(e instanceof Error ? e.message : "Your token stays where it is.");
    }
  }
}
