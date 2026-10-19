import { useEffect, useState } from "react";
import { useSeat } from "@/lib/quire/seat";
import { activeCampaignId } from "@/lib/quire/campaign-context";
import { loadMapAsset, mapAssetBlob } from "@/lib/quire/map-assets";
import type { CampaignMap } from "@/lib/quire/world-schema";
import type { MapMediaReference } from "@/lib/quire/map-assets-schema";
import { concealedMapImage } from "@/lib/quire/tabletop";

export function MapArtwork({
  map,
  onRatio,
  animated = true,
}: {
  map: CampaignMap;
  onRatio?: (ratio: number) => void;
  animated?: boolean;
}) {
  const seat = useSeat(),
    campaign = activeCampaignId(),
    media = map.tabletop?.media;
  const references = [
    media,
    ...(seat.role === "dm" ? [] : (map.tabletop?.frames.map((frame) => frame.media) ?? [])),
  ].filter(
    (value, index, values): value is MapMediaReference =>
      !!value && values.findIndex((other) => other?.id === value.id) === index,
  );
  const signature = JSON.stringify([
    campaign,
    seat.role,
    seat.purseIds,
    map.id,
    references.map((reference) => [reference.id, reference.sha256]),
  ]);
  const [resolved, setResolved] = useState<{ key: string; urls: string[] }>({ key: "", urls: [] }),
    [error, setError] = useState(""),
    [playing, setPlaying] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    setError("");
    setPlaying(false);
    void (async () => {
      for (const reference of references) {
        const blob = await mapAssetBlob(await loadMapAsset(map.id, reference));
        if (cancelled) return;
        urls.push(URL.createObjectURL(blob));
      }
      if (!cancelled) setResolved({ key: signature, urls: [...urls] });
    })().catch((error) => {
      if (!cancelled)
        setError(error instanceof Error ? error.message : "Map artwork could not load.");
    });
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
    // Media identity, not unrelated room revisions, controls downloads and object URL lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  const urls = resolved.key === signature ? resolved.urls : [],
    video = !!media?.mime.startsWith("video/");
  const imageLoaded = (image: HTMLImageElement) =>
    onRatio?.((media?.width ?? image.naturalWidth) / (media?.height ?? image.naturalHeight));
  return (
    <>
      <img
        draggable={false}
        src={map.image}
        alt={map.name}
        onLoad={(event) => imageLoaded(event.currentTarget)}
      />
      {!video &&
        urls.map((url, index) => (
          <img
            className="map-media-detail"
            key={url}
            draggable={false}
            src={url}
            alt={index ? "Additional assigned character visibility" : map.name}
            onLoad={(event) => imageLoaded(event.currentTarget)}
          />
        ))}
      {video && animated && urls[0] && (
        <>
          {playing && (
            <video
              className="map-media-detail"
              src={urls[0]}
              muted
              loop
              playsInline
              autoPlay
              onLoadedMetadata={(event) =>
                onRatio?.(event.currentTarget.videoWidth / event.currentTarget.videoHeight)
              }
            />
          )}
          <button
            type="button"
            className="map-video-toggle"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setPlaying((value) => !value)}
            aria-pressed={playing}
          >
            {playing ? "Pause map animation" : "Play map animation"}
          </button>
        </>
      )}
      {references.length > 0 && urls.length === 0 && (
        <span className="map-media-status" role="status">
          {error || "Loading detailed map…"}
        </span>
      )}
      {map.image === concealedMapImage && references.length === 0 && (
        <span className="map-media-status" role="status">
          Waiting for the DM’s current player view. Concealed areas remain hidden.
        </span>
      )}
    </>
  );
}
