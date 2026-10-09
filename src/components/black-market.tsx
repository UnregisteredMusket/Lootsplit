import { useState } from "react";
import { useSeat } from "@/lib/quire/seat";
import { useEconomy } from "@/lib/quire/economy-context";
import { readWorld } from "@/lib/quire/world-schema";
import type { Shop } from "@/lib/quire/types";
import { CommandButton, CommandForm } from "./world-tools";
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
export function BlackMarketVendor({ shop }: { shop: Shop }) {
  const [hidden, setHidden] = useState(shop.blackMarket ?? false),
    [premium, setPremium] = useState(String(shop.blackMarketPremium ?? 1.5));
  return (
    <Fold title="Black-market vendor rules">
      <CommandForm
        label="Save black-market vendor"
        dirty={
          hidden !== (shop.blackMarket ?? false) ||
          premium !== String(shop.blackMarketPremium ?? 1.5)
        }
        submit={() => ({
          kind: "shop-black-market",
          shopId: shop.id,
          before: { hidden: shop.blackMarket ?? false, premium: shop.blackMarketPremium ?? 1.5 },
          hidden,
          premium: Number(premium),
        })}
      >
        <label>
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          Normally hidden black-market vendor
        </label>
        <label>
          Price premium multiplier
          <input
            type="number"
            min={1.01}
            max={100}
            step={0.01}
            value={premium}
            onChange={(e) => setPremium(e.target.value)}
          />
        </label>
        <p>
          The multiplier applies to the existing shop asking price before the usual Charisma
          adjustment. The DM's live toggle controls visibility; closed vendors and location rules
          still apply.
        </p>
      </CommandForm>
    </Fold>
  );
}
