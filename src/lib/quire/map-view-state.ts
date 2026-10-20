/** Personal presentation only. Never part of campaign commands or player projection. */
export type MapCamera = { x: number; y: number; zoom: number; basis?: number };
export type MapViewState = { lastMapId?: string; cameras: Record<string, MapCamera> };
export type ViewStore = Pick<Storage, "getItem" | "setItem">;
const memory = new Map<string, MapViewState>();
const failedWrites = new Set<string>();
export function mapViewKey(
  scope: {
    campaignId: string;
    databaseName: string;
    accountId: string;
    code: string;
    seatId: string;
    sessionId: string;
    ephemeral: boolean;
  },
  role: string,
  purses: string[],
) {
  return (
    "lootsplit.map-view.v1:" +
    JSON.stringify([
      scope.accountId,
      scope.campaignId,
      scope.databaseName,
      scope.code,
      role,
      [...purses].sort(),
      ...(scope.ephemeral ? [scope.seatId, scope.sessionId] : []),
    ])
  );
}
export function validMapCamera(value: unknown): value is MapCamera {
  if (!value || typeof value !== "object") return false;
  const c = value as MapCamera;
  return (
    [c.x, c.y, c.zoom].every(Number.isFinite) &&
    Math.abs(c.x) <= 5 &&
    Math.abs(c.y) <= 5 &&
    c.zoom >= 0.5 &&
    c.zoom <= 8 &&
    (c.basis === undefined || (Number.isFinite(c.basis) && c.basis >= 1 && c.basis <= 100000))
  );
}
export function readMapView(key: string, storage?: ViewStore): MapViewState {
  try {
    const value =
      storage && !failedWrites.has(key)
        ? JSON.parse(storage.getItem(key) || "null")
        : memory.get(key);
    if (!value || typeof value !== "object") return { cameras: {} };
    return {
      lastMapId: typeof value.lastMapId === "string" ? value.lastMapId.slice(0, 150) : undefined,
      cameras: Object.fromEntries(
        Object.entries(value.cameras || {})
          .filter(([id, camera]) => id.length <= 150 && validMapCamera(camera))
          .slice(-200),
      ) as Record<string, MapCamera>,
    };
  } catch {
    return memory.get(key) || { cameras: {} };
  }
}
export function saveMapView(key: string, mapId: string, camera?: MapCamera, storage?: ViewStore) {
  const prior = readMapView(key, storage);
  const next = { lastMapId: mapId, cameras: { ...prior.cameras } };
  if (camera && validMapCamera(camera)) {
    delete next.cameras[mapId];
    next.cameras[mapId] = camera;
  }
  next.cameras = Object.fromEntries(Object.entries(next.cameras).slice(-200));
  memory.set(key, next);
  try {
    storage?.setItem(key, JSON.stringify(next));
    failedWrites.delete(key);
  } catch {
    failedWrites.add(key);
    /* View remains usable without storage. */
  }
}
export function accessibleMapId(
  ids: string[],
  requested?: string,
  remembered?: string,
  active?: string,
) {
  return [requested, remembered, active].find((id) => id && ids.includes(id));
}

export function mapViewStorage(ephemeral: boolean): ViewStore | undefined {
  if (ephemeral) return undefined;
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
