import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getCloudTable,
  getServerCloudTable,
  subscribeCloudTable,
  requestMapSignals,
} from "./cloud-client";
import { mapPingSchema, PING_DURATION, type MapPing, type MapPingInput } from "./map-signals";
export function useMapPings(mapId: string) {
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const scope = `${cloud.code}:${cloud.sessionId}:${cloud.seatId}:${mapId}`;
  const current = useRef(scope);
  current.current = scope;
  const [state, setState] = useState<{ scope: string; pings: MapPing[] }>({ scope, pings: [] });
  const [error, setError] = useState("");
  function receive(result: { serverNow: number; pings: MapPing[] }, expected: string) {
    if (current.current !== expected) return;
    const now = Date.now();
    // Translate server expiration into the reader's clock; never extend a delayed signal.
    const pings = result.pings.flatMap((p) => {
      const parsed = mapPingSchema.safeParse(p);
      return parsed.success && p.mapId === mapId
        ? [
            {
              ...parsed.data,
              expiresAt: now + Math.min(PING_DURATION, p.expiresAt - result.serverNow),
            },
          ]
        : [];
    });
    setState({ scope: expected, pings });
  }
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    setError("");
    const poll = async () => {
      if (
        !stopped &&
        cloud.joined &&
        mapId &&
        document.visibilityState !== "hidden" &&
        navigator.onLine !== false
      ) {
        try {
          const result = await requestMapSignals(mapId);
          if (!stopped) receive(result, scope);
        } catch {
          /* Sending reports errors; reads resume without replaying old pings. */
        }
      }
      if (!stopped) timer = setTimeout(poll, 1000);
    };
    if (cloud.joined && mapId) void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // Scope changes discard signals and invalidate in-flight room responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, cloud.joined]);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setState((s) =>
          s.pings.some((p) => p.expiresAt <= Date.now())
            ? { ...s, pings: s.pings.filter((p) => p.expiresAt > Date.now()) }
            : s,
        ),
      200,
    );
    return () => clearInterval(timer);
  }, []);
  async function send(point: { x: number; y: number }, color: MapPingInput["color"]) {
    const expected = scope,
      ping = { id: crypto.randomUUID(), mapId, ...point, color };
    setError("");
    try {
      if (cloud.joined) receive(await requestMapSignals(mapId, ping), expected);
      else {
        const now = Date.now();
        setState((s) => ({
          scope: expected,
          pings: [
            ...(s.scope === expected ? s.pings : []),
            { ...ping, seatId: "device", createdAt: now, expiresAt: now + PING_DURATION },
          ].slice(-20),
        }));
      }
    } catch (e) {
      if (current.current === expected)
        setError(e instanceof Error ? e.message : "The ping could not be sent.");
    }
  }
  return {
    pings: state.scope === scope ? state.pings : [],
    send,
    error,
    joined: cloud.joined,
    viewOnly: cloud.viewOnly,
  };
}
