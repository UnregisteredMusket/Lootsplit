import { createFileRoute } from "@tanstack/react-router";
import { UpdatesPage } from "@/components/website/updates";
export const Route = createFileRoute("/updates")({
  head: () => ({ meta: [{ title: "Lootsplit · Changelog" }] }),
  component: UpdatesPage,
});
