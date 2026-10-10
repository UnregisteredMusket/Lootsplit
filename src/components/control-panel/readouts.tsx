import { useEconomy } from "@/lib/quire/economy-context";
import { characterSheet } from "@/lib/characters/campaign-sheet.mjs";
export type SheetReadout = {
  id: string;
  purse_id: string;
  body: {
    name: string;
    portrait: string;
    classes: string;
    level: number;
    hp: number;
    maxHp: number;
    ac: number;
  };
};
export function useSheetReadouts() {
  const economy = useEconomy();
  return economy.purses
    .filter(
      (p) =>
        p.kind === "character" &&
        !economy.journal.tradeEconomy?.exchanges.some((e) => e.purseId === p.id),
    )
    .map((p) => ({
      id: `party:${p.id}`,
      purse_id: p.id,
      body: characterSheet(
        p,
        economy.holdings,
        economy.sheets.find((s) => s.purseId === p.id),
      ),
    }));
}
export function HpBar({ hp, max }: { hp: number; max: number }) {
  return (
    <span
      className="health-track"
      role="meter"
      aria-label="Hit points"
      aria-valuemin={0}
      aria-valuemax={Math.max(1, max)}
      aria-valuenow={Math.max(0, Math.min(hp, max))}
    >
      <span
        style={{
          width: `${Math.max(0, Math.min(100, max ? (hp / max) * 100 : 0))}%`,
        }}
      />
    </span>
  );
}
