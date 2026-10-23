import { publicPageHead } from "@/lib/deployment/public-urls.mjs";
import { createFileRoute } from "@tanstack/react-router";
import { DownloadsPage } from "@/components/website/downloads";
export const Route = createFileRoute("/downloads")({
  head: () => publicPageHead("/downloads"),
  component: DownloadsPage,
});
