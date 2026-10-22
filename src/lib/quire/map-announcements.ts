import type { CampaignMap } from "./world-schema.ts";
import type { MapPing } from "./map-signals.ts";
import { sceneTokenPoint } from "./tabletop-geometry.ts";
import { awaitingPlayerView } from "./map-render-status.ts";

/**
 * Screen-reader announcements for the map workspace. Every input is the map as this viewer
 * already receives it (the server's player projection for players), so an announcement can name
 * only tokens, labels and scenes the viewer can already see.
 */

/** Pings differ by shape as well as colour. */
export const pingShapes = {
  red: "circle",
  amber: "square",
  green: "triangle",
  blue: "diamond",
  violet: "star",
} as const;
export type PingColor = keyof typeof pingShapes;

export type MapSnapshot = {
  mapId: string;
  tokens: { id: string; label: string; column: number; row: number }[];
  activeMapId: string | null;
  activeMapName?: string;
  awaiting: boolean;
};

export function mapSnapshot(
  map: CampaignMap,
  active: { id: string | null; name?: string },
): MapSnapshot {
  return {
    mapId: map.id,
    tokens: (map.tokens ?? []).map((t) => ({
      id: t.id,
      label: t.label,
      column: t.column,
      row: t.row,
    })),
    activeMapId: active.id,
    activeMapName: active.name,
    awaiting: awaitingPlayerView(map),
  };
}

const MOVE_LIMIT = 3;
export function mapAnnouncements(previous: MapSnapshot | undefined, next: MapSnapshot) {
  if (!previous) return [];
  const messages: string[] = [];
  if (next.activeMapId && next.activeMapId !== previous.activeMapId && next.activeMapName)
    messages.push(`The DM activated ${next.activeMapName} for players.`);
  if (previous.mapId === next.mapId) {
    const before = new Map(previous.tokens.map((t) => [t.id, t]));
    const moved = next.tokens.filter((t) => {
      const old = before.get(t.id);
      return old && (old.column !== t.column || old.row !== t.row);
    });
    for (const token of moved.slice(0, MOVE_LIMIT))
      messages.push(`${token.label} moved to column ${token.column + 1}, row ${token.row + 1}.`);
    if (moved.length > MOVE_LIMIT) messages.push(`${moved.length - MOVE_LIMIT} more tokens moved.`);
    if (next.awaiting && !previous.awaiting)
      messages.push("Waiting for the DM's device to update the map…");
    else if (!next.awaiting && previous.awaiting) messages.push("The map view updated.");
  } else if (next.awaiting) messages.push("Waiting for the DM's device to update the map…");
  return messages;
}

/** Labels a viewer can see on this map, with their positions, for "near …" in ping messages. */
export function visibleLabels(map: CampaignMap) {
  const labels: { label: string; x: number; y: number }[] = [];
  for (const marker of map.markers) if (marker.label.trim()) labels.push(marker);
  if (map.grid)
    for (const token of map.tokens ?? [])
      if (token.label.trim())
        labels.push({ label: token.label, ...sceneTokenPoint(map.grid, token) });
  return labels;
}

const DIRECTIONS = [
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
  "north",
  "north-east",
];
export function pingAnnouncement(
  ping: Pick<MapPing, "x" | "y" | "color">,
  labels: { label: string; x: number; y: number }[],
) {
  const name = `${ping.color[0].toUpperCase()}${ping.color.slice(1)} ${pingShapes[ping.color]} ping`;
  let nearest: (typeof labels)[number] | undefined,
    best = Infinity;
  for (const label of labels) {
    const d = Math.hypot(label.x - ping.x, label.y - ping.y);
    if (d < best) {
      best = d;
      nearest = label;
    }
  }
  if (!nearest) return `${name} on the map.`;
  if (best < 0.03) return `${name} at ${nearest.label}.`;
  // Screen coordinates: y grows downwards.
  const angle = Math.atan2(ping.y - nearest.y, ping.x - nearest.x),
    direction = DIRECTIONS[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
  return `${name} ${direction} of ${nearest.label}.`;
}
