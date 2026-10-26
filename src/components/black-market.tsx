import { useSeat } from "@/lib/quire/seat";
import { useEconomy } from "@/lib/quire/economy-context";
import { readWorld } from "@/lib/quire/world-schema";
import { CommandButton } from "./world-tools";
import { Fold } from "./ui";
export function BlackMarketToggle() {
  const { journal } = useEconomy(),
    seat = useSeat(),
    active = readWorld(journal.world).blackMarketActive;
  return seat.role === "dm" ? (
    <Fold title="Black market" hint="Reveal or hide configured vendors live.">
      <p>
        Hidden vendors use ordinary shop stock, locations, availability and purchasing. Configure
        rare or illegal goods in each vendor's stock editor.
      </p>
      <p>Black market is {active ? "available" : "hidden"}.</p>
      <CommandButton input={{ kind: "black-market", before: active, active: !active }}>
        {active ? "Hide black market" : "Reveal black market"}
      </CommandButton>
    </Fold>
  ) : active ? (
    <p className="text-sm text-muted">
      Black-market vendors are available where the DM has placed them.
    </p>
  ) : null;
}
