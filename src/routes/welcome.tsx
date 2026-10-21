import { WelcomePage } from "@/components/website/site";
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/welcome")({ component: WelcomePage });
