import { createFileRoute } from "@tanstack/react-router";
import { WelcomePage } from "@/components/website/site";
export const Route = createFileRoute("/welcome")({
  head: () => ({ meta: [{ title: "Lootsplit · Campaign companion" }] }),
  component: WelcomePage,
});
