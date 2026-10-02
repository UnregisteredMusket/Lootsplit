import { createFileRoute } from "@tanstack/react-router";
import { ResourcesPage } from "@/components/website/resources";
export const Route = createFileRoute("/resources")({
  head: () => ({ meta: [{ title: "Lootsplit · Resources" }] }),
  component: ResourcesPage,
});
