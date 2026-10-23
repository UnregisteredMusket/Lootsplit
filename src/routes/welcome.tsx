import { WelcomePage } from "@/components/website/site";
import { createFileRoute } from "@tanstack/react-router";
import { homeStructuredData, publicPageHead } from "@/lib/deployment/public-urls.mjs";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    ...publicPageHead("/welcome"),
    // The hero landscape is the largest element on phones (Lighthouse LCP); fetch it first.
    links: [{ rel: "preload", as: "image", href: "/art/landscape.webp", fetchPriority: "high" }],
    scripts: [{ type: "application/ld+json", children: JSON.stringify(homeStructuredData()) }],
  }),
  component: WelcomePage,
});
