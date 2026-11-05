/**
 * "What players can see" (DM only, /features/visibility): every player-visibility setting and
 * every hidden record type in one list, grouped by area. Simple switches send the existing command
 * built by visibility-center.ts (the same builder their original control uses); per-record
 * visibility shows a count and links to where it is edited. Nothing is stored; every original
 * control stays where it was.
 */
import "./visibility-center.css";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { AppLink } from "./app-link";
import { Button } from "./ui";
import { useEconomy } from "@/lib/quire/economy-context";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { useActualDm, usePlayerPreview } from "@/lib/quire/use-player-preview";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { startPreview } from "@/lib/quire/player-preview";
import {
  previewCharacters,
  visibilityCenter,
  type VisibilitySwitch,
} from "@/lib/quire/visibility-center";

export function VisibilityCenter() {
  const dm = useActualDm(),
    preview = usePlayerPreview(),
    table = useWorldTable(),
    { ready } = useEconomy();
  // The route is DM-only; this is a second guard (a player's device holds only its own view).
  if (!dm || preview) return <p>This screen is available to the campaign DM.</p>;
  const areas = visibilityCenter(table);
  const hidden = areas.reduce((n, a) => n + a.counts.reduce((m, c) => m + c.count, 0), 0);
  return (
    <div className="visibility-center" data-testid="visibility-center">
      <p className="text-sm text-muted">
        Every setting that decides what players see, in one place. Switches here change the same
        setting as their original control, which stays where it is. Records hidden one by one show
        a count and a link to where you edit them. Counts are shown only to you.
      </p>
      <p className="visibility-summary" role="status">
        {hidden === 0 ? "Nothing is hidden from players right now." : `${hidden} hidden or DM-only records.`}
      </p>
      <PreviewSeats disabled={!ready} />
      {areas.map((area) => (
        <section key={area.id} className="visibility-area" aria-labelledby={`visibility-${area.id}`}>
          <h2 id={`visibility-${area.id}`}>{area.title}</h2>
          {area.switches.length > 0 && (
            <ul className="visibility-list">
              {area.switches.map((s) => (
                <SwitchRow key={s.id} item={s} disabled={!ready} />
              ))}
            </ul>
          )}
          {area.counts.length > 0 && (
            <ul className="visibility-list">
              {area.counts.map((c) => (
                <li key={c.id} className="visibility-row" data-testid={`visibility-count-${c.id}`}>
                  <span className="visibility-label">
                    <b>{c.label}</b>
                    {c.note && <small>{c.note}</small>}
                  </span>
                  <span className={`visibility-count${c.count ? " some" : ""}`} aria-label={`${c.count} ${c.label}`}>
                    {c.count}
                  </span>
                  <AppLink className="visibility-where" href={c.href}>
                    {c.where} →
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
          {area.rules.map((r) => (
            <p key={r.label} className="visibility-rule text-sm text-muted">
              {r.label}{" "}
              <AppLink className="visibility-where" href={r.href}>
                {r.where} →
              </AppLink>
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

function SwitchRow({ item, disabled }: { item: VisibilitySwitch; disabled: boolean }) {
  const { commandOutcome } = useEconomy(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <li className="visibility-row" data-testid={`visibility-switch-${item.id}`}>
      <span className="visibility-label">
        <b>{item.label}</b>
        <small>
          Now: <strong data-testid={`visibility-state-${item.id}`}>{item.state}</strong>
        </small>
        {item.note && <small>{item.note}</small>}
      </span>
      {item.command && (
        <Button
          variant="secondary"
          disabled={disabled || busy}
          onClick={async () => {
            if (!item.command) return;
            setBusy(true);
            setError("");
            setNotice("");
            try {
              setNotice(mutationNotice(await commandOutcome(item.command), "Saved."));
            } catch (e) {
              setError(e instanceof Error ? e.message : "The setting could not be saved. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : item.action}
        </Button>
      )}
      <AppLink className="visibility-where" href={item.href}>
        Also in {item.where} →
      </AppLink>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </li>
  );
}

/** "Preview as player" for each player character (the same read-only preview as Party's). */
function PreviewSeats({ disabled }: { disabled: boolean }) {
  const table = useWorldTable(),
    navigate = useNavigate(),
    characters = previewCharacters(table);
  return (
    <section className="visibility-area" aria-labelledby="visibility-preview">
      <h2 id="visibility-preview">Preview as a player</h2>
      {characters.length === 0 ? (
        <p className="text-sm text-muted">Add a player character to preview what that player sees.</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Read-only: nothing can be changed, saved or sent until you stop the preview.
          </p>
          <ul className="visibility-previews">
            {characters.map((c) => (
              <li key={c.id}>
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => {
                    try {
                      startPreview({ name: c.name, purseIds: [c.id] });
                      void navigate({ to: "/", search: { view: "home" } });
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "The preview could not start.");
                    }
                  }}
                >
                  <Eye size={16} aria-hidden="true" /> Preview as {c.name}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
