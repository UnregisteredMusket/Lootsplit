import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { formatCopper, toCopper } from "@/lib/quire/money";
import { AppLink } from "./app-link";
import { FeatureCards } from "./feature-navigation";
import { Shortcuts } from "./control-panel/shortcuts";
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
              <AppLink className="quick-action" href={`/?view=sheet`}>
                Open Character Sheet →
              </AppLink>
            </div>
          ))
        )}
        <AppLink className="settings-link" href="/share">
          Campaign, messages & session status →
        </AppLink>
      </section>
      <Shortcuts campaignId="player" role="player" />
      <FeatureCards />
    </div>
  );
}
