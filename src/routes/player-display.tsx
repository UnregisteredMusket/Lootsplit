import { createFileRoute } from "@tanstack/react-router";
import { PlayerDisplay } from "@/components/player-display";
export const Route = createFileRoute("/player-display")({ component: PlayerDisplay });
