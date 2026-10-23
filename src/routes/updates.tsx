import { publicPageHead } from "@/lib/deployment/public-urls.mjs";
import { createFileRoute } from "@tanstack/react-router";
import { UpdatesPage } from "@/components/website/updates";
export const Route = createFileRoute("/updates")({
  head: () => publicPageHead("/updates"),
  component: UpdatesPage,
});
