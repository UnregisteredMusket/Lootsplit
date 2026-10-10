import { finishingCharacters } from "@/lib/quire/character-position";
import { inParty } from "@/lib/quire/character-position";
import { useState } from "react";
import { readFinance } from "@/lib/quire/finance";
import { previewSessionTime, sessionTimeFingerprint } from "@/lib/quire/session-time";
import { readWorld } from "@/lib/quire/world-schema";
import { formatCopper } from "@/lib/quire/money";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { CommandForm } from "./world-tools";
import { Fold } from "./ui";
import { AppLink } from "./app-link";
export function SessionTime() {
  const t = useWorldTable(),
    f = readFinance(t.journal.finance),
    world = readWorld(t.journal.world),
    [hours, setHours] = useState("1"),
    [rest, setRest] = useState<"none" | "short" | "long">("none"),
    [allowDowntime, setAllowDowntime] = useState(false),
    [recipients, setRecipients] = useState<string[]>([]),
    [note, setNote] = useState("");
  let preview: ReturnType<typeof previewSessionTime> | undefined,
    error = "";
  try {
    preview = previewSessionTime(t, Number(hours), allowDowntime);
  } catch (e) {
    error = e instanceof Error ? e.message : "Time preview unavailable.";
  }
  const active = t.journal.sessions.find((s) => !s.endedAt),
    characters = t.purses.filter((p) => p.kind === "character" && inParty(t, p));
  return (
    <section>
      <p>
        Campaign day {f.day} · {String(Math.floor((f.minuteOfDay ?? 0) / 60)).padStart(2, "0")}:00
      </p>
      <p>
        {active
          ? `Active session: ${active.name}`
          : "Start a recorded session from the Desk to advance time."}
      </p>
      <CommandForm
        label="Approve & advance session time"
        dirty={hours !== "1" || rest !== "none" || allowDowntime || !!note}
        submit={() => {
          if (!active) throw Error("Start a recorded session first.");
          if (!preview) throw Error(error);
          if (rest !== "none" && !recipients.length) throw Error("Choose rest recipients.");
          return {
            kind: "session-time",
            before: sessionTimeFingerprint(t),
            hours: Number(hours),
            rest,
            purseIds: rest === "none" ? [] : recipients,
            allowDowntime,
            note,
          };
        }}
      >
        <label>
          Hours to advance
          <input
            type="number"
            required
            min={1}
            max={24}
            step={1}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </label>
        <label>
          Award rest
          <select
            aria-label="Award rest"
            value={rest}
            onChange={(e) => setRest(e.target.value as typeof rest)}
          >
            <option value="none">No rest</option>
            <option value="short">Short rest</option>
            <option value="long">Long rest</option>
          </select>
        </label>
        {rest !== "none" && (
          <>
            <p>
              Short rest: short-rest resources. Long rest: HP, death saves, spell slots and
              short/long-rest resources. The DM decides whether the elapsed hours qualify. Hit dice,
              conditions and manual resources remain DM-managed, as on the character sheet.
            </p>
            {characters.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={recipients.includes(p.id)}
                  onChange={(e) =>
                    setRecipients(
                      e.target.checked
                        ? [...recipients, p.id]
                        : recipients.filter((id) => id !== p.id),
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          </>
        )}
        <label>
          <input
            type="checkbox"
            checked={allowDowntime}
            onChange={(e) => setAllowDowntime(e.target.checked)}
          />
          Allow assigned characters to perform approved property downtime work during these hours
        </label>
        <p className="text-sm text-muted">
          Only existing approved projects, assignments, skills and location permissions are used.
          Contractors progress with elapsed hours; rent, wages, deliveries, letters and shops settle
          at crossed campaign days. Work is prorated over a 24-hour campaign day.
        </p>
        <AppLink className="settings-link" href="/features/properties">
          Configure property projects & downtime actions →
        </AppLink>
        <label>
          Time advance note
          <textarea maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {preview && (
          <div className="world-card">
            <h3>Time & settlement preview</h3>
            <p>
              Day {preview.fromDay}, {Math.floor(preview.fromMinute / 60)}:00 → Day {preview.toDay},{" "}
              {Math.floor(preview.toMinute / 60)}:00
            </p>
            {finishingCharacters(t, preview.toDay * 1440 + preview.toMinute).map((s) => (
              <p key={s.purseId}>
                {t.purses.find((p) => p.id === s.purseId)?.name}: completes {s.downtime?.name};
                restores previous placement.
              </p>
            ))}
            {preview.quote.lines.map((l) => (
              <p key={l.id}>
                {l.name}: {formatCopper(l.paid)} settled, {formatCopper(l.unpaid)} unpaid
              </p>
            ))}
            {preview.quote.propertyOperations?.state.jobs
              .filter((j) => ["active", "blocked", "completed"].includes(j.status))
              .map((j) => (
                <p key={j.id}>
                  {j.name}: {j.progress / 100} labor days · {j.status} · {j.message}
                </p>
              ))}
            {preview.quote.propertyOperations?.notices.map((n, i) => (
              <p key={i}>{n.summary}</p>
            ))}
            {preview.quote.market?.map((m) => (
              <p key={m.shopId}>
                Shop schedule: {t.shops.find((s) => s.id === m.shopId)?.name} ·{" "}
                {m.closed ? "Closed" : "Open"} · {m.stock.length} stock changes
              </p>
            ))}
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </CommandForm>
      <Fold title="Session time history">
        {world.timeHistory.map((r) => (
          <p key={r.id}>
            Day {r.fromDay}, {Math.floor(r.fromMinute / 60)}:00 · +{r.hours} hours · {r.rest} rest ·{" "}
            {r.allowDowntime ? "Character downtime allowed" : "No character downtime"} · {r.note}
          </p>
        ))}
      </Fold>
    </section>
  );
}
