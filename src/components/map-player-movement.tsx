import { Clock, Eye, Move, Ruler, Swords } from "lucide-react";
import { actorName, type PlayerMovement } from "@/lib/quire/map-movement";
import type { MapCombatOrder } from "@/lib/quire/map-combat-schema";
import type { CampaignMap } from "@/lib/quire/world-schema";

/**
 * Top-centre turn strip for players (mockup player-token-move frames 2 and 3): the round, whose
 * turn it is, and the revealed order as discs with the active one ringed.
 */
export function MapTurnStrip({
  map,
  movement,
  order,
}: {
  map: CampaignMap;
  movement: PlayerMovement;
  order: MapCombatOrder;
}) {
  const token = (id: string) => map.tokens?.find((t) => t.id === id);
  const acting = movement.acting;
  return (
    <div className="map-turn-strip map-glass" role="status" aria-label="Map combat status">
      <strong className="map-turn-round">Round {order.round}</strong>
      <span className="map-turn-who">
        {acting ? (
          acting.own ? (
            <>
              <b>Your turn:</b> {acting.label}
            </>
          ) : (
            <>
              <b>{capitalize(actorName(acting.label, token(acting.tokenId)))}</b> is acting
            </>
          )
        ) : (
          "Another combatant is acting"
        )}
      </span>
      <ol className="map-turn-order" aria-label="Turn order">
        {order.entries.map((entry) => {
          const t = token(entry.tokenId);
          const letter = entry.label.trim().slice(0, 1) || "?";
          return (
            <li
              key={entry.tokenId}
              className={`${t?.kind === "creature" ? "enemy" : ""}${entry.active ? " active" : ""}`}
              aria-current={entry.active ? "true" : undefined}
              title={entry.label}
            >
              <span aria-hidden="true">
                {t?.sizeClass === "small" || t?.sizeClass === "tiny" ? letter.toLowerCase() : letter.toUpperCase()}
              </span>
              <span className="sr-only">
                {entry.label}
                {entry.own ? " (you)" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
const capitalize = (text: string) => text.slice(0, 1).toUpperCase() + text.slice(1);

/**
 * Movement chips at the bottom-left for players (mockup player-token-move frames 1-3): free
 * movement, turn-based combat with the sheet's speed as a guide, waiting for the next turn, and
 * the fog rule.
 */
export function MovementChips({
  movement,
  speed,
  fog,
  hasToken,
}: {
  movement: PlayerMovement;
  speed?: number;
  fog: boolean;
  hasToken: boolean;
}) {
  if (movement.mode !== "auto") return null;
  return (
    <div className="map-move-chips" role="group" aria-label="Your movement">
      {!movement.combat ? (
        <span className="map-move-chip lead">
          <Move size={15} aria-hidden="true" /> Free movement: no combat
        </span>
      ) : movement.myTurn ? (
        <>
          <span className="map-move-chip lead">
            <Swords size={15} aria-hidden="true" /> Combat: turn-based movement
          </span>
          {speed && hasToken && (
            <span className="map-move-chip">
              <Ruler size={15} aria-hidden="true" /> Speed {speed} ft (from your sheet, shown as a
              guide)
            </span>
          )}
        </>
      ) : (
        <span className="map-move-chip">
          <Clock size={15} aria-hidden="true" />{" "}
          {movement.next
            ? `Waiting: ${movement.next.label} is next after ${movement.next.after}`
            : "Waiting for your turn"}
        </span>
      )}
      {fog && !movement.combat && (
        <span className="map-move-chip">
          <Eye size={15} aria-hidden="true" /> Fog: you can only move into what you can see
        </span>
      )}
    </div>
  );
}

/**
 * "Not your turn." card beside the player's own token while someone else acts (frame 3).
 */
export function NotYourTurnCard({
  left,
  top,
  acting,
  name,
}: {
  left: number;
  top: number;
  acting: string;
  name: string;
}) {
  return (
    <div className="map-not-turn map-glass" role="status" style={{ left, top }}>
      <b>Not your turn.</b> {capitalize(acting)} is acting. You can move {name} on their turn.
      Pings, measuring and your sheet still work.
    </div>
  );
}
