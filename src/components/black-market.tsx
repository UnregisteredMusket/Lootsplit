import { useSeat } from "@/lib/quire/seat";
import { useEconomy } from "@/lib/quire/economy-context";
import { readWorld } from "@/lib/quire/world-schema";
import { MARKUP_TIERS, markupDisplay } from "@/lib/quire/market-markup";
import { CommandButton } from "./world-tools";
import { Fold } from "./ui";
/**
 * DM setting: how players see black-market markup, as a description ("Pricey") or the percent
 * ("+50%"). One `black-market-markup` command with a stale check (market-markup.ts).
 */
export function MarkupDisplaySetting() {
  const { journal } = useEconomy(),
    display = markupDisplay(journal),
    percents = display === "percentages";
  return (
    <div className="markup-display-setting" data-testid="markup-display-setting">
      <p>
        Players see black-market markup as <strong>{percents ? "percentages" : "descriptions"}</strong>
        {percents ? ", e.g. +50%." : ", e.g. Pricey."} You always see the percent.
      </p>
      <p className="text-sm text-muted">
        Descriptions by markup over list:{" "}
        {MARKUP_TIERS.map((t, i) => {
          const from = i ? MARKUP_TIERS[i - 1]!.upTo : 0;
          return `${t.label} (${t.upTo === Infinity ? `over ${from}%` : `up to ${t.upTo}%`})`;
        }).join(", ")}
        .
      </p>
      <CommandButton
        input={{
          kind: "black-market-markup",
          before: display,
          display: percents ? "descriptions" : "percentages",
        }}
      >
        {percents ? "Show descriptions to players" : "Show percentages to players"}
      </CommandButton>
    </div>
  );
}
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
      <h3 className="mt-4 text-sm font-medium">Markup players see</h3>
      <MarkupDisplaySetting />
    </Fold>
  ) : active ? (
    <p className="text-sm text-muted">
      Black-market vendors are available where the DM has placed them.
    </p>
  ) : null;
}
