import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  GAME_SUGGESTIONS,
  loadOwnCommunity,
  saveOwnCommunity,
  timeZones,
  type OwnCommunityProfile,
} from "@/lib/account/community";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";

const editable = (p: OwnCommunityProfile) =>
  JSON.stringify({ ...p, revision: 0, hidden_by_staff: false });

/**
 * Community profile settings: who can see it, a handle for its address, and the
 * Looking for Group details. Off by default (owner decision 2026-10-23).
 */
export function CommunityControls({ profileRevision }: { profileRevision: number }) {
  const [saved, setSaved] = useState<OwnCommunityProfile | null>(null);
  const [draft, setDraft] = useState<OwnCommunityProfile | null>(null);
  const [gamesText, setGamesText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const zones = useMemo(() => timeZones(), []);
  // True once the member edits the form; a background reload then never replaces their edits.
  const edited = useRef(false);
  const dirty =
    !!draft && !!saved && (editable(draft) !== editable(saved) || gamesText !== saved.games.join(", "));
  useDraftGuard(dirty, "community profile");

  const load = useCallback(async () => {
    try {
      const next = await loadOwnCommunity();
      setSaved(next);
      if (edited.current) {
        setDraft((d) => (d ? { ...d, revision: next.revision, hidden_by_staff: next.hidden_by_staff } : next));
        return;
      }
      setDraft(next);
      setGamesText(next.games.join(", "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your community profile.");
    }
  }, []);
  // The member profile above shares this revision; pick up its saves when nothing is being edited.
  useEffect(() => {
    void load();
  }, [profileRevision, load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const games = gamesText
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);
      const next = await saveOwnCommunity({ ...draft, games });
      edited.current = false;
      setSaved(next);
      setDraft(next);
      setGamesText(next.games.join(", "));
      setNotice(
        next.visibility === "off"
          ? "Community profile saved. It is hidden."
          : "Community profile saved.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your community profile.");
    } finally {
      setBusy(false);
    }
  }

  if (!draft)
    return (
      <section className="portal-card" aria-labelledby="community-settings-title">
        <h2 id="community-settings-title">Community profile</h2>
        {error ? (
          <p role="alert" className="portal-message error">
            {error}
          </p>
        ) : (
          <p role="status">Loading…</p>
        )}
      </section>
    );

  const set = <K extends keyof OwnCommunityProfile>(key: K, value: OwnCommunityProfile[K]) => {
    edited.current = true;
    setDraft({ ...draft, [key]: value });
  };

  return (
    <section className="portal-card" aria-labelledby="community-settings-title">
      <p className="portal-eyebrow">FIND A GROUP</p>
      <h2 id="community-settings-title">Community profile</h2>
      <p>
        Show a profile in the <Link to="/community">Looking for Group directory</Link> so Dungeon
        Masters and players can find you. It shows your display name, picture and introduction from
        your member profile, plus the details below. Your email addresses are never shown.
      </p>
      {saved?.hidden_by_staff && (
        <p role="alert" className="portal-message error">
          Site staff have hidden your community profile. Contact support@lootsplitter.com if you
          think this is a mistake.
        </p>
      )}
      {error && (
        <p role="alert" className="portal-message error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="portal-message">
          {notice}
          {saved && saved.visibility !== "off" && saved.handle && (
            <>
              {" "}
              <Link to="/community/$handle" params={{ handle: saved.handle }}>
                View your profile
              </Link>
            </>
          )}
        </p>
      )}
      <form className="owner-form" onSubmit={save}>
        <fieldset disabled={busy}>
          <fieldset>
            <legend>Who can see it</legend>
            {(
              [
                ["off", "Nobody (hidden)"],
                ["members", "Signed-in Lootsplitter members"],
                ["public", "Everyone, including search engines"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="portal-check">
                <input
                  type="radio"
                  name="community-visibility"
                  checked={draft.visibility === value}
                  onChange={() => set("visibility", value)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <label>
            Handle (your profile address: lootsplitter.com/community/
            <strong>{draft.handle || "your-handle"}</strong>)
            <input
              value={draft.handle}
              maxLength={30}
              pattern="[A-Za-z0-9][A-Za-z0-9_\-]{1,28}[A-Za-z0-9]"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              required={draft.visibility !== "off"}
              onChange={(e) => set("handle", e.target.value)}
            />
          </label>
          <label>
            I play as
            <select
              value={draft.play_role}
              onChange={(e) => set("play_role", e.target.value as OwnCommunityProfile["play_role"])}
            >
              <option value="">Not set</option>
              <option value="dm">Dungeon Master</option>
              <option value="player">Player</option>
              <option value="both">Both</option>
            </select>
          </label>
          <label>
            Looking for
            <select
              value={draft.lfg}
              onChange={(e) => set("lfg", e.target.value as OwnCommunityProfile["lfg"])}
            >
              <option value="">Not looking right now</option>
              <option value="players">Players for my game</option>
              <option value="group">A group to join</option>
            </select>
          </label>
          <label>
            Looking-for-group note
            <textarea
              rows={2}
              maxLength={280}
              value={draft.lfg_note}
              placeholder="Two seats open for a weekly 5e game, Fridays 7–10 PM Eastern."
              onChange={(e) => set("lfg_note", e.target.value)}
            />
          </label>
          <label>
            Games (separate with commas, up to 8)
            <input
              list="community-games"
              value={gamesText}
              maxLength={260}
              placeholder="D&D 5e, Pathfinder 2e"
              onChange={(e) => {
                edited.current = true;
                setGamesText(e.target.value);
              }}
            />
            <datalist id="community-games">
              {GAME_SUGGESTIONS.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </label>
          <label>
            Time zone
            <select value={draft.time_zone} onChange={(e) => set("time_zone", e.target.value)}>
              <option value="">Not shown</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Usual play times
            <input
              maxLength={120}
              value={draft.play_times}
              placeholder="Weekends, evenings"
              onChange={(e) => set("play_times", e.target.value)}
            />
          </label>
          <label>
            Discord username (optional, so people can message you)
            <input
              maxLength={40}
              value={draft.discord}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set("discord", e.target.value)}
            />
          </label>
          <button className="portal-button" type="submit">
            Save community profile
          </button>
        </fieldset>
      </form>
    </section>
  );
}
