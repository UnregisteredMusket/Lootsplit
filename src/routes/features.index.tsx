import { publicPageHead } from "@/lib/deployment/public-urls.mjs";
import { createFileRoute } from "@tanstack/react-router";
import { FeaturesPage } from "@/components/website/features";
// Public feature tour. In-app feature screens remain at /features/$feature.
export const Route = createFileRoute("/features/")({
  head: () => publicPageHead("/features"),
  component: FeaturesPage,
});
