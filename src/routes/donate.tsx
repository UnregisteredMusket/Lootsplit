import { createFileRoute } from "@tanstack/react-router";
import { DonatePage } from "@/components/website/donate";
export const Route = createFileRoute("/donate")({
  head: () => ({ meta: [{ title: "Lootsplitter · Donate" }] }),
  component: DonatePage,
});
