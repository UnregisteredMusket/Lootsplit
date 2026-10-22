import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSeat, useSeatKnown } from "@/lib/quire/seat";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { useEconomy } from "@/lib/quire/economy-context";
import { activeCampaignId } from "@/lib/quire/campaign-context";
import {
  captureMutationScope,
  getCloudTable,
  getServerCloudTable,
  subscribeCloudTable,
} from "@/lib/quire/cloud-client";
import {
  loadMapAsset,
  cachedMapAsset,
  cacheMapAsset,
  publishMapAsset,
  mapAssetBlob,
} from "@/lib/quire/map-assets";
import { mapMediaReference } from "@/lib/quire/map-assets-schema";
import { renderMapVisibility } from "@/lib/quire/map-visibility-render";
import { mapNeedsMask, readMapTabletop, sceneViewers } from "@/lib/quire/tabletop";
import {
  missingPlayerViews,
  renderDelay,
  renderReducer,
  renderStatusStore,
  type RenderEvent,
} from "@/lib/quire/map-render-status";

const dispatch = (event: RenderEvent) =>
  renderStatusStore.set(renderReducer(renderStatusStore.get(), event));
const missingViews = (table: ReturnType<typeof useWorldTable>, role: string) =>
  role === "dm"
    ? (table.journal.world?.maps ?? []).reduce(
        (sum, map) => sum + missingPlayerViews(table, map).length,
        0,
      )
    : 0;

/** DM preparation remains separate from player activation; current views publish in every workspace. */
export function MapVisibilityPublisher() {
  const table = useWorldTable(),
    economy = useEconomy(),
    seat = useSeat(),
    known = useSeatKnown(),
    campaign = activeCampaignId(),
    [failure, setFailure] = useState(""),
    [retry, setRetry] = useState(0),
    cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const latest = useRef({ table, economy, seat, campaign }),
    published = useRef(new Set<string>());
  latest.current = { table, economy, seat, campaign };
  useEffect(() => {
    renderStatusStore.onRetry(() => {
      dispatch({ type: "retry", at: Date.now() });
      setRetry((value) => value + 1);
    });
    return () => {
      renderStatusStore.onRetry(undefined);
      renderStatusStore.set({ phase: "idle" });
    };
    // The store is module-wide; one publisher is mounted per signed-in DM workspace.
  }, []);
  const signature = JSON.stringify(
    (table.journal.world?.maps ?? []).map((map) => [
      map.id,
      map.visible,
      map.tabletop?.media?.id,
      map.tabletop?.revision,
      map.tabletop?.frames.map((frame) => [frame.audience, frame.revision]),
    ]),
  );
  useEffect(() => {
    if (!known || seat.role !== "dm" || getCloudTable().viewOnly) return;
    let cancelled = false;
    const work = async () => {
      if (cancelled) return;
      const { table, economy, seat } = latest.current,
        scope = captureMutationScope();
      const connection = getCloudTable();
      if (
        latest.current.campaign !== campaign ||
        connection.pending ||
        (connection.joined && !connection.mine)
      )
        return;
      const ensurePublished = async (media: { id: string }) => {
        if (!connection.joined) return;
        const key = `${campaign}:${connection.code}:${media.id}`;
        if (published.current.has(key)) return;
        const cached = await cachedMapAsset(media.id);
        if (cached) {
          await publishMapAsset(cached);
          published.current.add(key);
        }
      };
      for (const map of table.journal.world?.maps ?? []) {
        if (cancelled) return;
        const settings = readMapTabletop(map);
        if (settings.media) await ensurePublished(settings.media);
        // Offline preparation may already contain finished frames. Upload them when hosting starts.
        for (const frame of settings.frames.filter(
          (frame) => frame.revision === settings.revision,
        )) {
          await ensurePublished(frame.media);
        }
        if (!map.visible) continue;
        if (!mapNeedsMask(settings)) continue;
        const audiences =
          settings.vision === "individual"
            ? [
                "party",
                ...table.purses.filter((p) => p.kind === "character").map((p) => "purse:" + p.id),
              ]
            : ["party"];
        const needed = audiences.filter(
          (audience) =>
            !settings.frames.some(
              (frame) => frame.audience === audience && frame.revision === settings.revision,
            ),
        );
        if (!needed.length) continue;
        // Protected video scenes deliberately use their static poster. Hidden video frames never download to players.
        const blob =
          settings.media && settings.media.mime.startsWith("image/")
            ? await mapAssetBlob(await loadMapAsset(map.id, settings.media))
            : await (await fetch(map.image)).blob();
        const bitmap = await createImageBitmap(blob);
        try {
          for (const audience of needed) {
            if (cancelled || latest.current.campaign !== campaign) return;
            const viewers = sceneViewers(
              table,
              map,
              { ...seat, purseIds: audience === "party" ? [] : [audience.slice(6)] },
              audience === "party",
            );
            const bundle = await renderMapVisibility(bitmap, map, settings, viewers);
            if (cancelled) return;
            const previous = settings.frames.find((frame) => frame.audience === audience);
            const identical = previous?.media.sha256 === bundle.manifest.sha256;
            if (!identical) {
              await cacheMapAsset(bundle);
              await publishMapAsset(bundle);
              if (connection.joined)
                published.current.add(`${campaign}:${connection.code}:${bundle.manifest.id}`);
            }
            if (cancelled) return;
            const result = await economy.commandOutcome(
              {
                kind: "map-render",
                mapId: map.id,
                revision: settings.revision,
                beforeFrameId:
                  settings.frames.find((frame) => frame.audience === audience)?.id ?? null,
                frame: {
                  id: crypto.randomUUID(),
                  audience,
                  revision: settings.revision,
                  media: identical ? previous.media : mapMediaReference(bundle.manifest),
                },
              },
              scope,
            );
            if (result.status === "pending") return;
          }
        } finally {
          bitmap.close();
        }
      }
      setFailure("");
      if (!cancelled)
        dispatch({
          type: "done",
          at: Date.now(),
          missing: missingViews(latest.current.table, latest.current.seat.role),
        });
    };
    // Visibility changes (each token move with vision on) restart a short debounce, bounded by a
    // maximum wait so continuous dragging still updates players.
    const now = Date.now(),
      pending = missingViews(latest.current.table, latest.current.seat.role);
    dispatch({ type: "change", at: now, missing: pending });
    const delay = pending ? (renderDelay(renderStatusStore.get(), now) ?? 0) : 200;
    const timer = setTimeout(() => {
      if (pending) dispatch({ type: "start", at: Date.now() });
      const run = navigator.locks
        ? navigator.locks.request(
            "lootsplit-map-views:" + campaign,
            { ifAvailable: true },
            (lock) =>
              lock
                ? work()
                : dispatch({
                    type: "done",
                    at: Date.now(),
                    missing: missingViews(latest.current.table, latest.current.seat.role),
                  }),
          )
        : work();
      void run.catch((error) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Player visibility could not update.";
        setFailure(message);
        dispatch({ type: "fail", at: Date.now(), error: message });
      });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    campaign,
    known,
    seat.role,
    signature,
    cloud.pending,
    cloud.viewOnly,
    cloud.joined,
    cloud.code,
    cloud.mine,
    retry,
  ]);
  if (!failure || !known || seat.role !== "dm") return null;
  return (
    <aside className="map-render-notice" role="status">
      Player view is safely concealed while visibility updates: {failure}{" "}
      <button type="button" onClick={() => setRetry((value) => value + 1)}>
        Retry player view
      </button>
    </aside>
  );
}
