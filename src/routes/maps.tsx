import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { CampaignMaps } from "@/components/campaign-map";
// `record=kind:id` shows a record on the map (anyone; the map checks permissions). Presentation
// only: it changes no campaign data and no one else's camera.
const bounded = (value: unknown, limit: number) =>
  typeof value === "string" ? value.slice(0, limit) : undefined;
export const Route = createFileRoute("/maps")({
  validateSearch: (s: Record<string, unknown>): { map?: string; record?: string; place?: string } => ({
    map: bounded(s.map, 150),
    record: bounded(s.record, 170),
    // `place=kind:id`: the DM's "Place on map". Players opening it get the plain map.
    place: bounded(s.place, 170),
  }),
  component: () => (
    <Shell>
      <CampaignMaps />
    </Shell>
  ),
});
