import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Shell, KeptByDm } from "@/components/shell";
import { Campaigns } from "@/components/campaigns";
import { Button, ChoiceGrid, Confirm, Fold, Slider, Switch, ToggleButton } from "@/components/ui";
import { useEconomy } from "@/lib/quire/economy-context";
import { useLibrary } from "@/lib/quire/library";
import { CATEGORIES, RARITIES, WEALTHS } from "@/lib/quire/labels";
import { usePrefs, type AppPrefs } from "@/lib/quire/prefs";
import { useSeat } from "@/lib/quire/seat";
import { basketNote, DEFAULT_REALM, realmNote, scalePrice, SEASON_NAMES } from "@/lib/quire/scale";
import { DEFAULT_ACCENT, DEFAULT_GROUND, LOOKS, luminance } from "@/lib/quire/theme";
import type { ItemCategory, ItemRarity, RealmSettings, Wealth } from "@/lib/quire/types";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const READ_LABELS = ["Small", "Usual", "Large", "Broadsheet"] as const;
const DOLLAR_PRESETS = [100, 250, 500, 1000] as const;

function bandOf(value: number): 0 | 1 | 2 {
  if (value < 0.5) return 0;
  if (value > 1.5) return 2;
  return 1;
}

function inflationBand(value: number): number {
  if (value < 0.9) return 0.75;
  if (value > 1.25) return 1.5;
  return 1;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function SettingsPage() {
  const { ready, realm, setRealm, resetAll } = useEconomy();
  const { reload: reloadLibrary } = useLibrary();
  const { prefs, setPrefs, resetPrefs } = usePrefs();
  const seat = useSeat();
  const [draft, setDraft] = useState<RealmSettings>(realm);
  const draftRef = useRef(realm);
  const [resetting, setResetting] = useState(false);
  const [wiping, setWiping] = useState(false);

  useEffect(() => {
    draftRef.current = realm;
    setDraft(realm);
  }, [realm]);

  function slide(key: keyof RealmSettings, value: number) {
    const next = { ...draftRef.current, [key]: value };
    draftRef.current = next;
    setDraft(next);
  }

  function commitKey(key: keyof RealmSettings, value: number) {
    const next = { ...draftRef.current, [key]: value };
    draftRef.current = next;
    setDraft(next);
    void setRealm(next, { reprice: prefs.repriceOnRealm });
  }

  function mark(category: ItemCategory, rarity: ItemRarity) {
    return scalePrice(100, { wealth: "modest", rarity, priceScale: 1, category, realm: draft });
  }

  if (seat.role === "player") return <KeptByDm />;

  const dirty = JSON.stringify(draft) !== JSON.stringify(realm);

  return (
    <Shell width="prose">
      <h1 className="font-display text-4xl tracking-tight">Settings</h1>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Price modifiers, the defaults for the next shop, how entries are displayed, and the colors. A slider sets a number. A button picks a named option.
      </p>
      {!ready ? <p className="mt-6 text-muted">Loading…</p> : null}
      {ready ? (
        <>
          <Fold title="Price modifiers" hint="Season, shortages, war, and the value of a gold piece." defaultOpen>
            <p className="mt-2 text-sm text-muted">
              {realmNote(draft, { dollars: prefs.showDollars })}
            </p>
            <p className="mt-2 text-sm text-muted">{basketNote(draft, { dollars: prefs.showDollars })}</p>
            <p className="mt-2 text-sm text-faint">{dirty ? "Release the slider to keep this." : "Saved."}</p>

            <div className="mt-5">
              <ChoiceGrid
                label="Season"
                value={Math.round(draft.season)}
                options={SEASON_NAMES.map((label, value) => ({ value, label }))}
                onChange={(value) => commitKey("season", value)}
              />
            </div>

            <div className="mt-5">
              <p className="mb-2 text-sm font-medium">Value of 1 gp</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Dollar presets">
                {DOLLAR_PRESETS.map((amount) => (
                  <ToggleButton key={amount} pressed={Math.round(draft.gpDollars) === amount} onClick={() => commitKey("gpDollars", amount)}>
                    ${amount}
                  </ToggleButton>
                ))}
              </div>
              <div className="mt-2">
                <Slider
                  label="Dollar amount"
                  min={25}
                  max={2000}
                  step={25}
                  value={draft.gpDollars}
                  onChange={(value) => slide("gpDollars", value)}
                  onCommit={(value) => commitKey("gpDollars", value)}
                  display={`$${Math.round(draft.gpDollars)}`}
                />
              </div>
              <p className="text-sm text-muted">How many dollars one gold piece is shown as. This does not change the coin values.</p>
            </div>

            <RealmBand
              label="Shortage"
              low="None"
              mid="Tight"
              high="Severe"
              value={draft.shortage}
              onPick={(value) => commitKey("shortage", value)}
              onSlide={(value) => slide("shortage", value)}
              onCommit={(value) => commitKey("shortage", value)}
            />
            <RealmBand
              label="War"
              low="Peace"
              mid="Unrest"
              high="Open war"
              value={draft.war}
              onPick={(value) => commitKey("war", value)}
              onSlide={(value) => slide("war", value)}
              onCommit={(value) => commitKey("war", value)}
            />
            <RealmBand
              label="Plague"
              low="Clear"
              mid="Sickness"
              high="Plague"
              value={draft.plague}
              onPick={(value) => commitKey("plague", value)}
              onSlide={(value) => slide("plague", value)}
              onCommit={(value) => commitKey("plague", value)}
            />
            <RealmBand
              label="Roads"
              low="Shut"
              mid="Open"
              high="Busy"
              value={draft.roads}
              onPick={(value) => commitKey("roads", value)}
              onSlide={(value) => slide("roads", value)}
              onCommit={(value) => commitKey("roads", value)}
            />
            <RealmBand
              label="Scarcity"
              low="Flat"
              mid="Usual"
              high="Severe"
              value={draft.scarcity}
              onPick={(value) => commitKey("scarcity", value)}
              onSlide={(value) => slide("scarcity", value)}
              onCommit={(value) => commitKey("scarcity", value)}
            />

            <div className="mt-4 border-t border-border pt-4">
              <ChoiceGrid
                label="Inflation"
                value={inflationBand(draft.inflation)}
                options={[
                  { value: 0.75, label: "Soft" },
                  { value: 1, label: "Even" },
                  { value: 1.5, label: "Hot" },
                ]}
                onChange={(value) => commitKey("inflation", value)}
              />
              <div className="mt-2">
                <Slider
                  label="Inflation amount"
                  min={0.5}
                  max={2.5}
                  step={0.05}
                  value={draft.inflation}
                  onChange={(value) => slide("inflation", value)}
                  onCommit={(value) => commitKey("inflation", value)}
                  display={`${Math.round(draft.inflation * 100)}%`}
                />
              </div>
            </div>
          </Fold>

          <Fold title="Price preview" hint="What an average shop would charge now.">
            <p className="mt-2 text-sm text-muted">
              What an average shop would charge now, as a percent of the list price. Common and rare both follow the controls above.
            </p>
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {CATEGORIES.map((category) => (
                <li key={category.value} className="flex items-baseline justify-between gap-3 py-3">
                  <span>{category.label}</span>
                  <span className="text-right text-sm text-muted tabular-nums">
                    {mark(category.value, "common")}% common
                    <span className="mt-0.5 block">{mark(category.value, "rare")}% rare</span>
                  </span>
                </li>
              ))}
            </ul>
          </Fold>

          <Fold title="Open shops" hint="Recalculate shop prices when the modifiers change.">
            <Switch
              label="Update open shops when prices change"
              hint="Shop prices are recalculated when you release a slider or choose a modifier."
              checked={prefs.repriceOnRealm}
              onChange={(repriceOnRealm) => setPrefs({ repriceOnRealm })}
            />
            <Button className="mt-2" variant="secondary" onClick={() => void setRealm(draftRef.current, { reprice: true })}>
              Reprice open shops now
            </Button>
          </Fold>

          <Fold title="Defaults for the next shop" hint="Wealth, stock, and prices used when you create a shop.">
            <p className="mt-2 text-sm text-muted">
              Used by New shop and by Create a shop. Which rarities to stock, and how full the shop is, apply only when you create a shop.
            </p>
            <div className="mt-4">
              <ChoiceGrid
                label="Wealth"
                value={prefs.defaultWealth}
                options={WEALTHS}
                onChange={(defaultWealth: Wealth) => setPrefs({ defaultWealth })}
              />
            </div>
            <fieldset className="mt-4">
              <legend className="mb-2 text-sm font-medium">What a new shop stocks</legend>
              <div className="flex flex-wrap gap-2">
                {RARITIES.map((rarity) => {
                  const key = carryKey(rarity.value);
                  return (
                    <ToggleButton key={rarity.value} pressed={prefs[key]} onClick={() => setPrefs({ [key]: !prefs[key] })}>
                      {rarity.label}
                    </ToggleButton>
                  );
                })}
              </div>
            </fieldset>
            <div className="mt-3 flex flex-col gap-1">
              <Slider
                label="Sticker scale"
                min={0.5}
                max={2.5}
                step={0.05}
                value={prefs.defaultScale}
                onChange={(defaultScale) => setPrefs({ defaultScale })}
                display={`${Math.round(prefs.defaultScale * 100)}%`}
              />
              <Slider
                label="How full"
                min={0.4}
                max={1.6}
                step={0.1}
                value={prefs.defaultDepth}
                onChange={(defaultDepth) => setPrefs({ defaultDepth })}
                display={percent(prefs.defaultDepth)}
              />
              <Slider
                label="Sells at"
                min={0.5}
                max={2}
                step={0.05}
                value={prefs.defaultSell}
                onChange={(defaultSell) => setPrefs({ defaultSell })}
                display={`${Math.round(prefs.defaultSell * 100)}%`}
              />
              <Slider
                label="Buys at"
                min={0.1}
                max={1}
                step={0.05}
                value={prefs.defaultBuy}
                onChange={(defaultBuy) => setPrefs({ defaultBuy })}
                display={`${Math.round(prefs.defaultBuy * 100)}%`}
              />
            </div>
          </Fold>

          <Fold title="Colors" hint="Light or dark, a ready-made look, or your own colors.">
            <p className="mt-2 text-sm text-muted">Light or dark, a ready-made look, or your own accent and page color.</p>
            <div className="mt-4">
              <ChoiceGrid
                label="Mode"
                value={prefs.appearance}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                ]}
                onChange={(appearance) => {
                  const pale = luminance(prefs.ground) >= 0.55;
                  if (appearance === "light" && !pale) setPrefs({ appearance, ground: "#f6f1e6" });
                  else if (appearance === "dark" && pale) setPrefs({ appearance, ground: DEFAULT_GROUND });
                  else setPrefs({ appearance });
                }}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Looks">
              {LOOKS.map((look) => {
                const on = prefs.appearance === look.appearance && prefs.accent === look.accent && prefs.ground === look.ground;
                return (
                  <ToggleButton
                    key={look.id}
                    pressed={on}
                    onClick={() => setPrefs({ appearance: look.appearance, accent: look.accent, ground: look.ground })}
                  >
                    <span className="mr-2 inline-flex gap-1 align-middle">
                      <span className="inline-block size-3 rounded-full border border-black/20" style={{ background: look.ground }} />
                      <span className="inline-block size-3 rounded-full border border-black/20" style={{ background: look.accent }} />
                    </span>
                    {look.label}
                  </ToggleButton>
                );
              })}
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
                Accent
                <input
                  type="color"
                  aria-label="Accent color"
                  value={prefs.accent}
                  onChange={(event) => setPrefs({ accent: event.target.value })}
                  className="h-11 w-16 cursor-pointer rounded-sm border border-border bg-transparent"
                />
              </label>
              <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
                Page
                <input
                  type="color"
                  aria-label="Page color"
                  value={prefs.ground}
                  onChange={(event) => {
                    const ground = event.target.value;
                    setPrefs({ ground, appearance: luminance(ground) < 0.55 ? "dark" : "light" });
                  }}
                  className="h-11 w-16 cursor-pointer rounded-sm border border-border bg-transparent"
                />
              </label>
            </div>
            <Button className="mt-3" variant="secondary" onClick={() => setPrefs({ appearance: "dark", accent: DEFAULT_ACCENT, ground: DEFAULT_GROUND })}>
              Restore glass colors
            </Button>
          </Fold>

          <Fold title="Display" hint="Dollars, type size, and how many recent entries to show.">
            <Switch
              label="Show a modern dollar reading"
              hint="Prices stay in copper, silver, and gold. Dollars are only a comparison for one gold piece."
              checked={prefs.showDollars}
              onChange={(showDollars) => setPrefs({ showDollars })}
            />
            <Switch
              label="Ask before removing a line"
              hint="Applies to purses, items, index entries, names, and single shop lines. Deleting a whole shop always asks."
              checked={prefs.confirmRemoves}
              onChange={(confirmRemoves) => setPrefs({ confirmRemoves })}
            />
            <Switch
              label="Read entries on a dark page"
              hint="Changes the article page only. Off is a light page. On is a dark page."
              checked={prefs.nightReading}
              onChange={(nightReading) => setPrefs({ nightReading })}
            />
            <div className="mt-2">
              <Slider
                label="Type size"
                min={0}
                max={3}
                step={1}
                value={prefs.readScale}
                onChange={(readScale) => setPrefs({ readScale })}
                display={READ_LABELS[Math.round(prefs.readScale)] ?? "Usual"}
              />
              <Slider
                label="Recent entries on the desk"
                min={4}
                max={24}
                step={1}
                value={prefs.ledgerRows}
                onChange={(ledgerRows) => setPrefs({ ledgerRows })}
                display={String(Math.round(prefs.ledgerRows))}
              />
              <Slider
                label="Goods invented at a time"
                min={1}
                max={12}
                step={1}
                value={prefs.inventCount}
                onChange={(inventCount) => setPrefs({ inventCount })}
                display={String(Math.round(prefs.inventCount))}
              />
            </div>
          </Fold>

          <Fold title="Start over" hint="Reset modifiers, display settings, or this whole campaign.">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setResetting(true)}>
                Reset price modifiers
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  resetPrefs();
                  toast.success("Shop defaults, reading options, and colors were reset. Price modifiers were not changed.");
                }}
              >
                Reset shop, reading, and colors
              </Button>
            </div>
            <p className="mt-4 max-w-prose text-sm text-muted">
              Returns this campaign to the starter data: the sample shop, the sample purses, the starter item list, and the default price modifiers. Other campaigns are not changed. Display settings return to their defaults.
            </p>
            <Button variant="danger" className="mt-4" onClick={() => setWiping(true)}>
              Reset everything
            </Button>
          </Fold>
          <Campaigns />
        </>
      ) : null}
      <Confirm
        open={resetting}
        onOpenChange={setResetting}
        title="Reset price modifiers?"
        body="Season, shortage, war, plague, roads, scarcity, inflation, and the dollar comparison return to their defaults. Open shops change only if updating them is turned on."
        confirmLabel="Reset"
        onConfirm={() => {
          const next = { ...DEFAULT_REALM };
          setDraft(next);
          void setRealm(next, { reprice: prefs.repriceOnRealm });
        }}
      />
      <Confirm
        open={wiping}
        onOpenChange={setWiping}
        title="Reset everything?"
        body="This campaign's shops, purses, ledger, index, names, and imported PDFs are deleted. Other campaigns are not changed. Display settings and this campaign's price modifiers return to their defaults."
        confirmLabel="Reset everything"
        onConfirm={() => {
          void resetAll()
            .then(async () => {
              resetPrefs();
              setDraft({ ...DEFAULT_REALM });
              await reloadLibrary();
              toast.success("This campaign was reset to the starter data.");
            })
            .catch(() => toast.error("This campaign could not be reset."));
        }}
      />
    </Shell>
  );
}

function carryKey(
  rarity: (typeof RARITIES)[number]["value"],
): keyof Pick<AppPrefs, "carryCommon" | "carryUncommon" | "carryRare" | "carryMagic"> {
  if (rarity === "common") return "carryCommon";
  if (rarity === "uncommon") return "carryUncommon";
  if (rarity === "rare") return "carryRare";
  return "carryMagic";
}

function RealmBand({
  label,
  low,
  mid,
  high,
  value,
  onPick,
  onSlide,
  onCommit,
}: {
  label: string;
  low: string;
  mid: string;
  high: string;
  value: number;
  onPick: (value: number) => void;
  onSlide: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  return (
    <div className="mt-4 border-t border-border pt-4">
      <ChoiceGrid
        label={label}
        value={bandOf(value)}
        options={[
          { value: 0, label: low },
          { value: 1, label: mid },
          { value: 2, label: high },
        ]}
        onChange={onPick}
      />
      <div className="mt-2">
        <Slider label={`${label} amount`} min={0} max={2} step={0.05} value={value} onChange={onSlide} onCommit={onCommit} display={percent(value)} />
      </div>
    </div>
  );
}
