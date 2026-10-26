import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { formatCopper, toCopper } from "@/lib/quire/money";
import { AppLink } from "./app-link";
import { FantasyIcon } from "./fantasy-icon";
import { normalizeShortcuts, shortcutDestinations } from "@/lib/quire/shortcuts.mjs";
import { characterSheet } from "@/lib/characters/campaign-sheet.mjs";
import { Guide } from "./guide";
import { LedgerArt } from "./ledger-art";
import { PlayerQuestHome } from "./quests";
import { X } from "lucide-react";
import { dismissJoinTips, joinTipsOffered } from "@/lib/quire/join-memory";
import { useChatUnread } from "@/lib/quire/use-chat-unread";
import { activeCampaignId } from "@/lib/quire/campaign-context";
import {
  awaySnapshot,
  readAwaySnapshot,
  sinceAway,
  writeAwaySnapshot,
  type AwaySnapshot,
  type AwayTable,
} from "@/lib/quire/since-away";
import { useEffect, useRef, useState } from "react";

// Fixed player services share the existing destination labels and artwork.
const playerServices = normalizeShortcuts(null, "player").map((item) =>
  shortcutDestinations.find((target) => target.id === item.destination)!,
);
export function PlayerHome() {
  const { purses, ready, holdings, sheets, journal } = useEconomy(),
    seat = useSeat();
  const mine = purses.filter((p) => seat.purseIds.includes(p.id) && p.kind === "character");
  return (
    <div className="dm-control-panel player-home">
      <section className="desk-readouts">
        <div className="panel-heading">
          <h1>Home</h1>
          <Guide />
        </div>
        {!ready ? (
          <p>Loading your campaign…</p>
        ) : !mine.length ? (
          <p>Join a campaign and select your assigned character to begin.</p>
        ) : (
          mine.map((p) => {
            const sheet = characterSheet(
              p,
              holdings,
              sheets.find((s) => s.purseId === p.id),
            );
            return (
              <article className="journal-entry player-character" key={p.id}>
                <LedgerArt kind="portrait" src={sheet.portrait} />
                <div className="player-character-details">
                  <p className="eyebrow">Your character</p>
                  <h2>{p.name}</h2>
                  <p>{[sheet.species, sheet.classes].filter(Boolean).join(" · ")}</p>
                  <p>
                    {sheet.maxHp ? `HP ${sheet.hp}/${sheet.maxHp}` : "HP —"} · AC {sheet.ac} ·{" "}
                    {formatCopper(toCopper(p.coins))}
                  </p>
                </div>
                <AppLink
                  className="player-sheet-link"
                  href={`/characters?id=${encodeURIComponent(`party:${p.id}`)}`}
                >
                  Open character sheet →
                </AppLink>
              </article>
            );
          })
        )}
        {ready && mine.length > 0 && (
          <SinceAway table={{ holdings, journal } as AwayTable} mine={mine.map((p) => p.id)} />
        )}
        {ready && mine.length > 0 && <JoinTips sheetHref={`/characters?id=${encodeURIComponent(`party:${mine[0]!.id}`)}`} />}
        {ready && mine.length > 0 && <PlayerQuestHome />}
        <AppLink className="settings-link" href="/share">
          Campaign, messages & session status →
        </AppLink>
        <AppLink className="settings-link" href="/features/downtime">
          Time & downtime →
        </AppLink>
      </section>
      <section className="desk-shortcuts" aria-label="Player features">
        <h2>Your services</h2>
        <div className="shortcut-grid">
          {playerServices.map((service) => (
            <AppLink
              key={service.id}
              className="shortcut-button"
              href={
                service.href.startsWith("/features/") ? `${service.href}?from=%2F` : service.href
              }
            >
              <FantasyIcon ui={service.icon} size={40} />
              <span>{service.label}</span>
            </AppLink>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Three first steps after joining a room (plan P3, Q16), shown until dismissed. */
function JoinTips({ sheetHref }: { sheetHref: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(joinTipsOffered()), []);
  if (!open) return null;
  return (
    <section className="join-tips" aria-label="Getting started">
      <div className="join-tips-heading">
        <h2>Getting started</h2>
        <button
          type="button"
          className="header-icon"
          aria-label="Dismiss getting started tips"
          onClick={() => {
            dismissJoinTips();
            setOpen(false);
          }}
        >
          <X size={18} />
        </button>
      </div>
      <ol>
        <li>
          <AppLink href={sheetHref}>Sheet</AppLink>
          <span>Your hit points, attacks, spells and dice.</span>
        </li>
        <li>
          <AppLink href="/party">Inventory &amp; coins</AppLink>
          <span>What you carry and your share of the purse.</span>
        </li>
        <li>
          <AppLink href="/share?chat=1">Chat</AppLink>
          <span>Talk with your party and your DM.</span>
        </li>
      </ol>
    </section>
  );
}

/** "Since you were away" (plan P4, Q21): shown only when something is waiting for this player. */
function SinceAway({ table, mine }: { table: AwayTable; mine: string[] }) {
  const { count } = useChatUnread();
  // The comparison point is the last time this device left Home; it is read once per visit.
  const [previous, setPrevious] = useState<AwaySnapshot | null | undefined>(undefined);
  const latest = useRef({ table, mine });
  latest.current = { table, mine };
  useEffect(() => {
    const campaign = activeCampaignId();
    setPrevious(readAwaySnapshot(campaign));
    return () => {
      writeAwaySnapshot(campaign, awaySnapshot(latest.current.table, latest.current.mine, Date.now()));
    };
  }, []);
  if (previous === undefined) return null;
  const items = sinceAway(table, mine, previous, count);
  if (!items.length) return null;
  return (
    <section className="since-away" aria-label="Since you were away">
      <h2>Since you were away</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <AppLink href={item.href}>{item.text} →</AppLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
