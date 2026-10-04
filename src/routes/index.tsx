import { TestResetButton } from "@/components/test-mode";
import { createFileRoute } from "@tanstack/react-router";
import { DmDesk } from "@/components/control-panel/desk";
import { HomeBoard } from "@/components/home-board";
import { HomeSheet } from "@/components/home-sheet";
import { Shell } from "@/components/shell";
import { useSeat } from "@/lib/quire/seat";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    view:
      search.view === "sheet"
        ? ("sheet" as const)
        : search.view === "overview"
          ? ("overview" as const)
          : ("home" as const),
  }),
  component: Home,
});

function Home() {
  const seat = useSeat();
  const { view } = Route.useSearch();
  if (seat.role === "player" && view !== "overview") {
    return (
      <Shell>
        <HomeSheet />
      </Shell>
    );
  }
  return <Shell><TestResetButton />{view === "overview" ? <HomeBoard /> : <DmDesk />}</Shell>;
}
