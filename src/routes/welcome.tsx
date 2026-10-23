import { WelcomePage } from "@/components/website/site";
import { createFileRoute } from "@tanstack/react-router";
import { homeStructuredData, publicPageHead } from "@/lib/deployment/public-urls.mjs";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    ...publicPageHead("/welcome"),
    scripts: [{ type: "application/ld+json", children: JSON.stringify(homeStructuredData()) }],
  }),
  component: WelcomePage,
});
