import { createFileRoute } from "@tanstack/react-router";
import { DownloadsPage } from "@/components/website/site";
export const Route = createFileRoute("/downloads")({
  head: () => ({ meta: [{ title: "Lootsplit · Downloads" }] }),
  component: DownloadsPage,
});
