import { useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { PlayerHome } from "@/components/player-home";
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
  const navigate=useNavigate(),hash=useRouterState({select:s=>s.location.hash});
  useEffect(()=>{const feature=({journal:"journal",review:"bank","review-inbox":"bank","campaign-finance":"downtime","campaign-operations":"properties"} as Record<string,string>)[hash];if(feature)void navigate({to:"/features/$feature",params:{feature},search:{from:"/?view=overview",code:undefined},replace:true});},[hash,navigate]);
  if (seat.role === "player" && view !== "overview") {
    return (
      <Shell>
        {view === "sheet" ? <HomeSheet /> : <PlayerHome />}
      </Shell>
    );
  }
  return <Shell><TestResetButton />{view === "overview" ? <HomeBoard /> : <DmDesk />}</Shell>;
}
