import { FeatureLink } from "./feature-navigation";
import { CharacterWorkspace } from "@/components/characters/workspace";
import { getServerCloudTable } from "@/lib/quire/cloud-client";
import { InventoryList, PortraitPicker } from "./ledger-art";
import { getCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CharacterSheetPanel, SheetBody } from "@/components/character-sheet";
import { Guide } from "@/components/guide";
import { TurnLine } from "@/components/turn-line";
import { useEconomy } from "@/lib/quire/economy-context";
import { loadHandouts, type Handout } from "@/lib/quire/handouts";
import { formatCoins, formatCopper, toCopper } from "@/lib/quire/money";
import { Fold } from "@/components/ui";
import { useSeat } from "@/lib/quire/seat";
import { allowContextChange } from "@/lib/quire/use-draft-guard";

export function HomeSheet() {
  const { ready, purses, holdings, sheets } = useEconomy();
  const seat = useSeat();
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const mine = purses.filter(
    (purse) => purse.kind === "character" && seat.purseIds.includes(purse.id),
  );
  const [picked, setPicked] = useState(mine[0]?.id ?? "");
  const purse = mine.find((item) => item.id === picked) ?? mine[0];
  const sheet = purse ? sheets.find((item) => item.purseId === purse.id) : undefined;
  const carried = purse ? holdings.filter((holding) => holding.purseId === purse.id) : [];
  const [handouts, setHandouts] = useState<Handout[]>([]);

  useEffect(() => {
    void loadHandouts()
      .then(setHandouts)
      .catch(() => setHandouts([]));
  }, [ready, cloud.revision]);

  if (!ready) return <p className="mt-6 text-muted">Loading…</p>;
  if (!purse) {
    return (
      <>
        <CharacterWorkspace campaignCode={cloud.code} />
        <h2 className="font-display text-2xl tracking-tight">Device campaign</h2>
        <p className="mt-2 text-sm text-muted">
          No character is assigned to this browser on this device.
        </p>
      </>
    );
  }

  const coin = toCopper(purse.coins);
  const subtitle = [sheet?.classLevel, sheet?.race].filter(Boolean).join(" · ");

  return (
    <article>
      <CharacterWorkspace campaignCode={cloud.code} purseId={purse.id} />
      <h2 className="mt-8 font-display text-2xl">Campaign inventory & imported sheet</h2>
      {mine.length > 1 ? (
        <label className="mb-4 block text-sm text-muted">
          Character
          <select
            value={purse.id}
            onChange={(event) => {
              if (allowContextChange()) setPicked(event.target.value);
            }}
            className="mt-1 min-h-11 w-full rounded-xl border border-lead/30 bg-elevated px-3 text-base"
            aria-label="Character"
          >
            {mine.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <PortraitPicker purse={purse} />
      <p className="eyebrow">Your character & inventory</p>
      <h1 className="mt-1 font-display text-4xl tracking-tight">{sheet?.name || purse.name}</h1>
      {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
      <TurnLine />
      <section className="mt-4 rounded-2xl border border-lead/25 wealth-card bg-elevated p-5">
        <p className="font-display text-3xl tabular-nums tracking-tight text-lead">
          {formatCoins(purse.coins)}
        </p>
        <p className="mt-1 text-sm text-muted">≈ {formatCopper(coin)}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <span>
            <span className="block text-xs text-faint">Coin</span>
            {formatCopper(coin)}
          </span>
          <span>
            <span className="block text-xs text-faint">Items</span>
            {formatCopper(
              carried
                .filter((holding) => holding.kind === "item")
                .reduce((sum, holding) => sum + holding.unitCopper * holding.quantity, 0),
            )}
          </span>
          <span>
            <span className="block text-xs text-faint">Property</span>
            {formatCopper(
              carried
                .filter((holding) => holding.kind === "property")
                .reduce((sum, holding) => sum + holding.unitCopper * holding.quantity, 0),
            )}
          </span>
        </div>
      </section>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center text-sm">
        {!cloud.joined ? (
          <Link
            to="/party"
            search={{ action: "pay" }}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-lead/40"
          >
            Pay
          </Link>
        ) : null}
        <Link
          to="/party"
          search={{ action: "give" }}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-lead/40"
        >
          Give
        </Link>
        <Link
          to="/market"
          search={{ book: "" }}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-lead/40"
        >
          Sell
        </Link>
        <FeatureLink feature="bank">Request loan</FeatureLink>
        {!cloud.joined ? (
          <Link
            to="/party"
            search={{ action: "add" }}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-lead/40"
          >
            Add
          </Link>
        ) : null}
      </div>
      <InventoryList holdings={carried} />
      <Fold title="Character sheet" hint="The 2014 sheet, if one was imported.">
        {sheet ? (
          <div data-surface="paper" className="rounded-xl p-4">
            <SheetBody sheet={sheet} />
          </div>
        ) : (
          <p className="text-sm text-muted">No 2014 sheet yet.</p>
        )}
        <CharacterSheetPanel purseId={purse.id} face={false} />
      </Fold>
      {handouts.length > 0 ? (
        <section className="mt-6 border-t border-paper-line pt-4">
          <h2 className="font-display text-2xl tracking-tight">Handouts</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {handouts.map((handout) => (
              <li key={handout.id}>
                <p className="text-sm font-medium">{handout.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{handout.text}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Guide />
    </article>
  );
}
