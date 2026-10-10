import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { CampaignMaps } from "@/components/campaign-map";
export const Route = createFileRoute("/maps")({
  validateSearch: (s: Record<string, unknown>) => ({ map: typeof s.map === "string" ? s.map.slice(0, 150) : undefined }),
  component: () => (
    <Shell>
      <h1>Campaign maps</h1>
      <CampaignMaps />
    </Shell>
  ),
});
