import { useState } from "react";
import { useSeat } from "@/lib/quire/seat";
import { useEconomy } from "@/lib/quire/economy-context";
import { formatCopper, toCopper } from "@/lib/quire/money";
import type { CloudTable } from "@/lib/quire/cloud";
import { readServices, type ServiceOrder } from "@/lib/quire/services-schema";
import { readDowntimeActivities } from "@/lib/quire/downtime-activities-schema";
import { downtimeRemaining } from "@/lib/quire/downtime-activities";
import { lessonDays, lessonFee } from "@/lib/quire/services";
import { SearchSelect } from "./search-select";
import { CommandForm } from "./world-tools";
import { Button, Fold } from "./ui";
import { serviceWhen } from "./service-talk";

// Paid lessons (docs/SERVICES.md, services wave 2): the "Learn from a paid teacher" mode of the
// existing NPC training form, and the lessons card. Sessions are ordinary `downtime-training`
// requests with `lessonOrderId`; the DM's approval charges each one once.

const categories = { martial: "Martial", academic: "Academic", profession: "Skill or Profession" };
const days = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Agreements this seat can log sessions for (the pupil is theirs), or every one for the DM. */
function myLessons(t: CloudTable, purseIds: string[], dm: boolean) {
  return readServices(t.journal?.services).orders.filter(
    (o) => o.terms.lessons && (dm || purseIds.includes(o.terms.lessons.pupilId) || purseIds.includes(o.purseId)),
  );
}

export function PaidLessons({ table: t, locked, initialLessonId = "" }: { table: CloudTable; locked: boolean; initialLessonId?: string }) {
  const seat = useSeat(),
    dm = seat.role === "dm";
  const lessons = myLessons(t, seat.purseIds, dm);
  const open = lessons.filter((o) => o.status === "active" && (dm || seat.purseIds.includes(o.terms.lessons!.pupilId)));
  const state = readDowntimeActivities(t.journal?.downtimeActivities);
  const [lessonId, setLessonId] = useState(initialLessonId);
  const [windowId, setWindowId] = useState("");
  const [hoursText, setHoursText] = useState(String(state.settings.trainingHoursPerDay));
  const [description, setDescription] = useState("");
  if (!lessons.length) return null;
  const chosen = open.find((o) => o.id === lessonId) ?? open[0];
  const period = state.windows.find((w) => w.id === windowId) ?? state.windows.at(-1);
  const minutes = Math.round(Number(hoursText) * 60);
  const hpd = period?.settings.trainingHoursPerDay ?? state.settings.trainingHoursPerDay;
  const fee = chosen && Number.isSafeInteger(minutes) && minutes > 0 ? lessonFee(minutes, chosen.terms.lessons!.dayCopper, hpd) : 0;
  const pupil = chosen ? t.purses.find((p) => p.id === chosen.terms.lessons!.pupilId) : undefined;
  return (
    <Fold title="Learn from a paid teacher" hint="Paid lessons: log a session, charged once when the DM approves it" defaultOpen>
      <div id="paid-lessons" style={{ scrollMarginTop: "6rem" }} />
      {open.length > 0 && period ? (
        <CommandForm
          label={`Send for review · ${days(minutes / 60)} h · ${formatCopper(fee)} on approval`}
          submitDisabled={locked || !chosen || !(minutes > 0)}
          dirty={!!description}
          onDone={() => setDescription("")}
          submit={() => ({
            kind: "downtime-training",
            windowId: period.id,
            trainerId: chosen!.terms.lessons!.pupilId,
            npcId: chosen!.terms.npcId,
            category: chosen!.terms.lessons!.category,
            topic: chosen!.terms.lessons!.topic,
            description,
            className: "",
            minutes,
            lessonOrderId: chosen!.id,
          })}
        >
          <label>
            Lessons
            <SearchSelect aria-label="Lessons" value={chosen?.id ?? ""} onValueChange={setLessonId}>
              {open.map((o) => {
                const taken = lessonDays(t, o);
                return (
                  <option key={o.id} value={o.id}>
                    {o.terms.lessons!.topic} with {o.terms.npcName} · {days(taken.approved)}/{o.terms.lessons!.maxDays} days
                    {dm ? ` · ${o.terms.lessons!.pupilName}` : ""}
                  </option>
                );
              })}
            </SearchSelect>
          </label>
          <label>
            Downtime period
            <SearchSelect aria-label="Paid lesson downtime period" value={period.id} onValueChange={setWindowId}>
              {[...state.windows].reverse().map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · day {w.fromDay} · {w.days} days
                </option>
              ))}
            </SearchSelect>
          </label>
          <label>
            Hours
            <input
              aria-label="Lesson hours"
              type="number"
              min="0.25"
              step="0.25"
              max="87600"
              value={hoursText}
              onChange={(e) => setHoursText(e.target.value)}
            />
          </label>
          <label>
            What you practised (optional)
            <input aria-label="What you practised" maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <dl className="svc-kv" aria-label="Hours for both people">
            <dt>{pupil?.name ?? "Pupil"}, this period</dt>
            <dd>{pupil ? `${days(downtimeRemaining(state, period.id, pupil.id, true) / 60)} h free` : "—"}</dd>
            <dt>{chosen?.terms.npcName ?? "Teacher"}</dt>
            <dd>Checked when the DM reviews</dd>
            <dt>Fee for this session</dt>
            <dd>{formatCopper(fee)}</dd>
          </dl>
          <p className="svc-hint">
            {chosen
              ? `Category ${categories[chosen.terms.lessons!.category]} and subject ${chosen.terms.lessons!.topic} come from the lessons and count toward the training totals. `
              : ""}
            {days(minutes / 60)} hours = {days(minutes / (hpd * 60))} training {minutes === hpd * 60 ? "day" : "days"} at this period's {hpd}-hour
            day. The hours are reserved for both of you; nothing is charged until the DM approves. The teacher's own hours stay
            private.
          </p>
        </CommandForm>
      ) : (
        <p>{open.length ? "The DM needs to approve campaign downtime before you can log a session." : "No open lessons to log."}</p>
      )}
      {lessons
        .slice()
        .reverse()
        .map((o) => (
          <LessonsCard key={o.id} order={o} table={t} />
        ))}
    </Fold>
  );
}

/** One agreement: progress in training days, each session's fee, pending ones, End lessons. */
export function LessonsCard({ order: o, table: t }: { order: ServiceOrder; table: CloudTable }) {
  const seat = useSeat(),
    { commandOutcome } = useEconomy();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const l = o.terms.lessons!;
  const taken = lessonDays(t, o);
  const pending = readDowntimeActivities(t.journal?.downtimeActivities).requests.filter(
    (r) => r.lessonOrderId === o.id && r.status === "pending",
  );
  const paid = (o.sessions ?? []).reduce((n, s) => n + s.feeCopper, 0);
  const done = (o.sessions ?? []).reduce((n, s) => n + s.minutes / (s.trainingHoursPerDay * 60), 0);
  const canEnd = (seat.role === "dm" || seat.purseIds.includes(o.purseId)) && (o.status === "active" || o.status === "paused");
  const payer = t.purses.find((p) => p.id === o.purseId);
  return (
    <article className="svc-order world-card" aria-label={`Lessons ${l.topic}`}>
      <h4>
        {l.topic} with {o.terms.npcName} <span className={`svc-status ${o.status}`}>{o.status}</span>
      </h4>
      <div
        className={`svc-bar${o.status === "completed" ? " ready" : ""}`}
        role="progressbar"
        aria-label={`${l.topic} lessons progress`}
        aria-valuemin={0}
        aria-valuemax={l.maxDays}
        aria-valuenow={Math.min(l.maxDays, done)}
      >
        <i style={{ width: `${Math.min(100, (100 * done) / l.maxDays)}%` }} />
      </div>
      <div className="svc-days">
        <span>
          {days(done)}/{l.maxDays} training days ({days((o.sessions ?? []).reduce((n, s) => n + s.minutes, 0) / 60)} h)
        </span>
        <span>
          {l.pupilName} · paid {formatCopper(paid)} so far
        </span>
      </div>
      <ul className="svc-offers" aria-label={`${l.topic} sessions`}>
        {(o.sessions ?? []).map((s) => (
          <li key={s.requestId}>
            <span>
              Day {s.day} · {days(s.minutes / 60)} h
            </span>
            <span>{formatCopper(s.feeCopper)}</span>
            <small>Approved</small>
          </li>
        ))}
        {pending.map((r) => (
          <li key={r.id} className="pending">
            <span>{days(r.minutes / 60)} h</span>
            <span>{formatCopper(r.feeCopper ?? 0)}</span>
            <small>Nothing charged until approved.</small>
          </li>
        ))}
      </ul>
      <p className="svc-hint">
        {formatCopper(l.dayCopper)} a training day · agreed {serviceWhen(o.orderedDay, o.orderedMinute)} at {o.terms.shopName}
        {payer && payer.id !== l.pupilId ? ` · paid by ${payer.name} (${formatCopper(toCopper(payer.coins))})` : ""}. {o.message}
      </p>
      {taken.pending > 0 && <p className="svc-hint">{days(taken.pending)} training days waiting for the DM.</p>}
      {canEnd && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await commandOutcome({ id: `${o.id}-end`, kind: "service-cancel", orderId: o.id, before: o } as never);
            } catch (e) {
              setError(e instanceof Error ? e.message : "That didn't work. Nothing changed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          End lessons
        </Button>
      )}
      {canEnd && <p className="svc-hint">Ending stops new sessions and charges nothing. Paid sessions stay in the history.</p>}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
