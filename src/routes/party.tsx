import { CharacterPlacement } from "@/components/character-placement";
import { inParty } from "@/lib/quire/character-position";
import { CharacterPermissions } from "@/components/character-permissions";
import { toast } from "sonner";
import { Open5eBrowser } from "@/components/open5e-browser";
import { AppLink } from "@/components/app-link";
import { useSheetReadouts, HpBar } from "@/components/control-panel/readouts";
import { Shield, Backpack } from "lucide-react";
import { LedgerArt, PortraitPicker } from "@/components/ledger-art";
import { PartyInventory } from "@/components/party-inventory";
import { useGiveRecipients } from "@/lib/quire/use-give-recipients";
import { getCloudTable } from "@/lib/quire/cloud-client";
import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useCommandId, useEconomy } from "@/lib/quire/economy-context";
import {
  carryUpTo,
  explainPurse,
  formatCoins,
  formatCopper,
  parsePrice,
  toCopper,
} from "@/lib/quire/money";
import type { Coins, Holding } from "@/lib/quire/types";
import { useDollarText } from "@/lib/quire/prefs";
import { useSeat } from "@/lib/quire/seat";
import { characterControl, type Purse } from "@/lib/quire/types";
import { Shell } from "@/components/shell";
import { CharacterSheetPanel } from "@/components/character-sheet";
import { Button, Field, Modal, Segmented, TextInput } from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { RemoveButton } from "@/components/quire-ui";
import { SplitCoins } from "@/components/coin-split";
import { TreasurePool, usePoolCount } from "@/components/treasure-pool";
import { FairnessLedger } from "@/components/fairness-ledger";
import { partyFunds } from "@/lib/quire/coin-split";
import { PartyGroupsPanel, PlayerGroupCard, SplitPartyButton } from "@/components/party-groups";

export const Route = createFileRoute("/party")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    action?: string;
    section?: "funds" | "characters" | "pool" | "fairness";
    period?: string;
    character?: string;
  } => ({
    action:
      search.action === "add" ||
      search.action === "give" ||
      search.action === "pay" ||
      search.action === "split"
        ? search.action
        : "",
    ...(search.section === "funds" ||
    search.section === "characters" ||
    search.section === "pool" ||
    search.section === "fairness"
      ? { section: search.section }
      : {}),
    // Fairness (phase 3): the period and the character whose receipts are open.
    ...(typeof search.period === "string" && search.period.length <= 150 ? { period: search.period } : {}),
    ...(typeof search.character === "string" && search.character.length <= 150
      ? { character: search.character }
      : {}),
  }),
  component: PartyPage,
});

function PartyPage() {
  const economy = useEconomy();
  const profiles = useSheetReadouts();
  const [managed, setManaged] = useState("");
  const partyTable = { purses: economy.purses, journal: economy.journal };
  const [section, setSection] = useState("characters");
  const {
    action: initialAction,
    section: requestedSection,
    period: fairPeriod = "campaign",
    character: fairCharacter,
  } = Route.useSearch();
  const navigate = Route.useNavigate();
  // Router hash (not the window's) so this also works in a split-view pane.
  const hash = useRouterState({ select: (s) => s.location.hash });
  useEffect(() => {
    if (requestedSection === "funds" || initialAction || hash.startsWith("purse-"))
      setSection("funds");
    else if (requestedSection === "characters") setSection("characters");
    else if (requestedSection === "pool" || hash === "treasure-pool") setSection("pool");
    else if (requestedSection === "fairness") setSection("fairness");
  }, [requestedSection, initialAction, hash]);
  const [action, setAction] = useState(initialAction ?? "");
  // Give from an inventory row: that holder and item are chosen when the dialog opens.
  const [giveFrom, setGiveFrom] = useState<Holding | null>(null);
  useEffect(() => setAction(initialAction ?? ""), [initialAction]);
  const seat = useSeat();
  const cloud = getCloudTable();
  const readOnly = seat.role === "player" || (cloud.joined && !cloud.mine);
  // Split runs on the DM's device or in a shared room; a player-only device link holds only part
  // of the party, so it is not offered there (owner decision, phase 1).
  const canSplit = seat.role === "dm" || cloud.joined;
  const [splitSource, setSplitSource] = useState("");
  const poolCount = usePoolCount();
  // Party sections: the DM's Characters / Funds & inventory, and the treasure pool for everyone.
  // Short, non-wrapping labels (design plan P10) so the pool's count sits inside its own tab.
  // The accessible name keeps the full name where the visible label is shorter.
  const tabs: Array<[string, string, string?]> = [
    ...(seat.role === "dm" ? ([["characters", "Characters"]] as Array<[string, string]>) : []),
    seat.role === "dm" ? ["funds", "Funds & inventory"] : ["funds", "Inventory", "Inventory & purse"],
    ["pool", "Pool", poolCount > 0 ? `Treasure pool, ${poolCount} lot${poolCount === 1 ? "" : "s"}` : "Treasure pool"],
    ["fairness", "Fairness"],
  ];
  const shownSection = seat.role !== "dm" && section === "characters" ? "funds" : section;
  const visible =
    seat.role === "player"
      ? economy.purses.filter((purse) => seat.purseIds.includes(purse.id))
      : economy.purses.filter((p) => inParty(partyTable, p));
  const coin = visible.reduce((sum, purse) => sum + toCopper(purse.coins), 0);
  const goods = economy.holdings
    .filter((holding) => visible.some((purse) => purse.id === holding.purseId))
    .reduce((sum, holding) => sum + holding.unitCopper * holding.quantity, 0);

  return (
    <Shell>
      <div className="flex items-center justify-between gap-3">
        <div>
          {/* Glossary: players see "Party & inventory" (the nav label too); DMs keep "Party". */}
          <p className="eyebrow">{seat.role === "dm" ? "Party overview" : "Party & inventory"}</p>
          <h1 className="font-display text-4xl tracking-tight">
            {seat.role === "dm" ? "Party" : "Inventory & purse"}
          </h1>
        </div>
        {/* Add loot is the DM's; players never see a control they cannot use (P6). */}
        {seat.role === "dm" ? (
          <div className="flex flex-wrap justify-end gap-2">
            {!readOnly && <SplitPartyButton />}
            <Button
              disabled={!economy.ready || visible.length === 0 || readOnly}
              title={readOnly ? `Add loot when it is your turn.` : undefined}
              onClick={() => {
                setSection("funds");
                setAction("add");
              }}
            >
              + Add loot
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div
          className={`mode-switch party-sections ${tabs.length === 4 ? "is-four" : "is-three"}`}
          role="tablist"
          aria-label="Party sections"
        >
          {tabs.map(([k, label, name], index) => (
            <button
              type="button"
              id={`party-tab-${k}`}
              role="tab"
              aria-selected={shownSection === k}
              aria-controls={`party-panel-${k}`}
              aria-label={name}
              tabIndex={shownSection === k ? 0 : -1}
              key={k}
              onClick={() => setSection(k)}
              onKeyDown={(event) => {
                const next =
                  event.key === "Home"
                    ? tabs[0]![0]
                    : event.key === "End"
                      ? tabs.at(-1)![0]
                      : event.key === "ArrowRight"
                        ? tabs[(index + 1) % tabs.length]![0]
                        : event.key === "ArrowLeft"
                          ? tabs[(index - 1 + tabs.length) % tabs.length]![0]
                          : undefined;
                if (!next) return;
                event.preventDefault();
                setSection(next);
                document.getElementById(`party-tab-${next}`)?.focus();
              }}
            >
              {label}
              {k === "fairness" ? <span className="fair-new">New</span> : null}
              {k === "pool" && poolCount > 0 ? (
                <span className="loot-count" aria-hidden="true">
                  {poolCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {seat.role === "dm" && (
          <AppLink href={seat.role === "dm" ? "/features/reports" : "/features/finances"}>
            Ledger
          </AppLink>
        )}
      </div>
      <div
        id="party-panel-fairness"
        role="tabpanel"
        aria-labelledby="party-tab-fairness"
        hidden={shownSection !== "fairness"}
        tabIndex={0}
      >
        {shownSection === "fairness" && (
          <FairnessLedger
            period={fairPeriod}
            character={fairCharacter}
            onPeriod={(period) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  section: "fairness" as const,
                  period: period === "campaign" ? undefined : period,
                }),
                replace: true,
              })
            }
          />
        )}
      </div>
      <div
        id="party-panel-pool"
        role="tabpanel"
        aria-labelledby="party-tab-pool"
        hidden={shownSection !== "pool"}
        tabIndex={0}
      >
        {shownSection === "pool" && (
          <TreasurePool
            onAddLoot={
              readOnly
                ? undefined
                : () => {
                    setSection("funds");
                    setAction("add");
                  }
            }
            onAddFund={() => void economy.createPurse("party")}
          />
        )}
      </div>
      {seat.role === "player" && <PlayerGroupCard />}
      {seat.role === "dm" && shownSection === "characters" && (
        <PartyGroupsPanel
          onPlacement={(id) => {
            setManaged(id);
            document.getElementById("character-placement")?.scrollIntoView({ block: "start" });
          }}
        />
      )}
      {seat.role === "dm" && shownSection === "characters" && <CharacterPlacement selectedId={managed} />}
      {seat.role === "dm" && (
        <div
          className="party-profile-list"
          id="party-panel-characters"
          role="tabpanel"
          aria-labelledby="party-tab-characters"
          hidden={shownSection !== "characters"}
          tabIndex={0}
        >
          {visible
            .filter((p) => p.kind === "character")
            .map((p) => {
              const live = profiles.find((r) => r.purse_id === p.id),
                old = economy.sheets.find((r) => r.purseId === p.id);
              return (
                <article key={p.id} className="party-profile">
                  <LedgerArt kind="portrait" src={live?.body.portrait || p.portrait} />
                  <div className="party-profile-body">
                    <h2>{p.name}</h2>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setManaged(p.id);
                        document
                          .getElementById("character-placement")
                          ?.scrollIntoView({ block: "start" });
                      }}
                    >
                      Manage placement & downtime
                    </Button>
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={p.editingAllowed === true}
                        disabled={readOnly}
                        onChange={(e) =>
                          void economy
                            .command({
                              kind: "character-editing",
                              purseId: p.id,
                              allowed: e.target.checked,
                            })
                            .catch((error) => toast.error(error.message))
                        }
                      />
                      Allow character editing
                    </label>
                    <CharacterPermissions purse={p} />
                    <p>
                      {live && p.sheet
                        ? `Level ${live.body.level}${live.body.classes ? ` · ${live.body.classes}` : ""}`
                        : old?.classLevel || "Character"}
                    </p>
                    <div className="party-hp">
                      {live?.body.maxHp
                        ? `${live.body.hp} / ${live.body.maxHp} HP`
                        : old?.hitPoints
                          ? `${old.hitPoints} HP · imported sheet`
                          : "HP not recorded"}
                      <span>
                        <Shield size={15} /> {live?.body.ac || old?.armorClass || "—"}
                      </span>
                    </div>
                    {!!live?.body.maxHp && <HpBar hp={live.body.hp} max={live.body.maxHp} />}
                    <div className="party-profile-actions">
                      {live ? (
                        <AppLink
                          href={`/characters?id=${encodeURIComponent(live.id)}`}
                          className="gold-link"
                        >
                          Open sheet
                        </AppLink>
                      ) : (
                        <a
                          href={`#purse-${p.id}`}
                          onClick={() => {
                            setSection("funds");
                            setTimeout(() => {
                              const el = document.getElementById(
                                `purse-${p.id}`,
                              ) as HTMLDetailsElement | null;
                              if (el) {
                                el.open = true;
                                el.scrollIntoView();
                              }
                            }, 50);
                          }}
                          className="gold-link"
                        >
                          Imported sheet
                        </a>
                      )}
                      <a
                        href={`#purse-${p.id}`}
                        onClick={() => {
                          setSection("funds");
                          setTimeout(() => {
                            const el = document.getElementById(
                              `purse-${p.id}`,
                            ) as HTMLDetailsElement | null;
                            if (el) {
                              el.open = true;
                              el.scrollIntoView();
                            }
                          }, 50);
                        }}
                      >
                        <Backpack size={15} />
                        Inventory
                      </a>
                    </div>
                  </div>
                </article>
              );
            })}
          <AppLink href="/share" className="settings-link">
            Manage members & permissions →
          </AppLink>
          <AppLink href="/characters" className="settings-link">
            Account character sheets & rolls →
          </AppLink>
          <button className="gold-link" onClick={() => setSection("funds")}>
            Add characters, party funds & loot
          </button>
        </div>
      )}
      <div
        id="party-panel-funds"
        role="tabpanel"
        aria-labelledby="party-tab-funds"
        hidden={shownSection !== "funds"}
        tabIndex={0}
      >
        {!economy.ready ? <p className="mt-6 text-muted">Loading…</p> : null}
        {economy.ready ? (
          <>
            <section className="wealth-card mt-5 rounded-2xl border border-lead/25 bg-elevated p-5">
              <p className="text-xs tracking-[0.16em] text-faint uppercase">Combined wealth</p>
              <p className="mt-1 font-display text-4xl tracking-tight text-lead">
                {formatCopper(coin + goods)}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <span>
                  <span className="block text-xs text-faint">Coin</span>
                  {formatCopper(coin)}
                </span>
                <span>
                  <span className="block text-xs text-faint">Items</span>
                  {formatCopper(itemValue(economy.holdings, visible, "item"))}
                </span>
                <span>
                  <span className="block text-xs text-faint">Property</span>
                  {formatCopper(itemValue(economy.holdings, visible, "property"))}
                </span>
              </div>
            </section>
            {seat.role !== "dm" && visible.length ? (
              <PurseStrip
                purses={visible}
                canSplit={canSplit}
                onGive={() => {
                  setGiveFrom(null);
                  setAction("give");
                }}
                onSplit={() => {
                  setSplitSource("");
                  setAction("split");
                }}
              />
            ) : null}
            <PartyInventory
              purses={visible}
              readOnly={readOnly}
              onGive={(holding) => {
                setGiveFrom(holding);
                setAction("give");
              }}
            />
            {!visible.length && seat.role === "player" && (
              <p className="inventory-empty">
                No character assigned on this device.{" "}
                <AppLink href="/share">Open your campaign to choose a character →</AppLink>
              </p>
            )}
            <Disclosure variant="section" className="inventory-management" open={seat.role === "dm" || undefined} summary="Wallets, transfers & property">
              <h2 className="mt-5 text-sm font-medium text-muted">Members · {visible.length}</h2>
              <ul className="mt-1 divide-y divide-border border-y border-border">
                {visible.map((purse) => {
                  const worth =
                    toCopper(purse.coins) +
                    economy.holdings
                      .filter((holding) => holding.purseId === purse.id)
                      .reduce((sum, holding) => sum + holding.unitCopper * holding.quantity, 0);
                  return (
                    <li key={purse.id} className="coin-split-fund-row">
                      <a
                        onClick={() => {
                          const detail = document.getElementById(`purse-${purse.id}`);
                          if (detail instanceof HTMLDetailsElement) detail.open = true;
                        }}
                        href={`#purse-${purse.id}`}
                        className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 text-sm"
                      >
                        <span className="flex min-w-0 items-center gap-3 py-2">
                          <LedgerArt kind="portrait" src={purse.portrait} className="round" />
                          <span className="min-w-0 break-words">{purse.name}</span>
                        </span>
                        <span className="tabular-nums text-lead">{formatCopper(worth)}</span>
                      </a>
                      {purse.kind === "party" && canSplit ? (
                        <Button
                          variant="secondary"
                          className="min-h-11 shrink-0 px-3 text-sm"
                          aria-label={`Split coins from ${purse.name}`}
                          title={toCopper(purse.coins) ? undefined : "This fund has no coins to split"}
                          disabled={!toCopper(purse.coins)}
                          onClick={() => {
                            setSplitSource(purse.id);
                            setAction("split");
                          }}
                        >
                          Split
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {seat.role === "dm" && economy.loans.some((loan) => loan.status === "pending") ? (
                <section className="mt-4">
                  <h2 className="text-sm font-medium text-muted">Pending</h2>
                  <ul>
                    {economy.loans
                      .filter((loan) => loan.status === "pending")
                      .map((loan) => (
                        <li
                          key={loan.id}
                          className="flex items-baseline justify-between gap-3 border-b border-border/70 py-2 text-sm"
                        >
                          <span>{loan.purseName} · loan</span>
                          <span className="tabular-nums text-lead">
                            {formatCopper(loan.copper)}
                          </span>
                        </li>
                      ))}
                  </ul>
                </section>
              ) : null}
              <p className="mt-1 text-sm text-muted">
                10 copper = 1 silver. 10 silver = 1 gold. 10 gold = 1 platinum. Electrum is half a
                gold.
              </p>
              {seat.role === "dm" ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => void economy.createPurse("character")}>
                    Add character
                  </Button>
                  <Button variant="secondary" onClick={() => void economy.createPurse("party")}>
                    Add party fund
                  </Button>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  You can spend only the characters on your link. You can give coins or holdings to
                  the other players named on that link.
                </p>
              )}
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {visible.map((purse) => (
                  <details
                    key={purse.id}
                    id={`purse-${purse.id}`}
                    className="member-detail rounded-xl border border-lead/20 bg-elevated"
                  >
                    <summary className="flex min-h-14 cursor-pointer items-center justify-between p-4">
                      <span>{purse.name}</span>
                      <span className="text-sm text-lead">Manage funds +</span>
                    </summary>
                    <PurseCard purse={purse} />
                  </details>
                ))}
              </div>

              {/* Players have Give and Split in the purse strip above; Add loot and Payment are
                  the DM's direct edits. */}
              {seat.role === "dm" ? (
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  onClick={() => setAction("add")}
                  disabled={visible.length === 0 || readOnly}
                >
                  Add loot
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setGiveFrom(null);
                    setAction("give");
                  }}
                  disabled={visible.length === 0}
                >
                  Give
                </Button>
                {canSplit ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSplitSource("");
                      setAction("split");
                    }}
                    disabled={visible.length === 0}
                  >
                    Split coins
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  onClick={() => setAction("pay")}
                  disabled={visible.length === 0 || readOnly}
                >
                  Payment
                </Button>
              </div>
              ) : null}
            </Disclosure>
            <Modal
              open={action !== ""}
              onOpenChange={(open) => {
                if (!open) {
                  setAction("");
                  setGiveFrom(null);
                }
              }}
              title={
                action === "add"
                  ? "Add loot"
                  : action === "give"
                    ? "Give to a player"
                    : action === "split"
                      ? "Split coins"
                      : "Record a payment"
              }
            >
              {action === "split" ? (
                <SplitCoins
                  sources={visible}
                  initialSourceId={splitSource}
                  onDone={() => setAction("")}
                />
              ) : readOnly && action !== "give" ? (
                <p>
                  Only the DM can directly edit funds and inventory in shared modes. Use Buy, Sell,
                  Give, or Request loan.
                </p>
              ) : action === "add" ? (
                <AddHolding purses={visible} />
              ) : action === "give" ? (
                <GiveToPlayer
                  key={giveFrom?.id ?? "give"}
                  purses={visible}
                  initialFromId={giveFrom?.purseId}
                  initialHoldingId={giveFrom?.id}
                />
              ) : (
                <Payment purses={visible} />
              )}
            </Modal>
          </>
        ) : null}
      </div>
    </Shell>
  );
}

/** Player purse strip (P6): coins by denomination with Give and Split, under Combined wealth. */
function PurseStrip({
  purses,
  canSplit,
  onGive,
  onSplit,
}: {
  purses: Purse[];
  canSplit: boolean;
  onGive: () => void;
  onSplit: () => void;
}) {
  const units: Array<[keyof Coins, string]> = [
    ["pp", "platinum"],
    ["gp", "gold"],
    ["ep", "electrum"],
    ["sp", "silver"],
    ["cp", "copper"],
  ];
  const total = (unit: keyof Coins) => purses.reduce((sum, purse) => sum + purse.coins[unit], 0);
  return (
    <section className="purse-strip" aria-label="Coins">
      {purses.length > 1 ? (
        <span className="purse-strip-name">{purses.map((purse) => purse.name).join(" · ")}</span>
      ) : null}
      <ul className="purse-strip-coins">
        {units.map(([unit, name]) => (
          <li key={unit}>
            <strong>{total(unit).toLocaleString()}</strong>
            <abbr title={name}>{unit}</abbr>
          </li>
        ))}
      </ul>
      <span className="purse-strip-actions">
        <Button variant="secondary" onClick={onGive}>
          Give
        </Button>
        {canSplit ? (
          <Button variant="secondary" onClick={onSplit} disabled={!purses.some((p) => toCopper(p.coins))}>
            Split
          </Button>
        ) : null}
      </span>
    </section>
  );
}

function PurseCard({ purse }: { purse: Purse }) {
  const { updatePurse, setPurseCoins, deletePurse } = useEconomy();
  const seat = useSeat();
  const cloud = getCloudTable();
  const readOnly = seat.role === "player" || (cloud.joined && !cloud.mine);
  const dollars = useDollarText();
  const [coins, setCoins] = useState(purse.coins);
  const purseDollars = dollars(toCopper(purse.coins));
  const worth = toCopper(coins);
  const worthNote = explainPurse(coins);
  const intoSilver = carryUpTo(coins, "sp");
  const intoGold = carryUpTo(coins, "gp");
  const intoPlatinum = carryUpTo(coins, "pp");
  const changed = (next: typeof coins) =>
    next.cp !== coins.cp ||
    next.sp !== coins.sp ||
    next.ep !== coins.ep ||
    next.gp !== coins.gp ||
    next.pp !== coins.pp;

  useEffect(() => {
    setCoins(purse.coins);
  }, [purse.coins]);

  return (
    <section className="rounded-xl border border-lead/25 bg-elevated p-4">
      <PortraitPicker purse={purse} />
      <fieldset disabled={readOnly}>
        <TextInput
          aria-label="Funds name"
          defaultValue={purse.name}
          key={purse.name}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name && name !== purse.name) void updatePurse({ ...purse, name });
          }}
          className="font-display text-2xl"
        />
        <p className="mt-1 text-sm text-muted">
          {purse.kind === "party"
            ? "Party account"
            : characterControl(purse) === "npc"
              ? "NPC"
              : "Player"}{" "}
          · {formatCoins(purse.coins)}
          {purseDollars ? ` · ${purseDollars}` : ""}
        </p>
        {purse.kind === "character" && seat.role === "dm" ? (
          <div className="mt-3">
            <Segmented
              label="Who controls this character"
              value={characterControl(purse) ?? "player"}
              options={[
                { value: "player", label: "Player" },
                { value: "npc", label: "NPC" },
              ]}
              onChange={(control) => void updatePurse({ ...purse, control })}
            />
          </div>
        ) : null}
        <p className="mt-2 text-sm tabular-nums">Worth {formatCopper(worth)}</p>
        {worthNote ? <p className="mt-1 text-sm text-muted">{worthNote}</p> : null}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(
            [
              ["gp", "Gold"],
              ["sp", "Silver"],
              ["cp", "Copper"],
            ] as const
          ).map(([unit, label]) => (
            <label key={unit} className="text-xs text-muted">
              {label}
              <input
                aria-label={label}
                inputMode="numeric"
                value={coins[unit]}
                onChange={(event) =>
                  setCoins((current) => ({
                    ...current,
                    [unit]: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                  }))
                }
                className="mt-1 min-h-11 w-full rounded-sm border border-border bg-subtle px-2 text-center text-base text-fg"
              />
            </label>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(
            [
              ["pp", "Platinum", "10 gp each"],
              ["ep", "Electrum", "5 sp, half a gold"],
            ] as const
          ).map(([unit, label, hint]) => (
            <label key={unit} className="text-xs text-muted">
              {label}
              <span className="mt-0.5 block text-faint">{hint}</span>
              <input
                aria-label={label}
                inputMode="numeric"
                value={coins[unit]}
                onChange={(event) =>
                  setCoins((current) => ({
                    ...current,
                    [unit]: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                  }))
                }
                className="mt-1 min-h-11 w-full rounded-sm border border-border bg-subtle px-2 text-center text-base text-fg"
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void setPurseCoins(purse.id, coins)}>
            Set coins
          </Button>
          {changed(intoSilver) ? (
            <Button
              variant="secondary"
              onClick={() => {
                setCoins(intoSilver);
                void setPurseCoins(purse.id, intoSilver);
              }}
            >
              Convert to silver
            </Button>
          ) : null}
          {changed(intoGold) ? (
            <Button
              variant="secondary"
              onClick={() => {
                setCoins(intoGold);
                void setPurseCoins(purse.id, intoGold);
              }}
            >
              Convert to gold
            </Button>
          ) : null}
          {changed(intoPlatinum) ? (
            <Button
              variant="secondary"
              onClick={() => {
                setCoins(intoPlatinum);
                void setPurseCoins(purse.id, intoPlatinum);
              }}
            >
              Convert to platinum
            </Button>
          ) : null}
          {seat.role === "dm" ? (
            <RemoveButton
              label="Remove account"
              title={`Remove ${purse.name}?`}
              body="This account and its holdings are deleted. Transaction history is retained."
              onRemove={() => void deletePurse(purse.id)}
            />
          ) : null}
        </div>
      </fieldset>
      {readOnly ? (
        <p className="mt-2 text-sm text-muted">
          Direct fund edits are managed by the DM in shared modes.
        </p>
      ) : null}
      {purse.kind === "character" ? <CharacterSheetPanel purseId={purse.id} /> : null}
    </section>
  );
}

function itemValue(
  holdings: {
    purseId: string;
    kind: string;
    unitCopper: number;
    quantity: number;
  }[],
  purses: { id: string }[],
  kind: "item" | "property",
) {
  const ids = new Set(purses.map((purse) => purse.id));
  return holdings
    .filter((holding) => ids.has(holding.purseId) && holding.kind === kind)
    .reduce((sum, holding) => sum + holding.unitCopper * holding.quantity, 0);
}

function AddHolding({ purses }: { purses: Purse[] }) {
  const { addHolding, journal } = useEconomy();
  const [pool, setPool] = useState(false);
  const [purseId, setPurseId] = useState(purses[0]?.id ?? "");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"item" | "property">("item");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const [source, setSource] = useState<"custom" | "open5e">("custom");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!purses.some((purse) => purse.id === purseId)) setPurseId(purses[0]?.id ?? "");
  }, [purses, purseId]);
  // Treasure pool (prompt 2, phase 2): offered only when the owner is a party fund.
  const fund = partyFunds({ purses, journal }).some((p) => p.id === purseId);
  const poolable = fund && kind === "item";

  return (
    <>
      <Segmented
        label="Loot source"
        value={source}
        onChange={setSource}
        options={[
          { value: "custom", label: "Custom loot" },
          { value: "open5e", label: "Open5e loot" },
        ]}
      />
      {source === "open5e" && (
        <Open5eBrowser
          onSelect={(item) => {
            setName(item.name);
            setKind("item");
            setPrice(formatCopper(item.baseCopper));
            setNotes(item.notes);
            setCategory(item.category);
            setSource("custom");
            setError("");
          }}
        />
      )}
      {source === "custom" && (
        <form
          className="mt-4 flex flex-col gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (saving) return;
            const copper = parsePrice(price),
              quantity = Number(qty);
            if (
              !purseId ||
              !name.trim() ||
              copper === null ||
              !Number.isSafeInteger(quantity) ||
              quantity < 1
            ) {
              setError("Enter a name, value, recipient, and a positive whole-number quantity.");
              return;
            }
            setSaving(true);
            setError("");
            try {
              await addHolding(purseId, name.trim(), kind, quantity, copper, {
                notes,
                category,
                ...(poolable && pool ? { pool: true } : {}),
              });
              setName("");
              setPrice("");
              setNotes("");
              setCategory("");
              setQty("1");
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not add loot. Your draft has been kept.",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          <Segmented
            label="Holding kind"
            value={kind}
            onChange={setKind}
            options={[
              { value: "item", label: "Item" },
              { value: "property", label: "Property" },
            ]}
          />
          {/* Visible labels, so a filled field keeps its meaning (WCAG 3.3.2); the accessible
              names stay "Holding …" and contain the visible label. */}
          <Field label="Name">
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Holding name"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Value" hint="Each, for example 80 gp.">
              <TextInput
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="80 gp"
                aria-label="Holding value"
              />
            </Field>
            <Field label="Quantity">
              <TextInput
                value={qty}
                onChange={(event) => setQty(event.target.value)}
                inputMode="numeric"
                aria-label="Holding quantity"
              />
            </Field>
          </div>
          <Field label="Owner">
            <select
              aria-label="Holding owner"
              value={purseId}
              onChange={(event) => setPurseId(event.target.value)}
              className="min-h-11 w-full rounded-sm border border-border bg-subtle px-3 text-base text-fg"
            >
              {purses.map((purse) => (
                <option key={purse.id} value={purse.id}>
                  {purse.name}
                </option>
              ))}
            </select>
          </Field>
          {poolable ? (
            <label className={`coin-split-rule${pool ? " is-selected" : ""}`}>
              <input type="checkbox" checked={pool} onChange={(e) => setPool(e.target.checked)} />
              <span>
                <strong>Put in the treasure pool</strong>
              </span>
              <small>
                The party can mark Need, Greed or Pass. It stays in the party fund until you resolve
                it in Review Inbox.
              </small>
            </label>
          ) : !partyFunds({ purses, journal }).length ? (
            <p className="text-sm text-muted">
              The treasure pool lives in a party fund. This campaign has none, so “Put in the
              treasure pool” is not offered.
            </p>
          ) : null}
          <Field label="Category" hint="Optional.">
            <TextInput
              aria-label="Holding category"
              value={category}
              maxLength={80}
              onChange={(event) => setCategory(event.target.value)}
            />
          </Field>
          <label className="text-sm">
            Notes & source
            <textarea
              aria-label="Holding notes"
              className="w-full min-h-24 rounded-sm border border-border bg-subtle p-3 text-fg"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm">
              {error}
            </p>
          )}
          <Button type="submit" variant="secondary" disabled={saving || !purses.length}>
            {saving ? "Adding…" : "Add loot"}
          </Button>
        </form>
      )}
    </>
  );
}

function GiveToPlayer({
  purses,
  initialFromId,
  initialHoldingId,
}: {
  purses: Purse[];
  initialFromId?: string;
  initialHoldingId?: string;
}) {
  const { give, holdings } = useEconomy();
  const seat = useSeat();
  const [fromId, setFromId] = useState(
    initialFromId && purses.some((purse) => purse.id === initialFromId)
      ? initialFromId
      : (purses[0]?.id ?? ""),
  );
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [holdingId, setHoldingId] = useState(initialHoldingId ?? "");
  const [qty, setQty] = useState(() => {
    const chosen = holdings.find((holding) => holding.id === initialHoldingId);
    return String(chosen?.quantity ?? 1);
  });
  const [busy, setBusy] = useState(false);
  // One command ID per transfer, reused if the same transfer is retried.
  const action = useCommandId(`${fromId}|${toId}|${amount.trim()}|${holdingId}|${qty}`);
  const { recipients, rosterError } = useGiveRecipients(fromId);
  // Pooled items wait for the DM's resolution (owner decision): Give doesn't offer them.
  const mine = holdings.filter(
    (holding) =>
      holding.purseId === fromId && !holding.custody && !holding.reservedFor && !holding.pool,
  );

  useEffect(() => {
    if (!purses.some((purse) => purse.id === fromId)) setFromId(purses[0]?.id ?? "");
  }, [purses, fromId]);

  useEffect(() => {
    if (recipients.some((person) => person.id === toId)) return;
    setToId(recipients[0]?.id ?? "");
  }, [recipients, toId]);

  useEffect(() => {
    if (holdingId && !mine.some((holding) => holding.id === holdingId)) setHoldingId("");
  }, [mine, holdingId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const copper = amount.trim() ? parsePrice(amount) : 0;
    if (copper === null || copper < 0 || !fromId || !toId) return;
    setBusy(true);
    try {
      // The fields clear only once the transfer is accepted; a refusal is
      // shown as a toast and keeps the input for a retry with the same ID.
      const accepted = await give(
        {
          fromId,
          toId,
          copper,
          holdingId: holdingId || null,
          quantity: Math.max(1, Math.floor(Number(qty) || 1)),
        },
        { commandId: action.commandId },
      );
      if (!accepted) return;
      action.renew();
      setAmount("");
      setHoldingId("");
      setQty("1");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10" id="give-holding">
      <h2 className="font-display text-2xl tracking-tight">Give to a player</h2>
      <p className="mt-1 text-sm text-muted">
        Coins, items, or property deeds move to another character. A property and its deed transfer together. The party chat shows it, and the dungeon
        master's activity report lists it.
      </p>
      {rosterError && recipients.length === 0 ? (
        <p className="mt-3 text-sm" role="alert">
          {rosterError}
        </p>
      ) : recipients.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          {seat.role === "player"
            ? "No other players are on this link. They are included the next time the dungeon master copies it."
            : "Add another character before giving something across the party."}
        </p>
      ) : (
        <form className="mt-3 flex flex-col gap-2" onSubmit={(event) => void submit(event)}>
          <select
            value={fromId}
            onChange={(event) => setFromId(event.target.value)}
            className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
            aria-label="Give from"
          >
            {purses.map((purse) => (
              <option key={purse.id} value={purse.id}>
                From {purse.name}
              </option>
            ))}
          </select>
          <select
            value={toId}
            onChange={(event) => setToId(event.target.value)}
            className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
            aria-label="Give to"
          >
            {recipients.map((person) => (
              <option key={person.id} value={person.id}>
                To {person.name}
              </option>
            ))}
          </select>
          <TextInput
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="Coins, 5 gp. Blank sends only a holding."
            aria-label="Coins to give"
          />
          <select
            value={holdingId}
            onChange={(event) => setHoldingId(event.target.value)}
            className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
            aria-label="Holding to give"
          >
            <option value="">No holding</option>
            {mine.map((holding) => (
              <option key={holding.id} value={holding.id}>
                {holding.name} · × {holding.quantity}
              </option>
            ))}
          </select>
          {holdingId ? (
            <TextInput
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              aria-label="Quantity to give"
            />
          ) : null}
          <Button type="submit" variant="secondary" disabled={busy}>
            {busy ? "Giving…" : "Give"}
          </Button>
        </form>
      )}
    </section>
  );
}

function Payment({ purses }: { purses: Purse[] }) {
  const { post } = useEconomy();
  const [purseId, setPurseId] = useState(
    purses.find((purse) => purse.kind === "party")?.id ?? purses[0]?.id ?? "",
  );
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // One command ID per payment direction, reused if the same payment is retried.
  const inputs = `${purseId}|${amount.trim()}|${note.trim()}`;
  const paying = useCommandId(`pay|${inputs}`);
  const receiving = useCommandId(`receive|${inputs}`);

  useEffect(() => {
    if (!purses.some((purse) => purse.id === purseId))
      setPurseId(purses.find((purse) => purse.kind === "party")?.id ?? purses[0]?.id ?? "");
  }, [purses, purseId]);

  async function send(sign: 1 | -1) {
    if (busy) return;
    const copper = parsePrice(amount);
    if (!purseId || copper === null || copper === 0 || !note.trim()) return;
    const action = sign < 0 ? paying : receiving;
    setBusy(true);
    try {
      // Clear only once the payment is recorded; a refusal keeps the input.
      if (!(await post(purseId, copper * sign, note.trim(), { commandId: action.commandId })))
        return;
      action.renew();
      setAmount("");
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl tracking-tight">A payment</h2>
      <div className="mt-3 flex flex-col gap-2">
        <select
          value={purseId}
          onChange={(event) => setPurseId(event.target.value)}
          className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
          aria-label="Funds for the payment"
        >
          {purses.map((purse) => (
            <option key={purse.id} value={purse.id}>
              {purse.name}
            </option>
          ))}
        </select>
        <TextInput
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Amount, 5 gp"
          aria-label="Payment amount"
        />
        <TextInput
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What it was for"
          aria-label="Payment note"
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => void send(-1)}>
            Pay funds
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void send(1)}>
            Receive funds
          </Button>
        </div>
      </div>
    </section>
  );
}
