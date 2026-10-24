/**
 * Journey planner, phase B (docs/MAP-TILES.md "Journey planner"): party journeys on the map.
 * "Review journey…" saves the route (`party-journey`) and prepares a normal downtime preview with
 * the journey attached (`downtime-plan{journeyId}`); "Approve & depart" is the existing
 * `downtime-apply`, so money moves only there, once. Under way, the route is frozen and the party
 * marker follows approved downtime; arrival waits for the DM's "Move party here"
 * (`party-location{journeyId}`).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import type { CloudTable, CloudSeat } from "@/lib/quire/cloud";
import type { Command, CommandRequest } from "@/lib/quire/commands";
import { applyCommand } from "@/lib/quire/commands";
import { readFinance } from "@/lib/quire/finance";
import { formatCopper } from "@/lib/quire/money";
import { readMarketLocations } from "@/lib/quire/shop-locations";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { newCommandId } from "@/lib/quire/command-id";
import {
  readTravel,
  OPEN_JOURNEY_STATUSES,
  type Journey,
  type JourneyLeg,
} from "@/lib/quire/journey-schema";
import {
  quoteHash,
  journeyTravellers,
  measureJourney,
  type JourneyQuote,
} from "@/lib/quire/journey-engine";
import {
  aboutTime,
  downtimeDays,
  formatMiles,
  journeyDayPlan,
  legIndexAt,
  routePointAt,
  type RoutePoint,
} from "@/lib/quire/journey";
import type { CampaignMap } from "@/lib/quire/world-schema";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import type { RouteDraft } from "./map-route-planner";
import { terrainLabel } from "./map-route-planner";
import { Button, Modal, Segmented, Switch } from "./ui";
import { AppLink } from "./app-link";
import { CommandForm } from "./world-tools";
import { defaultLocationMap } from "@/lib/quire/connected-maps";
import { readTabletopSession } from "@/lib/quire/tabletop";
import { DEFAULT_TRAVEL } from "@/lib/quire/journey-schema";
import { journeyPlanHref, legTicks } from "@/lib/quire/journey-ui";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { Footprints, Lock, Route as RouteIcon, X } from "lucide-react";

const DM_SEAT: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
type Table = CloudTable;
const journeysOf = (t: Pick<CloudTable, "journal">) => t.journal?.world?.journeys ?? [];
const placeName = (t: Pick<CloudTable, "journal">, id?: string | null) =>
  id ? readMarketLocations(t.journal?.market).locations.find((l) => l.id === id)?.name : undefined;
export const journeyTitle = (t: Pick<CloudTable, "journal">, j: Journey) => {
  const from = placeName(t, j.originLocationId),
    to = placeName(t, j.destinationLocationId);
  return `${from ?? "The party"} → ${to ?? "a point on the map"}`;
};
const journeyName = (t: Pick<CloudTable, "journal">, j: Journey) =>
  `Journey to ${placeName(t, j.destinationLocationId) ?? "a point on the map"}`.slice(0, 100);
export const pendingJourneyPreview = (t: Pick<CloudTable, "journal">, journeyId: string) =>
  readFinance(t.journal?.finance).downtime.find(
    (d) => d.status === "pending" && d.quote.journey?.journeyId === journeyId,
  );
const totalDeci = (j: Journey) => (j.frozen?.legDeciMiles ?? []).reduce((s, l) => s + l, 0);
const legText = (leg: JourneyLeg) => terrainLabel(leg);
/** The current leg of a journey under way. */
function currentLeg(j: Journey) {
  if (!j.frozen) return 0;
  const legs = j.frozen.legDeciMiles ?? j.legs.map(() => 1);
  return legIndexAt(legs, j.elapsedMinutes / j.frozen.durationMinutes);
}

/** How far along a journey is (0–1), by approved travel time. */
const journeyProgress = (j: Journey) =>
  j.status === "arrived" || j.status === "completed"
    ? 1
    : j.frozen
      ? Math.min(1, j.elapsedMinutes / j.frozen.durationMinutes)
      : 0;
/**
 * The journey progress bar (mockup 6): travelled part filled, a tick where each leg ends. Ticks
 * need leg distances, which a private map's projection doesn't carry, so players there get the
 * bar alone. Built from spans so it can sit inside the status chip's button.
 */
export function JourneyProgressBar({ journey: j }: { journey: Journey }) {
  const progress = journeyProgress(j),
    percent = Math.round(progress * 100);
  const ticks = j.frozen?.legDeciMiles ? legTicks(j.frozen.legDeciMiles) : [];
  return (
    <span
      className="map-journey-progress"
      role="progressbar"
      aria-label="Journey progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <span className="map-journey-progress-fill" style={{ width: `${progress * 100}%` }} />
      {ticks.map((t, i) => (
        <span key={i} className="map-journey-progress-tick" style={{ left: `${t * 100}%` }} />
      ))}
    </span>
  );
}
/** The next named place ahead of a journey under way, when this viewer may see it. */
function nextPlace(t: Pick<CloudTable, "journal">, j: Journey) {
  if (!j.points || j.status !== "active") return undefined;
  const ahead = j.points.slice(currentLeg(j) + 1);
  return ahead.map((p) => placeName(t, p.locationId)).find(Boolean);
}

/** A journey from the planner's drawn route, as a new (or edited) proposal. */
export function journeyFromDraft(
  t: Table,
  draft: RouteDraft,
  map: CampaignMap,
  options: { id: string; requestedBy: string; message?: string; base?: Journey },
): Journey {
  const travel = readTravel(t.journal?.world?.travel);
  const first = draft.points[0],
    last = draft.points.at(-1)!;
  const base = options.base;
  return {
    id: options.id,
    status: "proposed",
    requestedBy: options.requestedBy,
    ...(options.message !== undefined ? { message: options.message.slice(0, 500) } : {}),
    mapId: map.id,
    points: draft.points.map((p) => ({
      x: p.x,
      y: p.y,
      ...(p.locationId ? { locationId: p.locationId } : {}),
    })),
    legs: draft.terrain.map((t) => ({ environment: t.environment, ...(t.biome ? { biome: t.biome } : {}) })),
    originLocationId: first.locationId ?? null,
    destinationLocationId: last.locationId ?? null,
    pace: base?.pace ?? { preset: "normal", milesPerDay: travel.paces.normal },
    forcedMarchHours: base?.forcedMarchHours ?? 0,
    costs: base?.costs ?? { rations: false, mounts: false, payerId: null, mountHoldingIds: [] },
    elapsedMinutes: 0,
    downtimeIds: [],
    createdAt: base?.createdAt ?? Date.now(),
  };
}
/** Back to a proposal (for an edit before departure): unfrozen, nothing travelled. */
const asProposal = (j: Journey, change: Partial<Journey>): Journey => {
  const { frozen: _frozen, decidedAt: _decided, ...rest } = j;
  return { ...rest, ...change, status: "proposed", elapsedMinutes: 0, downtimeIds: [] };
};

/** Runs a few commands in order with one busy/error state (each is its own receipt). */
function useJourneyActions() {
  const { commandOutcome, commandBatch } = useEconomy();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const run = async (work: () => Promise<string | void>) => {
    if (busy) return false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const message = await work();
      if (message) setNotice(message);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The journey action failed. Nothing changed.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, notice, run, commandOutcome, commandBatch, setError };
}
const planCommand = (t: Table, j: Journey, days: number): CommandRequest => ({
  id: newCommandId(),
  kind: "downtime-plan",
  name: journeyName(t, j),
  days,
  journeyId: j.id,
});
/** The full days still to travel on a journey. */
const remainingDays = (j: Journey, duration?: number) =>
  downtimeDays((duration ?? j.frozen?.durationMinutes ?? 1440) - j.elapsedMinutes);

/** The planner's party actions: DM Review journey… / Save draft; players Send to the DM. */
export function JourneyPlanActions({
  table,
  map,
  draft,
  onReview,
}: {
  table: Table;
  map: CampaignMap;
  draft: RouteDraft;
  onReview: (journeyId: string) => void;
}) {
  const seat = useSeat(),
    dm = seat.role === "dm";
  const actions = useJourneyActions();
  const [message, setMessage] = useState("");
  const open = journeysOf(table).find((j) =>
    (OPEN_JOURNEY_STATUSES as readonly string[]).includes(j.status),
  );
  const mine = table.purses.find((p) => p.kind === "character" && seat.purseIds.includes(p.id));
  const editable =
    open && (open.status === "proposed" || open.status === "planned") && (dm || open.requestedBy === mine?.id)
      ? open
      : undefined;
  if (open && !editable)
    return (
      <p className="map-route-help" role="status">
        {open.status === "active" || open.status === "arrived"
          ? "The party is already on a journey. Stop it before planning another."
          : "A journey is already waiting for the DM."}
      </p>
    );
  if (draft.points.length < 2) return null;
  if (!dm && !mine) return <p className="map-route-help">Join with a character to propose a journey.</p>;
  const build = () =>
    journeyFromDraft(table, draft, map, {
      id: editable?.id ?? newCommandId(),
      requestedBy: editable?.requestedBy ?? (dm ? "dm" : mine!.id),
      ...(dm ? (editable?.message !== undefined ? { message: editable.message } : {}) : { message }),
      base: editable,
    });
  const save = (j: Journey) =>
    actions.commandOutcome({ id: newCommandId(), kind: "party-journey", journeyId: j.id, before: editable ?? null, journey: j });
  return (
    <div className="map-journey-actions">
      {!dm && (
        <label className="map-route-typed">
          Message to the DM (optional)
          <textarea
            aria-label="Message to the DM"
            maxLength={500}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
      )}
      {dm ? (
        <>
          <Button
            disabled={actions.busy}
            onClick={() =>
              void actions.run(async () => {
                const j = build();
                const before = canonicalJson(editable ? asProposal(editable, {}) : null);
                if (!editable || before !== canonicalJson(j)) await save(j);
                const { durationMinutes } = measureJourney(map, j);
                await actions.commandOutcome(planCommand(table, j, downtimeDays(durationMinutes)));
                onReview(j.id);
              })
            }
          >
            Review journey…
          </Button>
          <Button
            variant="secondary"
            disabled={actions.busy}
            onClick={() => void actions.run(async () => mutationNotice(await save(build()), "Draft saved in the Review Inbox."))}
          >
            Save draft
          </Button>
        </>
      ) : (
        <Button
          disabled={actions.busy}
          onClick={() =>
            void actions.run(async () =>
              mutationNotice(await save(build()), "Sent to the DM's Review Inbox."),
            )
          }
        >
          {editable ? "Update request" : "Send to the DM"}
        </Button>
      )}
      {actions.error && <p role="alert">{actions.error}</p>}
      {actions.notice && <p role="status">{actions.notice}</p>}
    </div>
  );
}
/** Simulate the DM's review on this device (the same engine): the quote the room would make. */
export function simulatePlan(t: Table, j: Journey, days: number) {
  const command = { ...planCommand(t, j, days), id: "simulated-plan" } as Command;
  const next = applyCommand(t, DM_SEAT, command, { preview: true });
  const d = readFinance(next.journal?.finance).downtime.find((d) => d.id === "simulated-plan")!;
  return { quote: d.quote, journey: next.journal!.world!.journeys!.find((x) => x.id === j.id)! };
}

/** Days → "2.55 days of travel (3,666 min) → 3 days of downtime". */
const travelSummary = (minutes: number) =>
  `${(minutes / 1440).toFixed(2)} days of travel (${minutes.toLocaleString("en-US")} min) → ${downtimeDays(minutes)} ${downtimeDays(minutes) === 1 ? "day" : "days"} of downtime`;

/** The DM's journey review (mockup 5): the pending downtime preview with its journey section. */
export function JourneyReview({
  table,
  journeyId,
  close,
}: {
  table: Table;
  journeyId: string;
  close: () => void;
}) {
  const actions = useJourneyActions();
  const j = journeysOf(table).find((j) => j.id === journeyId);
  const preview = pendingJourneyPreview(table, journeyId);
  const travel = readTravel(table.journal?.world?.travel);
  const finance = readFinance(table.journal?.finance);
  const replaced = finance.downtime.find((d) => d.status === "pending" && d.id !== preview?.id);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [journeyId]);
  if (!j)
    return (
      <aside className="map-journey-panel map-glass" aria-label="Journey review">
        <p>This journey no longer exists.</p>
        <Button onClick={close}>Close</Button>
      </aside>
    );
  const underWay = j.status === "active";
  const quote = preview?.quote.journey;
  const duration = j.frozen?.durationMinutes;
  const days = preview?.days ?? (duration ? remainingDays(j) : 1);
  const all = duration ? remainingDays(j) : days;
  // Re-plan after a change: edits before departure go back through party-journey first.
  const map = table.journal?.world?.maps.find((m) => m.id === j.mapId);
  /** `"all"` re-plans every remaining day of the (possibly changed) route. */
  const replan = (change: Partial<Journey> | null, nextDays: number | "all" = days) =>
    actions.run(async () => {
      let current = j;
      if (change && !underWay) {
        const next = asProposal(j, change);
        await actions.commandOutcome({ id: newCommandId(), kind: "party-journey", journeyId: j.id, before: j, journey: next });
        current = next;
      }
      const count =
        nextDays === "all"
          ? current.frozen
            ? remainingDays(current)
            : map
              ? downtimeDays(measureJourney(map, current).durationMinutes)
              : 1
          : nextDays;
      await actions.commandOutcome(planCommand(table, current, Math.max(1, Math.min(3650, count))));
    });
  const holdings = table.holdings.filter(
    (h) => h.kind === "item" && h.quantity > 0 && (j.frozen?.travellerIds ?? journeyTravellers(table).map((p) => p.id)).concat(table.purses.filter((p) => p.kind === "party").map((p) => p.id)).includes(h.purseId),
  );
  const mountLike = holdings.filter((h) => /horse|pony|mule|donkey|camel|ox|mount|steed|mare|stallion|riding|pack animal/i.test(`${h.name} ${(h as { category?: string }).category ?? ""}`));
  const mountChoices = mountLike.length ? mountLike : holdings;
  const payers = table.purses.filter((p) => p.kind === "party" || (p.kind === "character" && p.control !== "npc"));
  const payer = table.purses.find((p) => p.id === j.costs.payerId);
  const balance = quote && payer ? preview!.quote.balances.find((b) => b.purseId === payer.id) : undefined;
  const travellers = (j.frozen?.travellerIds ?? []).map((id) => table.purses.find((p) => p.id === id)?.name ?? "Unknown");
  const startDay = finance.day;
  const plan =
    j.frozen?.legDeciMiles && duration && quote
      ? journeyDayPlan(j.frozen.legDeciMiles, duration, quote.fromMinutes, quote.toMinutes, startDay)
      : [];
  const line = (kind: "rations" | "mounts") => quote?.lines.find((l) => l.kind === kind);
  // What an optional line would cost if turned on (mockup 5: "off · 7 sp, 5 cp").
  const quoteDays = preview?.days ?? days;
  const animals = j.costs.mountHoldingIds.reduce(
    (n, id) => n + (table.holdings.find((h) => h.id === id)?.quantity ?? 0),
    0,
  );
  const estimate = (kind: "rations" | "mounts") =>
    (kind === "rations" ? travellers.length : animals) *
    quoteDays *
    (kind === "rations" ? travel.rations : travel.mounts).unitCopper;
  const other = preview?.quote.lines.filter((l) => l.paid || l.unpaid) ?? [];
  return (
    <aside className="map-journey-panel map-journey-review map-glass" aria-label="Journey review">
      <div className="map-panel-heading">
        <span className="map-journey-glyph" aria-hidden="true">
          <RouteIcon size={18} />
        </span>
        <h2 ref={heading} tabIndex={-1}>
          Journey review · DM
        </h2>
        <button className="map-icon-button" aria-label="Close journey review" onClick={close}>
          <X size={16} />
        </button>
      </div>
      <p className="map-journey-sub">
        <strong>{journeyTitle(table, j)}</strong>
        <br />
        {j.legs.length} {j.legs.length === 1 ? "leg" : "legs"}
        {j.frozen?.legDeciMiles ? ` · ${formatMiles(totalDeci(j))}` : ""} · drawn on the map
      </p>
      {!preview ? (
        <div>
          <p>No downtime preview is prepared for this journey.</p>
          <Button disabled={actions.busy} onClick={() => void replan(null, "all")}>
            Prepare the review
          </Button>
        </div>
      ) : (
        <>
          <section aria-label="Pace">
            <h3>Pace</h3>
            {underWay ? (
              <p>
                {j.pace.milesPerDay} mi/day · frozen while the journey is under way.
              </p>
            ) : (
              <Segmented
                label="Pace"
                value={j.pace.preset === "custom" ? "normal" : j.pace.preset}
                onChange={(preset) =>
                  void replan({ pace: { preset, milesPerDay: travel.paces[preset] } }, "all")
                }
                options={(["slow", "normal", "fast"] as const).map((p) => ({
                  value: p,
                  label: `${p[0].toUpperCase()}${p.slice(1)} ${travel.paces[p]} mi/day`,
                }))}
              />
            )}
            <p className="map-route-help">Presets come from this campaign's travel settings.</p>
            <details className="map-journey-settings">
              <summary>Edit paces and travel settings</summary>
              <TravelSettingsForm table={table} />
            </details>
            {travel.forcedMarch.allowed && !underWay ? (
              <label className="map-route-typed">
                Forced march (extra hours a day)
                <select
                  aria-label="Forced march hours"
                  value={j.forcedMarchHours}
                  onChange={(e) => void replan({ forcedMarchHours: Number(e.target.value) }, "all")}
                >
                  {Array.from({ length: travel.forcedMarch.maxExtraHours + 1 }, (_, h) => (
                    <option key={h} value={h}>
                      {h ? `${h} extra ${h === 1 ? "hour" : "hours"}` : "Off"}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="map-route-help">
                Forced march {travel.forcedMarch.allowed ? `${j.forcedMarchHours} h` : "off"}. Lootsplitter doesn't roll saves or apply exhaustion; the DM decides.
              </p>
            )}
          </section>
          <section aria-label="Days">
            <h3>Days</h3>
            {duration && (
              <p>
                {travelSummary(duration - j.elapsedMinutes)}.{" "}
                {quote?.arrived && plan.at(-1)?.arrivalMinute !== undefined
                  ? `Departs day ${startDay}; arrives day ${plan.at(-1)!.day} at ${aboutTime(plan.at(-1)!.arrivalMinute!)}.`
                  : `Day ${startDay} to day ${startDay + days - 1}; the party stops on the road.`}
              </p>
            )}
            <ol className="map-journey-days">
              {plan.map((d) => (
                <li key={d.day}>
                  <strong>Day {d.day}</strong>{" "}
                  {d.legs.map((i) => legText(j.legs[i])).filter((v, i, a) => a.indexOf(v) === i).join(", ")} ·{" "}
                  {formatMiles(d.deci)}
                  {d.arrivalMinute !== undefined && j.destinationLocationId
                    ? ` · reach ${placeName(table, j.destinationLocationId)} ${aboutTime(d.arrivalMinute)}`
                    : ""}
                </li>
              ))}
            </ol>
            {all > 1 && (
              <label className="map-route-typed">
                Apply now
                <select
                  aria-label="Apply now"
                  value={Math.min(days, all)}
                  onChange={(e) => void replan(null, Number(e.target.value))}
                >
                  {Array.from({ length: all }, (_, i) => all - i).map((n) => (
                    <option key={n} value={n}>
                      {n === all
                        ? `All ${n} days · arrive${j.destinationLocationId ? ` at ${placeName(table, j.destinationLocationId)}` : ""}`
                        : `${n} ${n === 1 ? "day" : "days"} · stop on the road (day ${startDay + n})`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="map-route-help">
              Fewer days leaves the party on the route; the rest is applied later from the same frozen route.
            </p>
          </section>
          <section aria-label="Who travels">
            <h3>Who travels</h3>
            <p>{travellers.length ? `The party: ${travellers.join(", ")}.` : "No characters travel with the party."}</p>
            {quote?.notices
              .filter((n) => n.kind === "stays-behind")
              .map((n) => (
                <p key={n.purseId} className="map-route-help">
                  {n.text} Change that on their sheet first if they should come.
                </p>
              ))}
          </section>
          <section aria-label="Costs">
            <h3>Costs</h3>
            <p className="map-route-help">
              Downtime quote · {preview.days} {preview.days === 1 ? "day" : "days"} · day {preview.fromDay} → day {preview.fromDay + preview.days} · from the existing downtime engine
            </p>
            <h4>Journey (optional lines)</h4>
            {underWay ? (
              <p className="map-route-help">Optional lines were set when the journey was approved.</p>
            ) : null}
            {(["rations", "mounts"] as const).map((kind) => {
              const l = line(kind);
              const label = kind === "rations" ? "Trail rations" : "Mount upkeep";
              const unit = (kind === "rations" ? travel.rations : travel.mounts).unitCopper;
              return (
                <div key={kind} className="map-journey-cost">
                  {underWay ? (
                    <strong>{label}: {j.costs[kind] ? "on" : "off"}</strong>
                  ) : (
                    <Switch
                      label={label}
                      checked={j.costs[kind]}
                      hint={`${kind === "rations" ? `${travellers.length} ${travellers.length === 1 ? "traveller" : "travellers"}` : animals ? `${animals} ${animals === 1 ? "animal" : "animals"}` : "no animals chosen"} × ${quoteDays} ${quoteDays === 1 ? "day" : "days"} × ${formatCopper(unit)} (catalogue: ${(kind === "rations" ? travel.rations : travel.mounts).name})${payer ? ` · paid by ${payer.name}` : ""}`}
                      onChange={(on) =>
                        void replan({
                          costs: {
                            ...j.costs,
                            [kind]: on,
                            payerId: j.costs.payerId ?? table.purses.find((p) => p.kind === "party")?.id ?? payers[0]?.id ?? null,
                          },
                        })
                      }
                    />
                  )}
                  {!l && !j.costs[kind] && (kind === "rations" || animals > 0) && (
                    <p className="map-route-help">Off · would be {formatCopper(estimate(kind))}</p>
                  )}
                  {l && (
                    <p className={l.short ? "map-journey-warning" : undefined}>
                      −{formatCopper(l.copper)} · {l.quantity} × {formatCopper(l.unitCopper)}
                      {l.short ? " · the payer can't cover this" : ""}
                    </p>
                  )}
                  {kind === "mounts" && j.costs.mounts && !underWay && (
                    <fieldset className="map-journey-mounts">
                      <legend>Animals that count as mounts</legend>
                      {mountChoices.map((h) => (
                        <label key={h.id}>
                          <input
                            type="checkbox"
                            checked={j.costs.mountHoldingIds.includes(h.id)}
                            onChange={(e) =>
                              void replan({
                                costs: {
                                  ...j.costs,
                                  mountHoldingIds: e.target.checked
                                    ? [...j.costs.mountHoldingIds, h.id]
                                    : j.costs.mountHoldingIds.filter((x) => x !== h.id),
                                },
                              })
                            }
                          />
                          {h.name} × {h.quantity}
                        </label>
                      ))}
                      {!mountChoices.length && <p>No animals are held by the travellers or party funds.</p>}
                    </fieldset>
                  )}
                </div>
              );
            })}
            {(j.costs.rations || j.costs.mounts) && !underWay && (
              <label className="map-route-typed">
                Paid by
                <select
                  aria-label="Journey costs paid by"
                  value={j.costs.payerId ?? ""}
                  onChange={(e) => void replan({ costs: { ...j.costs, payerId: e.target.value || null } })}
                >
                  {payers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <h4>Already in every downtime (unchanged)</h4>
            {other.length ? (
              <ul className="map-journey-lines">
                {other.map((l) => (
                  <li key={l.id}>
                    {l.name} · {l.kind === "income" ? "+" : "−"}
                    {formatCopper(l.paid)}
                    {l.unpaid ? ` (${formatCopper(l.unpaid)} unpaid)` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="map-route-help">No other income, upkeep or loan payments fall due.</p>
            )}
            {payer && balance && (
              <p>
                <strong>{payer.name}</strong> {formatCopper(balance.before)} → {formatCopper(balance.after)}. Nothing moves until you approve. A retry with the same command ID can't charge twice.
              </p>
            )}
          </section>
          {quote?.notices.some((n) => n.kind === "left-behind") && (
            <section aria-label="Shops the party leaves behind" className="map-journey-notice">
              <h3>Shops the party leaves behind</h3>
              <p>
                While travelling, located shops are unavailable to players, as with Move party freely:{" "}
                {quote.notices.filter((n) => n.kind === "left-behind").map((n) => n.text).join(", ")}.
              </p>
            </section>
          )}
          {quote?.notices.some((n) => n.kind === "schedule") && (
            <section aria-label="Shops that close during travel" className="map-journey-notice">
              <h3>Shops that close during travel</h3>
              <ul>
                {quote.notices.filter((n) => n.kind === "schedule").map((n, i) => (
                  <li key={i}>{n.text}</li>
                ))}
              </ul>
            </section>
          )}
          {replaced && (
            <section className="map-journey-notice" aria-label="Replaces a pending preview">
              <h3>Replaces a pending preview</h3>
              <p>
                The pending downtime preview “{replaced.name}” ({replaced.days} days) will be cancelled; only one downtime preview can be pending. No coins moved for it.
              </p>
            </section>
          )}
          <section aria-label="Arrival">
            <h3>Arrival</h3>
            <p>
              When the marker reaches {placeName(table, j.destinationLocationId) ?? "the end of the route"} you'll be asked to confirm Move party here. Nothing moves the party there automatically.
            </p>
          </section>
          <div className="map-route-actions">
            <Button
              variant="secondary"
              disabled={actions.busy}
              onClick={() =>
                void actions.run(async () => {
                  await actions.commandOutcome({ id: newCommandId(), kind: "downtime-cancel", downtimeId: preview.id });
                  close();
                })
              }
            >
              Cancel
            </Button>
            <Button variant="secondary" disabled={actions.busy} onClick={close}>
              Save to Review Inbox
            </Button>
            <Button
              disabled={actions.busy || !!quote?.lines.some((l) => l.short)}
              onClick={() =>
                void actions.run(async () => {
                  const outcome = await actions.commandOutcome({
                    id: newCommandId(),
                    kind: "downtime-apply",
                    downtimeId: preview.id,
                    endSession: false,
                  });
                  return mutationNotice(outcome, underWay ? "Downtime approved; the party travels on." : "Approved. The party departs.");
                })
              }
            >
              {underWay ? `Approve ${preview.days} ${preview.days === 1 ? "day" : "days"}` : "Approve & depart"}
            </Button>
          </div>
        </>
      )}
      {actions.error && <p role="alert">{actions.error}</p>}
      {actions.notice && <p role="status">{actions.notice}</p>}
    </aside>
  );
}

/**
 * The journey on the map: its frozen route (travelled solid, ahead dashed; players get only the
 * stretches their projection carries), a status chip, the DM's progress panel and the arrival
 * confirmation.
 */
export function useMapJourney({
  map,
  table,
  openReview,
}: {
  map: CampaignMap;
  table: Table;
  openReview: (journeyId: string) => void;
}) {
  const seat = useSeat(),
    dm = seat.role === "dm";
  const shown = journeysOf(table).find((j) => ["planned", "active", "arrived"].includes(j.status));
  const onMap = !!shown && shown.mapId === map.id;
  const [panelOpen, setPanelOpen] = useState(false),
    [notYet, setNotYet] = useState("");
  useEffect(() => setPanelOpen(false), [map.id]);
  const progress = shown?.frozen ? shown.elapsedMinutes / shown.frozen.durationMinutes : 0;
  const travelled = useMemo<{ done: RoutePoint[]; ahead: RoutePoint[] } | undefined>(() => {
    if (!onMap || !shown?.points || !shown.frozen) return undefined;
    const legs = shown.frozen.legDeciMiles ?? shown.legs.map(() => 1);
    const at = routePointAt(shown.points, legs, progress),
      index = legIndexAt(legs, progress);
    return {
      done: [...shown.points.slice(0, index + 1), at],
      ahead: [at, ...shown.points.slice(index + 1)],
    };
  }, [onMap, shown, progress]);
  const svg = (ps: RoutePoint[]) => ps.map((p) => `${p.x * 1000},${p.y * 1000}`).join(" ");
  const overlay =
    onMap && shown && (shown.points || shown.runs) ? (
      <svg className="map-route-journey" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        {shown.status === "planned" && shown.points ? (
          <polyline className="map-route-ahead" points={svg(shown.points)} />
        ) : travelled ? (
          <>
            <polyline className="map-route-travelled" points={svg(travelled.done)} />
            <polyline className="map-route-ahead" points={svg(travelled.ahead)} />
          </>
        ) : (
          shown.runs?.map((run, i) => <polyline key={i} className="map-route-ahead" points={svg(run)} />)
        )}
      </svg>
    ) : null;
  const day = readFinance(table.journal?.finance).day;
  const leg = shown ? shown.legs[currentLeg(shown)] : undefined;
  const to = shown ? placeName(table, shown.destinationLocationId) : undefined;
  const statusText =
    shown?.status === "arrived"
      ? `Arrived near ${to ?? "the end of the route"}`
      : `On the road · Day ${day}`;
  const next = shown ? nextPlace(table, shown) : undefined;
  // The chip opens the journey panel; while that panel is open it carries the same facts, so the
  // chip steps aside (on phones the two would otherwise overlap).
  const chip =
    shown && shown.status !== "planned" && !panelOpen ? (
      <button
        type="button"
        className="map-journey-chip map-glass"
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen(true)}
      >
        <strong>
          {statusText}
          <span className="map-journey-chip-percent">{Math.round(progress * 100)}%</span>
        </strong>
        <JourneyProgressBar journey={shown} />
        <span>
          {shown.frozen ? `${(shown.elapsedMinutes / 1440).toFixed(2)} of ${(shown.frozen.durationMinutes / 1440).toFixed(2)} days` : ""}
          {leg ? ` · ${legText(leg)}` : ""}
          {shown.status === "arrived"
            ? dm
              ? " · waiting for you to move the party in"
              : " · waiting for the DM"
            : next && dm
              ? ` · next: ${next}`
              : to
                ? ` · bound for ${to}`
                : ""}
        </span>
      </button>
    ) : null;
  const panel =
    panelOpen && shown && shown.status !== "planned" ? (
      dm ? (
        <JourneyProgress table={table} journey={shown} close={() => setPanelOpen(false)} openReview={openReview} />
      ) : (
        <JourneyStatusCard table={table} journey={shown} close={() => setPanelOpen(false)} />
      )
    ) : null;
  const arrival =
    dm && shown?.status === "arrived" && notYet !== shown.id ? (
      <ArrivalDialog table={table} journey={shown} notYet={() => setNotYet(shown.id)} />
    ) : null;
  return {
    overlay,
    chip,
    panel,
    arrival,
    journey: shown,
    onMap,
    /** Open the journey panel (progress for the DM, the status card for players). */
    openPanel: () => setPanelOpen(true),
  };
}

/** DM: journey under way (mockup 6A). */
function JourneyProgress({
  table,
  journey: j,
  close,
  openReview,
}: {
  table: Table;
  journey: Journey;
  close: () => void;
  openReview: (journeyId: string) => void;
}) {
  const actions = useJourneyActions();
  const legs = j.frozen?.legDeciMiles ?? [];
  const now = currentLeg(j);
  const points = j.points ?? [];
  const name = (i: number) =>
    placeName(table, points[i]?.locationId) ?? `Point ${i + 1}`;
  const doneDeci = Math.round((totalDeci(j) * j.elapsedMinutes) / (j.frozen?.durationMinutes ?? 1));
  const remaining = remainingDays(j);
  return (
    <aside className="map-journey-panel map-glass" aria-label="Journey under way">
      <div className="map-panel-heading">
        <span className="map-journey-glyph" aria-hidden="true">
          <RouteIcon size={18} />
        </span>
        <h2>{j.status === "arrived" ? "Journey arrived" : "Journey under way"}</h2>
        <button className="map-icon-button" aria-label="Close journey" onClick={close}>
          <X size={16} />
        </button>
      </div>
      <p className="map-journey-sub">
        {journeyTitle(table, j)} · {j.pace.preset === "custom" ? `${j.pace.milesPerDay} mi/day` : `${j.pace.preset[0].toUpperCase()}${j.pace.preset.slice(1)} pace`}
      </p>
      <JourneyProgressBar journey={j} />
      <p>
        <span className="map-journey-tag">
          <Lock size={13} aria-hidden="true" /> Day {readFinance(table.journal?.finance).day}
        </span>{" "}
        <strong>Route locked while travelling.</strong> Travelled {formatMiles(doneDeci)} of {formatMiles(totalDeci(j))} · {(j.elapsedMinutes / 1440).toFixed(2)} of {((j.frozen?.durationMinutes ?? 0) / 1440).toFixed(2)} days. Approved {j.downtimeIds.length} {j.downtimeIds.length === 1 ? "downtime" : "downtimes"}.
      </p>
      <ol className="map-route-legs" aria-label="Journey legs">
        {legs.map((deci, i) => (
          <li key={i}>
            <span className="map-route-leg-name">
              {name(i)} → {name(i + 1)}
            </span>
            <span className="map-route-leg-numbers">
              {formatMiles(deci)} · {i < now || j.status === "arrived" ? "done" : i === now ? "now" : "ahead"} · {legText(j.legs[i])}
            </span>
          </li>
        ))}
      </ol>
      <div className="map-route-actions">
        {j.status === "active" && (
          <Button
            disabled={actions.busy}
            onClick={() =>
              void actions.run(async () => {
                if (!pendingJourneyPreview(table, j.id))
                  await actions.commandOutcome(planCommand(table, j, remaining));
                openReview(j.id);
              })
            }
          >
            Prepare remaining {remaining} {remaining === 1 ? "day" : "days"}…
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={actions.busy}
          onClick={() =>
            void actions.run(async () =>
              mutationNotice(
                await actions.commandOutcome({
                  id: newCommandId(),
                  kind: "party-journey",
                  journeyId: j.id,
                  before: j,
                  journey: { ...j, status: "stopped" },
                }),
                "Stopped on the road. The journey stays in the journal.",
              ),
            )
          }
        >
          Stop the journey here
        </Button>
      </div>
      <p className="map-route-help">
        The route, scale and duration were frozen when the journey was approved, like a voyage. To change course, stop the journey here and plan a new one from the party's position. Stopping changes no money and keeps this journey in the journal.
      </p>
      {actions.error && <p role="alert">{actions.error}</p>}
      {actions.notice && <p role="status">{actions.notice}</p>}
    </aside>
  );
}

/** Players (and private maps): a text-only card — destination if known, day, progress, terrain. */
export function JourneyStatusCard({
  table,
  journey: j,
  close,
  inline = false,
  children,
}: {
  table: Table;
  journey: Journey;
  close?: () => void;
  /** In page flow (Downtime screen, a player with no shared map) instead of over the map. */
  inline?: boolean;
  children?: ReactNode;
}) {
  const day = readFinance(table.journal?.finance).day;
  const now = currentLeg(j);
  const to = placeName(table, j.destinationLocationId);
  return (
    <aside
      className={`map-journey-panel map-journey-card map-glass${inline ? " map-journey-inline" : ""}`}
      aria-label="Travelling"
    >
      <p className="map-journey-eyebrow">
        <Footprints size={14} aria-hidden="true" /> {j.status === "arrived" ? "Arrived" : "Travelling"}
      </p>
      <div className="map-panel-heading">
        <h2>{j.status === "arrived" ? `Arrived near ${to ?? "the end of the route"}` : to ? `Bound for ${to}` : "On the road"}</h2>
        {close && (
          <button className="map-icon-button" aria-label="Close journey" onClick={close}>
            <X size={16} />
          </button>
        )}
      </div>
      <p>
        {to ? `Bound for ${to}. ` : ""}Day {day} · {(j.elapsedMinutes / 1440).toFixed(1)} of {((j.frozen?.durationMinutes ?? 0) / 1440).toFixed(1)} days · now: {legText(j.legs[now])}
      </p>
      <JourneyProgressBar journey={j} />
      <ol className="map-route-legs" aria-label="Journey legs">
        {j.legs.map((leg, i) => (
          <li key={i}>
            <span className="map-route-leg-name">{legText(leg)}</span>
            <span className="map-route-leg-numbers">{i < now || j.status === "arrived" ? "done" : i === now ? "now" : "ahead"}</span>
          </li>
        ))}
      </ol>
      <p className="map-route-help">
        {j.mapId
          ? "Shops and services are unavailable while travelling."
          : "The DM's map for this journey is private, so its route and the party's position aren't shown. Shops and services are unavailable while travelling."}
        {j.status === "arrived" ? " Waiting for the DM to move the party in." : ""}
      </p>
      {children}
    </aside>
  );
}

/** DM: arrival needs "Move party here" (mockup 6D); "Not yet" keeps the party on the road. */
function ArrivalDialog({ table, journey: j, notYet }: { table: Table; journey: Journey; notYet: () => void }) {
  const actions = useJourneyActions();
  const to = placeName(table, j.destinationLocationId);
  const market = readMarketLocations(table.journal?.market);
  const open = table.shops.filter((s) => s.locationId === j.destinationLocationId && !s.closed);
  const [show, setShow] = useState(false);
  const scene = j.destinationLocationId
    ? defaultLocationMap(
        (table.journal?.world?.maps ?? []).filter((m) => m.visible),
        j.destinationLocationId,
      )
    : undefined;
  return (
    <Modal open onOpenChange={(o) => !o && notYet()} title="Move party here?">
      <p>The party has reached {to ?? "the end of its route"} on the frozen route.</p>
      <ul className="map-journey-lines">
        {to && <li>Party location becomes {to} (the existing Move party here).</li>}
        {open.length > 0 && <li>Shops there follow their schedules: {open.map((s) => s.name).join(", ")} open today.</li>}
        <li>The journey is marked complete in the journal.</li>
        <li>No time passes and nothing is charged: that was settled in the approved downtime.</li>
      </ul>
      {!j.destinationLocationId && (
        <p>This journey ends at a point on the map, not a place. Stop the journey to keep the party there.</p>
      )}
      {scene && (
        <label className="map-journey-share">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Also show {to} to players
          <span className="map-route-help"> Runs Activate for players afterwards; the result reports each step.</span>
        </label>
      )}
      <div className="map-route-actions">
        <Button variant="secondary" onClick={notYet}>
          Not yet
        </Button>
        <Button
          disabled={actions.busy || !j.destinationLocationId}
          onClick={() =>
            void actions.run(async () => {
              await actions.commandOutcome({
                id: newCommandId(),
                kind: "party-location",
                journeyId: j.id,
                before: market.currentLocationId,
                locationId: j.destinationLocationId!,
                beforePosition: table.journal?.world?.partyPosition
                  ? canonicalJson(table.journal.world.partyPosition)
                  : undefined,
              });
              if (!show || !scene) return;
              const session = readTabletopSession(table);
              try {
                await actions.commandOutcome({
                  id: newCommandId(),
                  kind: "tabletop-session",
                  before: table.journal?.world?.tabletop ?? null,
                  session: { ...session, activeMapId: scene.id, activationId: crypto.randomUUID(), camera: null },
                });
              } catch (e) {
                throw Error(
                  `The party moved to ${to}, but ${scene.name} could not be shown to players: ${e instanceof Error ? e.message : "try Activate for players"}.`,
                );
              }
            })
          }
        >
          Move party here
        </Button>
      </div>
      <p className="map-route-help">
        “Not yet” keeps the party on the road at the route's end, for an encounter at the gates or a detour.
      </p>
      {actions.error && <p role="alert">{actions.error}</p>}
    </Modal>
  );
}

/**
 * Review Inbox entries (mockup 5C): journey requests and drafts. The DM can deny with a reason,
 * open the full review on the map, or "Approve & depart" in one step: `downtime-plan` and
 * `downtime-apply` as one atomic batch that stops if anything changed since the entry was drawn.
 */
export function JourneyInbox({ table }: { table: Table }) {
  const seat = useSeat(),
    dm = seat.role === "dm";
  const entries = journeysOf(table).filter((j) =>
    dm
      ? j.status === "proposed" || j.status === "planned"
      : seat.purseIds.includes(j.requestedBy) && ["proposed", "denied"].includes(j.status),
  );
  if (!entries.length) return null;
  return (
    <section className="map-journey-inbox" aria-label="Journey requests">
      <h3>Journeys</h3>
      {entries.map((j) => (dm ? <JourneyInboxEntry key={j.id} table={table} journey={j} /> : <PlayerJourneyRequest key={j.id} table={table} journey={j} />))}
    </section>
  );
}
function JourneyInboxEntry({ table, journey: j }: { table: Table; journey: Journey }) {
  const actions = useJourneyActions();
  const [reason, setReason] = useState(""),
    [share, setShare] = useState(true);
  const batchId = useRef(newCommandId());
  const requester = j.requestedBy === "dm" ? "the DM (draft)" : `${table.purses.find((p) => p.id === j.requestedBy)?.name ?? "a player"} (player)`;
  const simulated = useMemo(() => {
    try {
      const first = simulatePlan(table, j, 1);
      const days = remainingDays(first.journey);
      const result = days === 1 ? first : simulatePlan(table, j, days);
      return { ...result, days, error: "" };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "This journey can't be reviewed yet.", days: 0, quote: undefined, journey: undefined };
    }
  }, [table, j]);
  const quote = simulated.quote?.journey as JourneyQuote | undefined;
  const finance = readFinance(table.journal?.finance);
  const replaces = finance.downtime.find((d) => d.status === "pending" && d.quote.journey?.journeyId !== j.id);
  const link = j.mapId ? `/maps?map=${encodeURIComponent(j.mapId)}&plan=${encodeURIComponent(`journey:${j.id}`)}` : "/maps";
  const deci = simulated.journey ? totalDeci(simulated.journey) : 0;
  return (
    <article className="journal-entry map-journey-entry">
      <strong>
        Journey · {j.status === "planned" ? "reviewed" : "new"} · {journeyTitle(table, j)}
        {simulated.days ? ` · ${simulated.days} ${simulated.days === 1 ? "day" : "days"}` : ""}
      </strong>
      <p>
        Requested by {requester} · {j.pace.preset === "custom" ? "Custom" : `${j.pace.preset[0].toUpperCase()}${j.pace.preset.slice(1)}`} pace
        {deci ? ` · ${formatMiles(deci)}` : ""} · {j.legs.length} {j.legs.length === 1 ? "leg" : "legs"} ·{" "}
        {j.costs.rations || j.costs.mounts ? "with optional costs" : "time only, no optional costs"}.
      </p>
      {j.message && <blockquote>“{j.message}”</blockquote>}
      {quote && (
        <ul className="map-place-chips">
          {quote.notices.some((n) => n.kind === "left-behind") && (
            <li>{quote.notices.filter((n) => n.kind === "left-behind").length} shops unavailable while away</li>
          )}
          {quote.notices.some((n) => n.kind === "schedule") && (
            <li>{quote.notices.filter((n) => n.kind === "schedule").length} schedule closures</li>
          )}
          {replaces && <li>Replaces “{replaces.name}”</li>}
          {quote.lines.some((l) => l.short) && <li>A payer is short</li>}
        </ul>
      )}
      {simulated.error && <p role="alert">{simulated.error}</p>}
      <div className="map-place-links">
        <AppLink className="settings-link" href={link}>
          Open route on map
        </AppLink>
        <AppLink className="settings-link" href={link}>
          Open full review
        </AppLink>
      </div>
      {j.status === "proposed" && (
        <>
          <label className="map-route-typed">
            Reason (optional, shown to the player if you deny)
            <input aria-label="Reason for denying this journey" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label className="map-journey-share">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Show the reason to the player
          </label>
        </>
      )}
      <div className="map-route-actions">
        {j.status === "proposed" && (
          <Button
            variant="secondary"
            disabled={actions.busy}
            onClick={() =>
              void actions.run(async () =>
                mutationNotice(
                  await actions.commandOutcome({
                    id: newCommandId(),
                    kind: "party-journey",
                    journeyId: j.id,
                    before: j,
                    journey: { ...j, status: "denied", reason: { text: reason.trim(), showToPlayer: share } },
                  }),
                  "Journey denied.",
                ),
              )
            }
          >
            Deny
          </Button>
        )}
        <Button
          disabled={actions.busy || !simulated.quote || !!quote?.lines.some((l) => l.short)}
          onClick={() =>
            void actions.run(async () => {
              const plan = planCommand(table, j, simulated.days) as Extract<CommandRequest, { kind: "downtime-plan" }>;
              const planId = `${batchId.current}-plan`;
              const expected = simulatePlan(table, j, simulated.days);
              const outcome = await actions.commandBatch(batchId.current, [
                { ...plan, id: planId, expectedQuoteHash: quoteHash(expected.quote) },
                { id: `${batchId.current}-apply`, kind: "downtime-apply", downtimeId: planId, endSession: false },
              ]);
              return mutationNotice(outcome, "Approved. The party departs.");
            })
          }
        >
          Approve & depart · {simulated.days || "?"} {simulated.days === 1 ? "day" : "days"}
        </Button>
      </div>
      <p className="map-route-help">
        Approve runs the same preview and apply as the full review, in one batch: if anything changed since this entry was drawn up (balances, the route's map, a pending preview), it stops and asks you to open the full review.
      </p>
      {actions.error && <p role="alert">{actions.error}</p>}
      {actions.notice && <p role="status">{actions.notice}</p>}
    </article>
  );
}
function PlayerJourneyRequest({ table, journey: j }: { table: Table; journey: Journey }) {
  const actions = useJourneyActions();
  const day = readFinance(table.journal?.finance).day;
  const link = j.mapId ? `/maps?map=${encodeURIComponent(j.mapId)}&plan=${encodeURIComponent(`journey:${j.id}`)}` : "/maps";
  return (
    <article className="journal-entry map-journey-entry">
      <strong>Journey to {placeName(table, j.destinationLocationId) ?? "a point on the map"}</strong>
      <p>
        {j.status === "denied" ? "Denied by the DM" : `Waiting for the DM · day ${day}`} ·{" "}
        {j.pace.preset[0].toUpperCase()}
        {j.pace.preset.slice(1)} pace · {j.legs.length} {j.legs.length === 1 ? "leg" : "legs"}.
      </p>
      {j.reason?.text && <p>DM: “{j.reason.text}”</p>}
      <div className="map-route-actions">
        <AppLink className="settings-link" href={link}>
          Show route
        </AppLink>
        {j.status === "proposed" && (
          <Button
            variant="secondary"
            disabled={actions.busy}
            onClick={() =>
              void actions.run(async () =>
                mutationNotice(
                  await actions.commandOutcome({
                    id: newCommandId(),
                    kind: "party-journey",
                    journeyId: j.id,
                    before: j,
                    journey: { ...j, status: "cancelled" },
                  }),
                  "Request withdrawn.",
                ),
              )
            }
          >
            Withdraw request
          </Button>
        )}
      </div>
      <p className="map-route-help">
        Players see days, pace and terrain, plus any cost line charged to a purse they control. Other purses, NPC wages and DM notes stay with the DM.
      </p>
      {actions.error && <p role="alert">{actions.error}</p>}
      {actions.notice && <p role="status">{actions.notice}</p>}
    </article>
  );
}
export type JourneyMapView = ReturnType<typeof useMapJourney>;
export type { ReactNode };

/** DM travel settings: paces, forced march and the catalogue prices of the optional lines. */
function TravelSettingsForm({ table }: { table: Table }) {
  const { catalog } = useEconomy();
  const stored = table.journal?.world?.travel;
  const current = readTravel(stored);
  const price = (name: string, fallback: number) =>
    catalog.find((c) => c.name.toLowerCase() === name.toLowerCase())?.baseCopper ?? fallback;
  const [paces, setPaces] = useState(current.paces),
    [allowed, setAllowed] = useState(current.forcedMarch.allowed),
    [hours, setHours] = useState(current.forcedMarch.maxExtraHours);
  const rations = { name: current.rations.name, unitCopper: price(current.rations.name, current.rations.unitCopper) };
  const mounts = { name: current.mounts.name, unitCopper: price(current.mounts.name, current.mounts.unitCopper) };
  const valid = Object.values(paces).every((n) => Number.isInteger(n) && n >= 1 && n <= 200);
  return (
    <CommandForm
      label="Save travel settings"
      submitDisabled={!valid}
      dirty={canonicalJson(paces) !== canonicalJson(current.paces) || allowed !== current.forcedMarch.allowed}
      submit={() => ({
        kind: "travel-settings",
        before: stored ?? null,
        after: { paces, forcedMarch: { allowed, maxExtraHours: allowed ? hours : 0 }, rations, mounts },
      })}
    >
      <div className="map-route-fields">
        {(["slow", "normal", "fast"] as const).map((p) => (
          <label key={p}>
            {p[0].toUpperCase() + p.slice(1)} pace (miles a day)
            <input
              type="number"
              min={1}
              max={200}
              step={1}
              aria-label={`${p} pace miles a day`}
              value={paces[p]}
              onChange={(e) => setPaces({ ...paces, [p]: Math.round(Number(e.target.value)) })}
            />
          </label>
        ))}
        <label className="map-journey-share">
          <input type="checkbox" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} /> Allow forced march
        </label>
        {allowed && (
          <label>
            Most extra hours a day
            <select aria-label="Most forced march hours" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {Array.from({ length: 8 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="map-route-help">
        Prices are taken from your catalogue when you save: {rations.name} {formatCopper(rations.unitCopper)}, {mounts.name} {formatCopper(mounts.unitCopper)}. Defaults: {DEFAULT_TRAVEL.paces.slow}/{DEFAULT_TRAVEL.paces.normal}/{DEFAULT_TRAVEL.paces.fast} miles a day, forced march off.
      </p>
    </CommandForm>
  );
}

/**
 * Travel where people look for it outside the map (Downtime screen; a player whose DM keeps the
 * journey's map private). The party's journey, if any, as the same text-only card players get on
 * the map; "Plan a journey on the map" (the planner from the party's position); a player's own
 * requests; and, for the DM, the requests waiting in the Review Inbox.
 */
export function JourneyTravelSection({
  table,
  planLink = true,
}: {
  table: Table;
  /** Off where there is no map to plan on (a player with no shared map). */
  planLink?: boolean;
}) {
  const seat = useSeat(),
    dm = seat.role === "dm";
  const journeys = journeysOf(table);
  const current = journeys.find((j) => ["active", "arrived"].includes(j.status));
  const reviewed = journeys.find((j) => j.status === "planned");
  const waiting = journeys.filter((j) => j.status === "proposed" || j.status === "planned").length;
  const href = journeyPlanHref(table.journal);
  const mapHref = (j: Journey, plan?: string) =>
    j.mapId
      ? `/maps?map=${encodeURIComponent(j.mapId)}${plan ? `&plan=${encodeURIComponent(plan)}` : ""}`
      : "/maps";
  return (
    <section className="journey-travel" aria-label="Travel">
      <h2>Travel</h2>
      {current ? (
        <JourneyStatusCard table={table} journey={current} inline>
          <div className="map-route-actions">
            {current.mapId && (
              <AppLink className="settings-link" href={mapHref(current)}>
                Show the journey on the map →
              </AppLink>
            )}
          </div>
        </JourneyStatusCard>
      ) : (
        <p className="text-sm">
          {dm
            ? "Draw the party's route on a map: Lootsplitter measures each leg, turns it into downtime days and moves the party along as you approve them."
            : "Draw a route on a map and send it to the DM. The party travels as the DM approves downtime."}
        </p>
      )}
      <div className="map-route-actions">
        {planLink && !current && (
          <AppLink className="settings-link journey-plan-link" href={href}>
            Plan a journey on the map →
          </AppLink>
        )}
        {dm && reviewed && (
          <AppLink className="settings-link" href={mapHref(reviewed, `journey:${reviewed.id}`)}>
            Open the journey review →
          </AppLink>
        )}
        {dm && waiting > 0 && (
          <AppLink className="settings-link" href="/features/review">
            Journeys in the Review Inbox ({waiting}) →
          </AppLink>
        )}
      </div>
      {!dm && <JourneyInbox table={table} />}
    </section>
  );
}
/** The Downtime screen's Travel section (reads the viewer's own projected table). */
export function DowntimeJourneys() {
  const table = useWorldTable() as unknown as CloudTable;
  return <JourneyTravelSection table={{ ...table, handouts: [] }} />;
}
