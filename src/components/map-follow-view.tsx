import { useState } from "react";
import type { CloudTable } from "@/lib/quire/cloud";
import { useEconomy } from "@/lib/quire/economy-context";
import { setFollowMe, useFollowMe } from "@/lib/quire/follow-pref";
import { readTabletopSession } from "@/lib/quire/tabletop";

/**
 * Settings › Players & display (map tokens PR 7; mockup player-token-move frame 4): the DM's
 * "Character tokens follow players' map view" (off by default) and, once it is on, each player's
 * own "Follow me" switch (on by default, on their device).
 */
export function FollowViewSettings({
  table,
  dm,
  scope,
  character,
}: {
  table: Pick<CloudTable, "journal">;
  dm: boolean;
  /** The campaign and seat the player's switch belongs to. */
  scope: string;
  /** The player's character name ("Mira"), for the switch's hint. */
  character?: string;
}) {
  const session = readTabletopSession(table),
    on = !!session.followView,
    mine = useFollowMe(scope),
    { commandOutcome } = useEconomy(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (dm)
    return (
      <div className="map-follow-setting">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={busy}
          className="map-switch-row"
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await commandOutcome({ kind: "tabletop-session", before: table.journal?.world?.tabletop ?? null, session: { ...session, followView: !on } });
            } catch (e) {
              setError(e instanceof Error ? e.message : "The setting could not be saved. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className={`map-switch${on ? " on" : ""}`} aria-hidden="true" />
          <span>
            <b>Character tokens follow players' map view</b>
            <small>
              Off by default. Only maps the player can already open, in the same place (zone) as their character; never
              during combat.
            </small>
          </span>
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  if (!on) return null;
  return (
    <div className="map-follow-setting">
      <button type="button" role="switch" aria-checked={mine} className="map-switch-row" onClick={() => setFollowMe(scope, !mine)}>
        <span className={`map-switch${mine ? " on" : ""}`} aria-hidden="true" />
        <span>
          <b>Follow me</b>
          <small>Your token moves to the map you open. Turn off to browse without moving {character ?? "your character"}.</small>
        </span>
      </button>
    </div>
  );
}
