import { createFileRoute } from "@tanstack/react-router";
import { HelpPage } from "@/components/website/site";
export const Route = createFileRoute("/help")({
  head: () => ({ meta: [{ title: "Lootsplit · Help" }] }),
  component: HelpPage,
});
