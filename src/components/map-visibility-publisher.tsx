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
  const latest = useRef({ table, economy, seat, campaign });
  latest.current = { table, economy, seat, campaign };
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
      if (latest.current.campaign !== campaign || getCloudTable().pending) return;
      for (const map of table.journal.world?.maps ?? []) {
        if (cancelled) return;
        const settings = readMapTabletop(map);
        if (settings.media) {
          const cached = await cachedMapAsset(settings.media.id);
          if (cached) await publishMapAsset(cached);
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
            await cacheMapAsset(bundle);
            await publishMapAsset(bundle);
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
                  media: mapMediaReference(bundle.manifest),
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
    };
    const timer = setTimeout(() => {
      const run = navigator.locks
        ? navigator.locks.request(
            "lootsplit-map-views:" + campaign,
            { ifAvailable: true },
            (lock) => (lock ? work() : undefined),
          )
        : work();
      void run.catch((error) => {
        if (!cancelled)
          setFailure(
            error instanceof Error ? error.message : "Player visibility could not update.",
          );
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [campaign, known, seat.role, signature, cloud.pending, cloud.viewOnly, retry]);
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
