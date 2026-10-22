import { createFileRoute } from "@tanstack/react-router";
import { DownloadsPage } from "@/components/website/downloads";
export const Route = createFileRoute("/downloads")({
  head: () => ({ meta: [{ title: "Lootsplitter · Downloads" }] }),
  component: DownloadsPage,
});
