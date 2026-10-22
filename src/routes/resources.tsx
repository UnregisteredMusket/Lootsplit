import { createFileRoute } from "@tanstack/react-router";
import { ResourcesPage } from "@/components/website/resources";
export const Route = createFileRoute("/resources")({
  head: () => ({ meta: [{ title: "Lootsplitter · Resources" }] }),
  component: ResourcesPage,
});
