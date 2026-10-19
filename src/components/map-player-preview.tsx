import { useEffect, useState } from "react";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { activeCampaignId } from "@/lib/quire/campaign-context";
import { characterVisible } from "@/lib/quire/character-position";
import { loadMapAsset, mapAssetBlob } from "@/lib/quire/map-assets";
import { renderMapVisibility } from "@/lib/quire/map-visibility-render";
import {
  mapNeedsMask,
  readMapTabletop,
  sceneViewers,
  projectTabletopMap,
} from "@/lib/quire/tabletop";
import { sceneTokenPoint } from "@/lib/quire/tabletop-geometry";
import type { CampaignMap } from "@/lib/quire/world-schema";

/** DM-local preview. Shared clients still receive only the server-authorized baked frames. */
export function MapPlayerPreview({ map }: { map: CampaignMap }) {
  const table = useWorldTable(),
    campaign = activeCampaignId(),
    settings = readMapTabletop(map);
  const [audience, setAudience] = useState("party"),
    [resolved, setResolved] = useState({ key: "", url: "" }),
    [error, setError] = useState("");
  const seat = { role: "player" as const, purseIds: audience === "party" ? [] : [audience] },
    party = audience === "party",
    source = {
      ...map,
      tokens: map.tokens?.filter(
        (token) =>
          token.kind !== "character" ||
          table.purses.some(
            (person) => person.id === token.entityId && characterVisible(table, person),
          ),
      ),
    },
    projected = projectTabletopMap(table, source, seat, party),
    viewers = sceneViewers(table, source, seat, party),
    signature = JSON.stringify([
      campaign,
      map.id,
      map.image,
      settings.revision,
      settings.media?.id,
      audience,
      viewers,
    ]);
  useEffect(() => {
    let cancelled = false,
      url = "";
    setError("");
    void (async () => {
      const blob = settings.media?.mime.startsWith("image/")
        ? await mapAssetBlob(await loadMapAsset(map.id, settings.media))
        : await (await fetch(map.image)).blob();
      const bitmap = await createImageBitmap(blob);
      try {
        const image = mapNeedsMask(settings)
          ? await mapAssetBlob(await renderMapVisibility(bitmap, source, settings, viewers))
          : blob;
        if (cancelled) return;
        url = URL.createObjectURL(image);
        setResolved({ key: signature, url });
      } finally {
        bitmap.close();
      }
    })().catch((error) => {
      if (!cancelled)
        setError(error instanceof Error ? error.message : "Player preview unavailable.");
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // Re-render only for changes that affect the preview's pixels or audience.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return (
    <section className="tabletop-player-preview" aria-label="Player-view preview">
      <div className="world-row">
        <strong>Player-view preview</strong>
        <label>
          Preview audience
          <select value={audience} onChange={(event) => setAudience(event.target.value)}>
            <option value="party">Shared party / optional display</option>
            {table.purses
              .filter((person) => person.kind === "character" && characterVisible(table, person))
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      {!map.visible && <p>This map is private. Players cannot open it until shared.</p>}
      <div className="tabletop-preview-image">
        {resolved.key === signature ? (
          <>
            <img src={resolved.url} alt={`Player view of ${map.name}`} />
            {projected.tokens?.map((token) => {
              const p = sceneTokenPoint(map.grid!, token);
              return (
                <span key={token.id} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}>
                  {token.label}
                </span>
              );
            })}
          </>
        ) : (
          <p role="status">{error || "Preparing player visibility…"}</p>
        )}
      </div>
      <p className="text-sm text-muted">
        Shows saved exploration and current vision. Remote players receive protected still images
        for concealed scenes, including animated maps.
      </p>
    </section>
  );
}
