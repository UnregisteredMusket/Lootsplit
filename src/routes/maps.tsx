import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { CampaignMaps } from "@/components/campaign-map";
export const Route = createFileRoute("/maps")({
  component: () => (
    <Shell>
      <h1>Campaign maps</h1>
      <CampaignMaps />
    </Shell>
  ),
});
