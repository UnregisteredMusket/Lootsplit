import { useEconomy } from "./economy-context";
export function useWorldTable() {
  const e = useEconomy();
  return {
    purses: e.purses,
    holdings: e.holdings,
    shops: e.shops,
    stock: e.stock,
    ledger: e.ledger,
    listings: e.listings,
    loans: e.loans,
    sheets: e.sheets,
    notes: [],
    journal: e.journal,
  };
}
