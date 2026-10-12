import { useState } from "react";
import { useSeat } from "@/lib/quire/seat";
import { useWorldTable } from "@/lib/quire/use-world-table";
import {
  readDowntimeActivities,
  type TrainingRequest,
} from "@/lib/quire/downtime-activities-schema";
import { downtimeRemaining, trainingCounters, trainingKey, recipientTrainingCounters } from "@/lib/quire/downtime-activities";
import { useFinanceReadiness } from "@/lib/quire/use-finance-readiness";
import { SearchSelect } from "./search-select";
import { CommandForm, CommandButton } from "./world-tools";
import { Fold } from "./ui";
import { AppLink } from "./app-link";

const labels = { martial: "Martial", academic: "Academic", profession: "Skill / Profession" };
const hours = (minutes: number) =>
  (minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 2 });
const days = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
export function DowntimeActivities({ reviewsOnly = false }: { reviewsOnly?: boolean }) {
  const t = useWorldTable(),
    seat = useSeat(),
    dm = seat.role === "dm";
  const state = readDowntimeActivities(t.journal.downtimeActivities);
  const pending = !!t.journal.finance?.downtime.some((d) => d.status === "pending");
  const { locked } = useFinanceReadiness(pending);
  const mine = t.purses.filter(
    (p) =>
      p.kind === "character" &&
      (dm || seat.purseIds.includes(p.id)) &&
      !t.journal.tradeEconomy?.exchanges.some((e) => e.purseId === p.id),
  );
  const npcs = t.purses.filter(
    (p) => p.control === "npc" || t.journal.world?.npcs.some((n) => n.id === p.id),
  );
  const [trainerId, setTrainerId] = useState(""),
    [npcId, setNpcId] = useState("");
  const [windowId, setWindowId] = useState(""),
    [category, setCategory] = useState<TrainingRequest["category"]>("martial");
  const [topic, setTopic] = useState(""),
    [description, setDescription] = useState(""),
    [className, setClassName] = useState("");
  const [duration, setDuration] = useState("8");
  const [historical, setHistorical] = useState(false), [historicalContext, setHistoricalContext] = useState("");
  const selectedTrainer = trainerId || mine[0]?.id || "",
    selectedWindow = windowId || state.windows.at(-1)?.id || "";
  const counters = trainingCounters(state);
  return (
    <section id="hourly-downtime" aria-label="Hourly downtime activities">
      {!reviewsOnly && (
        <>
          <h2>Hourly downtime & NPC training</h2>
          <p>
            Each approved downtime day provides {state.settings.hoursPerDay} usable hours per
            character. Split those hours across activities. Ship travel uses no personal downtime
            hours.
          </p>
          <p>
            Training records time and your description. The DM applies any milestone rewards or
            character changes manually. One training day is {state.settings.trainingHoursPerDay}{" "}
            hours; each period keeps its original conversion.
          </p>
          {pending && (
            <p role="status">
              The DM must approve or cancel the campaign preview before allocating hours.
            </p>
          )}
          {dm && (
            <HourSettings
              key={JSON.stringify(state.settings)}
              settings={state.settings}
              locked={locked}
            />
          )}
          {!state.windows.length ? (
            <p>The DM needs to approve campaign downtime before hours can be allocated.</p>
          ) : (
            <>
              <label>
                Approved downtime period
                <SearchSelect
                  aria-label="Approved downtime period"
                  value={selectedWindow}
                  onValueChange={setWindowId}
                >
                  {[...state.windows].reverse().map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} · day {w.fromDay} · {w.days} days
                    </option>
                  ))}
                </SearchSelect>
              </label>
              <div className="journal-entry">
                <h3>Unallocated hours</h3>
                {mine.map((p) => (
                  <p key={p.id}>
                    {p.name}: {hours(downtimeRemaining(state, selectedWindow, p.id, true))} hours
                    available ·{" "}
                    {hours(
                      downtimeRemaining(state, selectedWindow, p.id) -
                        downtimeRemaining(state, selectedWindow, p.id, true),
                    )}{" "}
                    awaiting review
                  </p>
                ))}
                <p>
                  Approved property labor and away activities share this budget. Unused hours remain
                  attached to this period and cannot be added to another period.
                </p>
              </div>
              <Fold title="Train an NPC" defaultOpen>
                <CommandForm
                  label="Request NPC training"
                  submitDisabled={locked || !selectedTrainer || !npcId || !topic.trim() || (historical && !historicalContext.trim())}
                  dirty={
                    !!topic ||
                    !!description ||
                    !!className ||
                    duration !== "8" ||
                    !!trainerId ||
                    !!npcId ||
                    !!windowId ||
                    category !== "martial" || historical || !!historicalContext
                  }
                  onDone={() => {
                    setTopic("");
                    setDescription("");
                    setClassName("");
                    setHistorical(false);setHistoricalContext("");
                  }}
                  submit={() => ({
                    kind: "downtime-training",
                    windowId: selectedWindow,
                    trainerId: selectedTrainer,
                    npcId,
                    category,
                    topic,
                    description,
                    className,
                    minutes: Number(duration) * 60,
                    ...(historical ? { historicalContext } : {}),
                  })}
                >
                  <label>
                    Trainer
                    <SearchSelect
                      aria-label="Trainer"
                      value={selectedTrainer}
                      onValueChange={setTrainerId}
                    >
                      {mine.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </SearchSelect>
                  </label>
                  <label>
                    NPC receiving training
                    <SearchSelect
                      aria-label="NPC receiving training"
                      value={npcId}
                      onValueChange={setNpcId}
                    >
                      <option value="">Choose an NPC</option>
                      {npcs
                        .filter((p) => p.id !== selectedTrainer)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </SearchSelect>
                  </label>
                  <label>
                    Training category
                    <select
                      aria-label="Training category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value as TrainingRequest["category"])}
                    >
                      {Object.entries(labels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Training subject
                    <input
                      aria-label="Training subject"
                      required
                      maxLength={160}
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="Sword drills, history, carpentry…"
                    />
                  </label>
                  <label>
                    Hours to allocate
                    <input
                      aria-label="Hours to allocate"
                      type="number"
                      required
                      min="0.25"
                      step="0.25"
                      max="87600"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                    />
                  </label>
                  <label>
                    Class to compare (optional)
                    <input
                      aria-label="Class to compare (optional)"
                      maxLength={120}
                      value={className}
                      onChange={(e) => setClassName(e.target.value)}
                      placeholder="Fighter"
                    />
                  </label>
                  <label>
                    Training description
                    <textarea
                      aria-label="Training description"
                      maxLength={4000}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </label>
                  <p>
                    The NPC must be at an equal or lower character level, and class level when a
                    class is specified. Trainer and NPC must be together. Training allocates the
                    same hours to both participants. Missing sheets or unrecognized class levels
                    require a DM review note.
                  </p>
                  <label>
                    <input type="checkbox" checked={historical} onChange={e => setHistorical(e.target.checked)} />
                    Record training completed earlier
                  </label>
                  {historical && <label>Historical training context
                    <textarea aria-label="Historical training context" required maxLength={4000} value={historicalContext} onChange={e => setHistoricalContext(e.target.value)} />
                    <span>Describe when and where training happened and the participants' levels then. The DM must confirm this history. The selected period's remaining hours still apply.</span>
                  </label>}
                </CommandForm>
              </Fold>
            </>
          )}
          <Fold title={dm ? "NPC training totals by category" : "My contributions by NPC and category"} defaultOpen>
            {!dm && <p>These totals include your visible contributions only. The DM can review the complete NPC totals.</p>}
            {recipientTrainingCounters(state).map(c => <article className="journal-entry" key={JSON.stringify([c.record.npcId, c.record.category])}>
              <h3>{c.record.npcName} · {labels[c.record.category]}</h3>
              <p>Since reset: {hours(c.currentMinutes)} hours · {days(c.currentDays)} training days</p>
              <p>Lifetime: {hours(c.lifetimeMinutes)} hours · {days(c.lifetimeDays)} training days</p>
              {dm && <ResetCounter record={c.record} requestIds={c.requestIds} locked={locked} categoryTotal />}
            </article>)}
          </Fold>
          <Fold title="Training progress counters" defaultOpen>
            {!counters.length && <p>No approved training yet.</p>}
            {counters.map((c) => (
              <article className="journal-entry" key={trainingKey(c.record)}>
                <h3>
                  {c.record.trainerName} → {c.record.npcName}
                </h3>
                <p>
                  {labels[c.record.category]} · {c.record.topic}
                </p>
                <p>
                  Since reset: {hours(c.currentMinutes)} hours · {days(c.currentDays)} training days
                </p>
                <p>
                  Lifetime: {hours(c.lifetimeMinutes)} hours · {days(c.lifetimeDays)} training days
                </p>
                {dm && <ResetCounter record={c.record} requestIds={c.requestIds} locked={locked} />}
                {state.resets
                  .filter((r) => trainingKey(r) === trainingKey(c.record))
                  .map((r) => (
                    <p key={r.id}>DM milestone / reset: {r.note}</p>
                  ))}
              </article>
            ))}
          </Fold>
        </>
      )}
      <Fold title="NPC training requests" defaultOpen>
        {!state.requests.some((r) => !reviewsOnly || r.status === "pending") && (
          <p>No pending training requests.</p>
        )}
        {[...state.requests]
          .reverse()
          .filter((r) => !reviewsOnly || r.status === "pending")
          .map((r) => (
            <article className="journal-entry" key={r.id}>
              <h3>
                {r.trainerName} → {r.npcName}
              </h3>
              <p>
                {labels[r.category]} · {r.topic} · {hours(r.minutes)} hours · {r.status}
              </p>
              {r.description && <p>{r.description}</p>}
              {r.historicalContext && <p>Historical context: {r.historicalContext}</p>}
              {r.className && <p>Class comparison: {r.className}</p>}
              {r.reviewNote && <p>DM review: {r.reviewNote}</p>}
              {r.status === "pending" &&
                (dm ? (
                  <TrainingReview request={r} locked={locked} />
                ) : (
                  !locked && (
                    <CommandButton
                      input={{ kind: "downtime-training-cancel", requestId: r.id, before: r }}
                    >
                      Cancel training request
                    </CommandButton>
                  )
                ))}
            </article>
          ))}
      </Fold>
      {!dm && <AppLink href="/features/journal">Open Journal →</AppLink>}
    </section>
  );
}
function HourSettings({
  settings,
  locked,
}: {
  settings: { hoursPerDay: number; trainingHoursPerDay: number };
  locked: boolean;
}) {
  const [daily, setDaily] = useState(String(settings.hoursPerDay)),
    [training, setTraining] = useState(String(settings.trainingHoursPerDay));
  return (
    <Fold title="DM downtime hour settings">
      <CommandForm
        label="Save downtime hour settings"
        submitDisabled={locked}
        dirty={
          daily !== String(settings.hoursPerDay) ||
          training !== String(settings.trainingHoursPerDay)
        }
        submit={() => ({
          kind: "downtime-settings",
          before: settings,
          settings: { hoursPerDay: Number(daily), trainingHoursPerDay: Number(training) },
        })}
      >
        <label>
          Usable hours per downtime day
          <input
            aria-label="Usable hours per downtime day"
            type="number"
            min="1"
            max="24"
            required
            value={daily}
            onChange={(e) => setDaily(e.target.value)}
          />
        </label>
        <label>
          Hours per training day
          <input
            aria-label="Hours per training day"
            type="number"
            min="1"
            max="24"
            required
            value={training}
            onChange={(e) => setTraining(e.target.value)}
          />
        </label>
        <p>
          Changes apply to newly approved downtime periods. Earlier budgets and training history
          keep their original values.
        </p>
      </CommandForm>
    </Fold>
  );
}
function TrainingReview({ request: r, locked }: { request: TrainingRequest; locked: boolean }) {
  const [note, setNote] = useState(""),
    [approve, setApprove] = useState(true);
  const [historicalConfirmed, setHistoricalConfirmed] = useState(false);
  return (
    <CommandForm
      label="Record training decision"
      submitDisabled={locked || (approve && !!r.historicalContext && (!historicalConfirmed || !note.trim()))}
      dirty={!!note || !approve || historicalConfirmed}
      submit={() => ({
        kind: "downtime-training-review",
        requestId: r.id,
        before: r,
        approve,
        note,
        ...(historicalConfirmed ? { historicalConfirmed: true } : {}),
      })}
    >
      <label>
        Training decision
        <select
          aria-label="Training decision"
          value={approve ? "approve" : "deny"}
          onChange={(e) => setApprove(e.target.value === "approve")}
        >
          <option value="approve">Approve recorded training time</option>
          <option value="deny">Deny training</option>
        </select>
      </label>
      <label>
        Training review note
        <textarea
          aria-label="Training review note"
          maxLength={4000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <p>
        Confirm equal-or-lower levels, local conditions and completed time. When a sheet or class
        level is unavailable, record that confirmation here. Approval changes only the time
        allocation and tracking records.
      </p>
      <label><input type="checkbox" checked={historicalConfirmed} onChange={e => setHistoricalConfirmed(e.target.checked)} />
        Confirm historical training: together, equal-or-lower levels and completed time at that time
      </label>
    </CommandForm>
  );
}
function ResetCounter({
  record: r,
  requestIds,
  locked,
  categoryTotal = false,
}: {
  record: TrainingRequest;
  requestIds: string[];
  locked: boolean;
  categoryTotal?: boolean;
}) {
  const [note, setNote] = useState("");
  return (
    <Fold title={categoryTotal ? "DM category milestone & reset" : "DM milestone & reset"}>
      <CommandForm
        label={categoryTotal ? "Reset NPC category counter" : "Reset training counter"}
        submitDisabled={locked || !requestIds.length || !note.trim()}
        dirty={!!note}
        onDone={() => setNote("")}
        submit={() => categoryTotal ? ({
          kind: "downtime-training-reset-category", npcId: r.npcId, category: r.category,
          before: requestIds, note,
        }) : ({
          kind: "downtime-training-reset",
          trainerId: r.trainerId,
          npcId: r.npcId,
          category: r.category,
          topic: r.topic,
          before: requestIds,
          note,
        })}
      >
        <label>
          Manual milestone / reward note
          <textarea
            aria-label="Manual milestone / reward note"
            required
            maxLength={4000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <p>
          Reset only the progress counter. Lifetime time and history stay saved; no hours are
          refunded. Apply any reward or sheet changes manually.
        </p>
      </CommandForm>
    </Fold>
  );
}
