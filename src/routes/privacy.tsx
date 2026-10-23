import { publicPageHead } from "@/lib/deployment/public-urls.mjs";
import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPage } from "@/components/website/privacy";
export const Route = createFileRoute("/privacy")({
  head: () => publicPageHead("/privacy"),
  component: PrivacyPage,
});
