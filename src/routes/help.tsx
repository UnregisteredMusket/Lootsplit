import { publicPageHead } from "@/lib/deployment/public-urls.mjs";
import { createFileRoute } from "@tanstack/react-router";
import { HelpPage } from "@/components/website/site";
export const Route = createFileRoute("/help")({
  head: () => publicPageHead("/help"),
  component: HelpPage,
});
