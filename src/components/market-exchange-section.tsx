import { useEffect, useMemo, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { seatGroups } from "@/lib/quire/party-groups";
import { readTradeEconomy } from "@/lib/quire/trade-economy-schema";
import { exchangeHere } from "@/lib/quire/trade-economy";
import { commodityQuoteRows } from "@/lib/quire/commodity-board";
import { globalMarketCity, readMarketLocations } from "@/lib/quire/shop-locations";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { useSeat } from "@/lib/quire/seat";
import {
  EXCHANGE_OPEN_KEY,
  readDeviceFlag,
  writeDeviceFlag,
} from "@/lib/quire/shop-counter-memory";
import { GlobalCommodityMarket } from "./commodity-board";
import { AppLink } from "./app-link";
import { Disclosure } from "./disclosure";

/**
 * The Market's trade exchange as a compact summary tile (design plan D6/P7). The full global
 * board stays one tap away in a collapsed "Trade exchange · N goods" section whose open state
 * is remembered on this device; a `#global-market` link (Desk → Market information) opens it.
 */
export function TradeExchangeSection() {
  const table = useWorldTable(),
    seat = useSeat(),
    dm = seat.role === "dm";
  const hash = useRouterState({ select: (s) => s.location.hash });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const linked = hash === "global-market";
    setOpen(linked || readDeviceFlag(EXCHANGE_OPEN_KEY, false));
    if (linked)
      requestAnimationFrame(() =>
        document.getElementById("global-market")?.scrollIntoView({ block: "start" }),
      );
  }, [hash]);
  const economy = useMemo(
    () => readTradeEconomy(table.journal.tradeEconomy),
    [table.journal.tradeEconomy],
  );
  const exchanges = economy.exchanges.filter(
    (e) => dm || (e.visible && exchangeHere(table, e, seatGroups(table, seat))),
  );
  const goods = new Set(commodityQuoteRows(economy, exchanges).map((row) => row.commodity.id)).size;
  const here = !!globalMarketCity(readMarketLocations(table.journal.market));
  return (
    <section className="market-exchange-tile" aria-label="Trade exchange">
      <div className="market-exchange-summary">
        <p>
          <strong>Global market</strong> ·{" "}
          {here ? "open here" : "closed here · visit a city to trade"}
        </p>
        <AppLink className="settings-link" href="/features/economy?from=%2Fmarket">
          Trade Exchanges · regional goods & seasonal market →
        </AppLink>
      </div>
      <Disclosure variant="inline"
        className="market-exchange-board"
        open={open}
        onToggle={(event) => {
          const next = event.currentTarget.open;
          if (next === open) return; // Opened by a link, not by the person: nothing to remember.
          setOpen(next);
          writeDeviceFlag(EXCHANGE_OPEN_KEY, next);
        }} summary={<>
          Trade exchange · {goods} {goods === 1 ? "good" : "goods"}
        </>}>
        {open ? <GlobalCommodityMarket /> : null}
      </Disclosure>
    </section>
  );
}
