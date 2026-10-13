import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { formatCopper, toCopper } from "@/lib/quire/money";
import { AppLink } from "./app-link";
import { FantasyIcon } from "./fantasy-icon";
import { normalizeShortcuts, shortcutDestinations } from "@/lib/quire/shortcuts.mjs";
import { characterSheet } from "@/lib/characters/campaign-sheet.mjs";
import { Guide } from "./guide";
import { LedgerArt } from "./ledger-art";

// Fixed player services share the existing destination labels and artwork.
const playerServices = normalizeShortcuts(null, "player").map((item) =>
  shortcutDestinations.find((target) => target.id === item.destination)!,
);
export function PlayerHome() {
  const { purses, ready, holdings, sheets } = useEconomy(),
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
        <AppLink className="settings-link" href="/share">
          Campaign, messages & session status →
        </AppLink>
        <AppLink className="settings-link" href="/features/downtime">
          Downtime & NPC training →
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
