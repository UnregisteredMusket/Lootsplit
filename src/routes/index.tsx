import { createFileRoute } from "@tanstack/react-router";
import { HomeBoard } from "@/components/home-board";
import { HomeSheet } from "@/components/home-sheet";
import { Shell } from "@/components/shell";
import { useSeat } from "@/lib/quire/seat";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    view: search.view === "sheet" ? ("sheet" as const) : ("home" as const),
  }),
  component: Home,
});

function Home() {
  const seat = useSeat();
  const { view } = Route.useSearch();
  if (seat.role === "player" && view === "sheet") {
    return (
      <Shell width="prose">
        <HomeSheet />
      </Shell>
    );
  }
  return (
    <Shell>
      <HomeBoard />
    </Shell>
  );
}
