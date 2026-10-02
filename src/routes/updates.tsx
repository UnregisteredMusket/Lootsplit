import { createFileRoute } from "@tanstack/react-router";
import { UpdatesPage } from "@/components/website/site";
export const Route = createFileRoute("/updates")({ head: () => ({ meta: [{ title: "Lootsplit · updates" }] }), component: UpdatesPage });
