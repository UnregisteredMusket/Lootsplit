import { publicPageHead } from "@/lib/deployment/public-urls.mjs";
import { createFileRoute } from "@tanstack/react-router";
import { CommunityPage } from "@/components/website/community";
// Looking for Group directory (owner decisions 2026-10-23).
export const Route = createFileRoute("/community/")({
  head: () => publicPageHead("/community"),
  component: CommunityPage,
});
