import { publicPageHead } from "@/lib/deployment/public-urls.mjs";
import { createFileRoute } from "@tanstack/react-router";
import { ResourcesPage } from "@/components/website/resources";
export const Route = createFileRoute("/resources")({
  head: () => publicPageHead("/resources"),
  component: ResourcesPage,
});
