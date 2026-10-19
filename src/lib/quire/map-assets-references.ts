import type { CampaignMap } from "./world-schema.ts";
import type { MapMediaReference } from "./map-assets-schema.ts";

export function mapAssetReferences(
  maps: CampaignMap[],
  reports: { snapshot: string }[] = [],
  depth = 0,
): { mapId: string; media: MapMediaReference }[] {
  if (depth > 10) throw Error("Too many nested map archives. Keep the original recovery export.");
  return [
    ...maps.flatMap((map) =>
      [map.tabletop?.media, ...(map.tabletop?.frames.map((frame) => frame.media) ?? [])]
        .filter((media): media is MapMediaReference => !!media)
        .map((media) => ({ mapId: map.id, media })),
    ),
    ...reports.flatMap((report) => {
      let table;
      try {
        table = JSON.parse(report.snapshot);
      } catch {
        return [];
      } // Preserve unreadable archive bytes in the backup.
      return mapAssetReferences(
        table?.journal?.world?.maps ?? [],
        table?.journal?.reports ?? [],
        depth + 1,
      );
    }),
  ];
}
