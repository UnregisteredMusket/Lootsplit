import { publicPageHead } from "@/lib/deployment/public-urls.mjs";
import { createFileRoute } from "@tanstack/react-router";
import { DonatePage } from "@/components/website/donate";
export const Route = createFileRoute("/donate")({
  head: () => publicPageHead("/donate"),
  component: DonatePage,
});
