import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { formatCopper, toCopper } from "@/lib/quire/money";
import { AppLink } from "./app-link";
import { FantasyIcon } from "./fantasy-icon";
import { normalizeShortcuts, shortcutDestinations } from "@/lib/quire/shortcuts.mjs";

// Fixed player services share the existing destination labels and artwork.
const playerServices = normalizeShortcuts(null, "player").map((item) =>
  shortcutDestinations.find((target) => target.id === item.destination)!,
);
export function PlayerHome() {
  const { purses, ready } = useEconomy(),
    seat = useSeat();
  const mine = purses.filter((p) => seat.purseIds.includes(p.id) && p.kind === "character");
  return (
    <div className="dm-control-panel">
      <section className="desk-readouts">
        <h1>Home</h1>
        {!ready ? (
          <p>Loading your campaign…</p>
        ) : !mine.length ? (
          <p>Join a campaign and select your assigned character to begin.</p>
        ) : (
          mine.map((p) => (
            <div className="journal-entry" key={p.id}>
              <h2>{p.name}</h2>
              <p>
                {p.sheet ? `HP ${p.sheet.hp}/${p.sheet.maxHp} · AC ${p.sheet.ac} · ` : ""}
                {formatCopper(toCopper(p.coins))}
              </p>
            </div>
          ))
        )}
        <AppLink className="settings-link" href="/share">
          Campaign, messages & session status →
        </AppLink>
      </section>
      <section className="desk-shortcuts" aria-label="Player features">
        <div className="shortcut-grid">
          {playerServices.map((service) => (
            <AppLink
              key={service.id}
              className="shortcut-button"
              href={service.href.startsWith("/features/") ? `${service.href}?from=%2F` : service.href}
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
