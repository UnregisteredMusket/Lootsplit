import { useState, type ReactNode } from "react";
import { coachGroup } from "@/lib/quire/party-groups-journeys";
import { useCommandId } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { postNotes } from "@/lib/quire/chat";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { formatCopper, toCopper } from "@/lib/quire/money";
import type { CloudTable } from "@/lib/quire/cloud";
import type { Npc } from "@/lib/quire/world-schema";
import type { Purse } from "@/lib/quire/types";
import {
  readServices,
  type ServiceOffer,
  type ServiceOrder,
  type ServiceProvider,
  type ServiceRequest,
} from "@/lib/quire/services-schema";
import { readFinance } from "@/lib/quire/finance";
import { courierRecipients, miles } from "@/lib/quire/services-courier";
import { mountLike } from "@/lib/quire/mounts";
import { journeyTravellers, measureJourney, openJourney } from "@/lib/quire/journey-engine";
import { downtimeDays, journeyDurationMinutes } from "@/lib/quire/journey";
import { readMarketLocations } from "@/lib/quire/shop-locations";
import { canAccessEstate } from "@/lib/quire/estate";
import { readEstate } from "@/lib/quire/estate-schema";
import {
  lessonFee,
  identifyCandidates,
  identifyLock,
  staffableProperties,
  rumourLock,
  rumourQuote,
  approvedOffers,
  beneficiaryRule,
  componentCandidates,
  maxUnits,
  offerSettlementLock,
  providerLock,
  serviceBeneficiaries,
  serviceLabel,
  serviceQuote,
} from "@/lib/quire/services";

// The temple, workshop and inn branches of the NPC conversation (docs/SERVICES.md). Offers are
// numbered replies; the order details open in the same drawer Barter uses. Every coin movement
// is one service command; nothing here charges by itself.

export type TalkReply = {
  tag?: ReactNode;
  text: string;
  sub?: ReactNode;
  tone?: "check" | "red" | "dm" | "leave";
  disabled?: string;
  run?: () => void | Promise<void>;
  href?: string;
};
export type TalkLine =
  | { kind: "npc"; text: string; key: string }
  | { kind: "pc"; text: string; tag?: string; key: string }
  | { kind: "sys"; node: ReactNode; key: string }
  | { kind: "order"; id: string; key: string };

export const serviceWhen = (day: number, minute = 0) =>
  `Day ${day}, ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const intro: Partial<Record<ServiceProvider["kind"], string>> = {
  temple: "Say what ails you, and who. The faithful ask an offering for each blessing.",
  sage: "Show me. And keep your fingers off the pearl.",
  trainer: "Pick your subject. You pay for each day you actually sit with me, not before.",
  courier: "Post goes out at noon. To whom?",
  workshop: "Tell me what you need made. Good work takes time.",
  inn: "Rooms upstairs, food on the fire. What'll it be?",
  hire: "Steady hands, fair wages. Where would they work?",
};
const offerLine: Partial<Record<ServiceProvider["kind"], string>> = {
  temple: "Who is it for, and what do you bring?",
  workshop: "Here's what that will take.",
  inn: "How many of you, and for how long?",
  trainer: "Here's how the lessons would go.",
  courier: "Seal it here. I'll not read it. Probably.",
};

/** What the character says when choosing a preset offer; custom offers use their name. */
const offerSpeech: Record<string, string> = {
  "cure-wounds": "Mend our wounds.",
  "lesser-restoration": "Cleanse this sickness.",
  "remove-curse": "Lift this curse.",
  revivify: "They only just fell. Bring them back.",
  "greater-restoration": "Restore what was taken.",
  "raise-dead": "Please, raise our friend.",
  identify: "What is this thing?",
  letter: "To someone I know.",
  resurrection: "Can you restore a body long gone?",
};
const speech = (o: ServiceOffer) => offerSpeech[o.key] ?? `${o.name}, please.`;

/** The flags under an offer reply: time, component and review. */
export function offerFlags(o: ServiceOffer): ReactNode {
  const flags: { kind: string; text: string }[] = [];
  if (o.time.kind === "instant")
    flags.push({
      kind: "time",
      text: o.time.castingMinutes ? `${o.time.castingMinutes >= 60 ? `${o.time.castingMinutes / 60} hour` : `${o.time.castingMinutes} min`} casting · clock not advanced` : "Instant",
    });
  if (o.time.kind === "downtime-days") flags.push({ kind: "time", text: `${o.time.days} downtime ${o.time.days === 1 ? "day" : "days"}${o.time.perUnit ? " each" : ""}` });
  if (o.time.kind === "per-night") flags.push({ kind: "time", text: "Per night" });
  if (o.time.kind === "training") {
    flags.push({ kind: "time", text: o.category === "martial" ? "Martial" : o.category === "academic" ? "Academic" : "Skill or Profession" });
    flags.push({ kind: "agree", text: "Paid per session" });
  }
  for (const c of o.components ?? [])
    flags.push({
      kind: "comp",
      text: `${c.label}${c.minCopper ? ` ${formatCopper(c.minCopper)}+` : ""}${c.consumed ? " · consumed" : ""}`,
    });
  if (o.review === "dm") flags.push({ kind: "review", text: "DM review · charged on approval" });
  return (
    <span className="svc-flags">
      {flags.map((f, i) => (
        <span key={i} className={`svc-flag ${f.kind}`}>
          {f.text}
        </span>
      ))}
    </span>
  );
}

/** The immutable receipt of a paid order. */
export function ServiceReceipt({ order, payer }: { order: ServiceOrder; payer: string }) {
  const t = order.terms,
    names = t.beneficiaries.map((b) => b.name).join(", "),
    consumed = t.components.filter((c) => c.consumed),
    casting = t.offer.time.kind === "instant" ? t.offer.time.castingMinutes : undefined;
  return (
    <div className="svc-receipt" aria-label={`Receipt: ${t.offer.name}`}>
      <div className="svc-receipt-head">
        <b>
          {t.kind === "inn"
            ? `Stay · ${t.shopName}`
            : t.stabling
              ? `Stabling · ${t.shopName}`
              : t.route
              ? `Coach · ${t.route.placeName}`
              : t.letter
              ? `Letter to ${t.letter.recipientName}`
              : t.lessons
              ? `Lessons · ${t.lessons.topic}`
              : t.item
                ? `${t.offer.name} · ${t.item.name}`
                : t.offer.name}
        </b>
        <span className={`svc-status ${order.status}`}>
          {t.route && order.status === "completed"
            ? "Departed"
            : t.letter && order.status === "active"
            ? "In transit"
            : t.lessons && order.status === "active"
            ? "Agreed"
            : order.status === "completed"
            ? order.reveal
              ? "Answered"
              : order.history.some((h) => h.status === "requested")
                ? "Approved"
                : "Paid"
            : order.status}
        </span>
      </div>
      <dl className="svc-kv">
        {t.stabling && (
          <>
            <dt>Animals</dt>
            <dd>{t.stabling.animals.map((a) => `${a.name}${a.quantity > 1 ? ` × ${a.quantity}` : ""}`).join(", ")}</dd>
            <dt>Nights</dt>
            <dd>
              {t.stabling.nights}
              {t.stabling.feed ? ", feed included" : ""}
            </dd>
          </>
        )}
        {t.route && (
          <>
            <dt>To</dt>
            <dd>
              {t.route.placeName} · {miles(t.route.deciMiles)} mi
            </dd>
            <dt>Passengers</dt>
            <dd>{t.route.passengers}</dd>
          </>
        )}
        {t.letter && (
          <>
            <dt>To</dt>
            <dd>
              {t.letter.recipientName}, {t.letter.placeName}
            </dd>
            <dt>Distance</dt>
            <dd>
              {miles(t.letter.deciMiles)} mi · {formatCopper(t.priceCopper)}
            </dd>
            <dt>Arrives</dt>
            <dd>After {t.workDays} approved downtime {t.workDays === 1 ? "day" : "days"}</dd>
          </>
        )}
        {t.lessons && (
          <>
            <dt>Pupil</dt>
            <dd>{t.lessons.pupilName}</dd>
            <dt>Teacher</dt>
            <dd>
              {t.npcName}, {t.shopName}
            </dd>
            <dt>Rate</dt>
            <dd>{formatCopper(t.lessons.dayCopper)} a training day, charged per approved session</dd>
            <dt>Up to</dt>
            <dd>{t.lessons.maxDays} training days</dd>
            {(order.sessions?.length ?? 0) > 0 && (
              <>
                <dt>Paid</dt>
                <dd>
                  {formatCopper(order.sessions!.reduce((n, x) => n + x.feeCopper, 0))} in {order.sessions!.length}{" "}
                  {order.sessions!.length === 1 ? "ledger line" : "ledger lines"}
                </dd>
              </>
            )}
          </>
        )}
        {t.item && (
          <>
            <dt>Item</dt>
            <dd>
              {t.item.name}
              {order.reveal?.rename && order.reveal.rename !== t.item.name ? `, now “${order.reveal.rename}”` : ""}
            </dd>
          </>
        )}
        {t.kind === "temple" && !t.item && !t.lessons && (
          <>
            <dt>Cast on</dt>
            <dd>{names}</dd>
          </>
        )}
        {t.kind === "inn" && t.inn && (
          <>
            <dt>Guests</dt>
            <dd>{names}</dd>
            <dt>Room</dt>
            <dd>
              {t.inn.tierName} · {t.units} {t.units === 1 ? "night" : "nights"}
            </dd>
            <dt>Meals</dt>
            <dd>{t.inn.meals ? `${t.inn.meals} a day` : "None"}</dd>
          </>
        )}
        <dt>Paid by</dt>
        <dd>
          {payer} · {formatCopper(t.priceCopper)}
        </dd>
        {consumed.length > 0 && (
          <>
            <dt>Consumed</dt>
            <dd>
              {consumed
                .map((c) => (c.supplied === "party" ? `${c.holdingName ?? c.label} (yours)` : `${c.label} (supplied)`))
                .join(", ")}
            </dd>
          </>
        )}
        <dt>Where</dt>
        <dd>
          {t.shopName}, {t.placeName}
        </dd>
        {order.paidDay !== undefined && (
          <>
            <dt>When</dt>
            <dd>
              {serviceWhen(order.paidDay, order.paidMinute)}
              {casting ? ` (${casting >= 60 ? `${casting / 60}-hour` : `${casting}-minute`} casting noted, clock unchanged)` : ""}
            </dd>
          </>
        )}
      </dl>
      <p className="svc-record-only">
        {t.stabling
          ? "Recorded only. Leaving early refunds nothing automatically. On a journey, the journey's own mount upkeep line still applies."
          : t.route
          ? "The trip is the party's journey: it follows the journey's rules for progress, arrival and stopping."
          : t.letter
          ? `The letter is a record. Nothing happens on its own when it arrives; the DM answers as ${t.letter.recipientName}.`
          : t.lessons
          ? `Recorded only. Finishing the lessons doesn't add a proficiency; the DM decides what ${t.lessons.pupilName} learns.`
          : t.item
          ? `Recorded. The answer is in your thread with ${t.npcName}${order.reveal?.appendToNotes ? " and in the item's notes" : ""}.`
          : t.kind === "temple"
          ? `Recorded only. The DM updates ${names}'s sheet: hit points, conditions, death.`
          : t.kind === "inn"
            ? "Recorded only. Buying a room doesn't grant a rest or change hit points. Ask the DM for a long rest."
            : "Recorded with its terms. Work advances only with DM-approved downtime."}
      </p>
    </div>
  );
}

/** One order as transcript lines: what was asked, then where it stands. */
export function orderLines(o: ServiceOrder, payer: string, npcName: string): TalkLine[] {
  const t = o.terms,
    on = t.kind === "temple" && t.beneficiaries.length ? <> on <b>{t.beneficiaries[0].name}</b></> : null;
  const brought = t.components.filter((c) => c.supplied === "party").map((c) => c.holdingName ?? c.label);
  const lines: TalkLine[] = [];
  const reviewed = o.history.some((h) => h.status === "requested");
  if (reviewed)
    lines.push({
      kind: "sys",
      key: `${o.id}-ask`,
      node: (
        <>
          {t.item ? (
            <>
              {payer} asks {t.npcName} to identify <b>{t.item.name}</b>
            </>
          ) : (
            <>
              {payer} asks for <b>{t.offer.name}</b>
            </>
          )}
          {on} · {formatCopper(t.priceCopper)}
          {brought.length ? ` · ${payer}'s ${brought.join(", ")}` : ""}.
        </>
      ),
    });
  if (o.status === "requested")
    lines.push({
      kind: "sys",
      key: `${o.id}-queued`,
      node: (
        <>
          Sent to the DM's queue. Nothing has been charged
          {brought.length ? ` and ${brought.join(", ")} stays with ${payer}` : ""}
          {t.item ? `, and ${t.item.name} stays with ${payer}` : ""} until the DM {t.item ? "answers" : "approves"}.
        </>
      ),
    });
  const decided = [...o.history].reverse().find((h) => h.status === "completed" || h.status === "denied" || h.status === "active");
  if (o.status === "denied") {
    lines.push({ kind: "npc", key: `${o.id}-sorry`, text: "I am sorry. It cannot be done." });
    lines.push({ kind: "sys", key: `${o.id}-reason`, node: <>The DM decided: {o.message.replace(/ Nothing was charged\.$/, "")}</> });
    lines.push({ kind: "sys", key: `${o.id}-nothing`, node: <>Request denied. Nothing was charged{brought.length ? ` and ${brought.join(", ")} stays with ${payer}` : ""}.</> });
  }
  if (o.status === "cancelled" && reviewed)
    lines.push({ kind: "sys", key: `${o.id}-withdrawn`, node: <>Request withdrawn. Nothing was charged.</> });
  if (o.status === "ready")
    lines.push({ kind: "sys", key: `${o.id}-ready`, node: <>Your {t.offer.output.kind === "holding" ? t.offer.output.name : t.offer.name} is ready to collect here.</> });
  if (o.status === "claimed")
    lines.push({
      kind: "sys",
      key: `${o.id}-claimed`,
      node: (
        <>
          Collected into {payer}'s inventory: <b>{t.offer.output.kind === "holding" ? t.offer.output.name : t.offer.name}</b>
          {t.units > 1 ? ` ×${t.units}` : ""}.
        </>
      ),
    });
  if (["completed", "active", "paused"].includes(o.status)) {
    const note = reviewed
      ? decided?.note.replace(/^(Approved and paid\.( Recorded only; the DM updates character sheets\.| Work advances only with DM-approved downtime\.)?|Answered and paid\. The answer is in your thread with [^.]*\.)\s*/, "")
      : "";
    if (note) lines.push({ kind: "sys", key: `${o.id}-dm`, node: <>The DM decided: {note}</> });
    if (o.reveal) lines.push({ kind: "sys", key: `${o.id}-answered`, node: <>The DM answered {payer}'s request.</> });
    lines.push({
      kind: "npc",
      key: `${o.id}-done`,
      text: o.reveal
        ? o.reveal.text
        : t.letter
          ? "Rider leaves at noon."
          : t.stabling
            ? "Stalls are ready. I'll see them fed."
            : t.route
              ? "Safe travels."
          : t.lessons
          ? "Come by after the bells. Bring your own tools."
          : t.kind === "temple"
            ? "It is done."
            : t.kind === "inn"
              ? "Room's at the top of the stairs."
              : "I'll get to work.",
    });
    lines.push({ kind: "sys", key: `${o.id}-receipt`, node: <ServiceReceipt order={o} payer={payer} /> });
  }
  void npcName;
  return lines;
}

type Pick_ = Record<string, string>; // componentKey -> "provider" | holdingId

export function useServiceTalk({
  table,
  npc,
  character,
  push,
  nextKey,
  send,
  onBack,
}: {
  table: CloudTable;
  npc: Npc;
  character: Purse | undefined;
  push: (...lines: TalkLine[]) => void;
  nextKey: (prefix: string) => string;
  send: (input: Record<string, unknown>, id: string, renew: () => void) => Promise<boolean>;
  onBack: () => void;
}) {
  const [providerId, setProviderId] = useState<string>();
  const [offerKey, setOfferKey] = useState<string>();
  const [beneficiaries, setBeneficiaries] = useState<string[]>([]);
  const [picks, setPicks] = useState<Pick_>({});
  /** How many pieces the player brings for an "either" component (the rest is supplied). */
  const [counts, setCounts] = useState<Record<string, number>>({});
  /** Inn: the room tier and meals a day; the rumour list. */
  const [tierKey, setTierKey] = useState<string>();
  const [meals, setMeals] = useState(2);
  const [rumours, setRumours] = useState(false);
  const [units, setUnits] = useState(1);
  const [mine, setMine] = useState<string[]>([]);
  /** Identify: the carried item the sage looks at. */
  const [itemId, setItemId] = useState("");
  /** Stable: the animals, feed and the coach route. */
  const [animalIds, setAnimalIds] = useState<string[]>([]);
  const [feed, setFeed] = useState(true);
  const [routeKey, setRouteKey] = useState("");
  /** Courier: the recipient and the letter. */
  const [recipientId, setRecipientId] = useState("");
  const [letterText, setLetterText] = useState("");
  /** Hire: the chosen role, property and the name on the contract. */
  const [roleKey, setRoleKey] = useState<string>();
  const [propertyId, setPropertyId] = useState("");
  const [hireName, setHireName] = useState("");
  const [proposed, setProposed] = useState<string[]>([]);
  const seat = useSeat();
  const services = readServices(table.journal?.services);
  const provider = services.providers.find((p) => p.id === providerId);
  const offer = provider ? approvedOffers(provider).find((o) => o.key === offerKey) : undefined;
  const purseId = character?.id;
  const placeOf = (locationId: string) =>
    readMarketLocations(table.journal?.market).locations.find((l) => l.id === locationId)?.name ?? "the destination";
  /** A drawn route's length in deci-miles (0 when it can't be measured). */
  const routeDeci = (r: NonNullable<ServiceProvider["routes"]>[number]) => {
    const map = table.journal?.world?.maps.find((m) => m.id === r.mapId);
    if (!map || !r.points) return 0;
    try {
      return measureJourney(map, { points: r.points, pace: { preset: "custom", milesPerDay: r.paceMilesPerDay }, forcedMarchHours: 0 } as never).legDeciMiles.reduce((n, l) => n + l, 0);
    } catch {
      return 0;
    }
  };
  /** Animals the payer could stable: theirs and the party fund's; someone else's are listed, blocked. */
  const stableAnimals = (payerId: string) =>
    table.holdings
      .filter((h) => h.kind === "item" && h.quantity > 0 && mountLike(h as typeof h & { category?: string }))
      .filter((h) => table.purses.some((p) => p.id === h.purseId && (p.kind === "party" || (p.kind === "character" && !p.nonParty && p.control !== "npc"))))
      .map((h) => {
        const owner = table.purses.find((p) => p.id === h.purseId);
        return {
          holding: h,
          owner,
          blocked:
            h.purseId !== payerId && owner?.kind !== "party"
              ? `${owner?.name ?? "Someone"}'s own. ${owner?.name ?? "They"} books for it.`
              : h.custody || h.reservedFor || h.pool
                ? "Not here with the party."
                : "",
        };
      });
  const trainingHoursPerDay =
    (table.journal?.downtimeActivities as { settings?: { trainingHoursPerDay?: number } } | undefined)?.settings?.trainingHoursPerDay ?? 8;

  const request: ServiceRequest | null =
    provider && offer && purseId
      ? {
          beneficiaryPurseIds: beneficiaries,
          units,
          ...(offer.target && itemId ? { itemHoldingId: itemId } : {}),
          ...(provider.kind === "stable" && offer.time.kind === "per-night" ? { stabling: { animalHoldingIds: animalIds, feed } } : {}),
          ...(offer.time.kind === "coach" && routeKey ? { routeKey } : {}),
          ...(provider.kind === "courier" && recipientId && letterText.trim()
            ? { letter: { recipientNpcId: recipientId, text: letterText.trim() } }
            : {}),
          ...(provider.kind === "inn" && tierKey ? { inn: { tierKey, meals } } : {}),
          contributions: (offer.components ?? []).flatMap((c) => {
            const pick = picks[c.key];
            if (!pick || pick === "provider") return [];
            const needed = c.quantity * (c.perUnit ? units : 1),
              lot = table.holdings.find((h) => h.id === pick);
            // "Either": bring what you carry, the provider supplies the rest.
            const most = Math.min(needed, lot?.quantity ?? needed);
            const quantity = c.supply === "either" ? Math.max(1, Math.min(most, counts[c.key] ?? most)) : needed;
            return [{ componentKey: c.key, holdingId: pick, quantity }];
          }),
        }
      : null;
  let quote: ReturnType<typeof serviceQuote> | undefined,
    problem = "";
  if (provider && offer && purseId && request)
    try {
      quote = serviceQuote(table, provider.id, offer.key, purseId, request);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  const action = useCommandId(`${providerId}|${offerKey}|${purseId}|${request ? canonicalJson(request) : ""}`);
  const hireAction = useCommandId(`${providerId}|hire|${roleKey}|${propertyId}|${hireName}`);
  const role = provider?.kind === "hire" ? provider.link?.roles?.find((r) => r.key === roleKey) : undefined;
  // Properties this seat may staff (the server checks the same permission).
  const estate = readEstate(table.journal?.propertyOperations);
  const properties =
    provider?.kind === "hire" && purseId
      ? staffableProperties(table, purseId).filter((h) => canAccessEstate(table, estate, h.id, seat))
      : [];
  const rumourAction = useCommandId(`${providerId}|rumours|${purseId}`);

  function chooseOffer(o: ServiceOffer) {
    setOfferKey(o.key);
    setUnits(o.time.kind === "training" ? Math.min(10, maxUnits(o)) : 1);
    if (provider!.kind === "stable" && o.time.kind === "per-night" && purseId) {
      setAnimalIds(stableAnimals(purseId).filter((a) => !a.blocked).map((a) => a.holding.id));
      setFeed(!!o.feedCopper);
    }
    if (provider!.kind === "courier" && purseId)
      setRecipientId(courierRecipients(table, provider!, purseId).find((r) => !r.blocked)?.npcId ?? "");
    if (o.target && purseId) setItemId(identifyCandidates(table, purseId).find((c) => !c.blocked)?.holding.id ?? "");
    const rule = beneficiaryRule(provider!.kind, o);
    setBeneficiaries(rule.min && purseId ? [purseId] : []);
    // Bring your own when you carry a fitting lot; otherwise the provider supplies it.
    const next: Pick_ = {};
    for (const c of o.components ?? []) {
      const own = purseId ? componentCandidates(table, purseId, c).find((x) => !x.blocked) : undefined;
      next[c.key] = c.supply === "provider" ? "provider" : own ? own.holding.id : c.supply === "party" ? "" : "provider";
    }
    setPicks(next);
    setCounts({});
    if (provider!.kind === "inn") {
      // Everyone in the party who is here stays; Comfortable unless the inn doesn't offer it.
      setBeneficiaries(serviceBeneficiaries(table, provider!).filter((b) => b.here).map((b) => b.purseId));
      const tiers = (o.tiers ?? []).filter((x) => x.offered);
      setTierKey((tiers.find((x) => x.key === "comfortable") ?? tiers[0])?.key);
      setMeals(2);
    }
  }

  /** Open a provider's branch from the hub or the sub-list. */
  function open(id: string, text: string, tag: string) {
    const p = services.providers.find((x) => x.id === id);
    if (!p) return;
    push({ kind: "pc", text, tag, key: nextKey("pc") }, { kind: "npc", text: intro[p.kind] ?? "What can I do for you?", key: nextKey("npc") });
    setProviderId(id);
    setOfferKey(undefined);
    setRumours(false);
    setRoleKey(undefined);
    // An inn with one offer opens its booking straight away.
    const offers = approvedOffers(p);
    if (p.kind === "inn" && offers.length === 1) {
      setOfferKey(offers[0].key);
      setUnits(1);
      setBeneficiaries(serviceBeneficiaries(table, p).filter((b) => b.here).map((b) => b.purseId));
      const tiers = (offers[0].tiers ?? []).filter((x) => x.offered);
      setTierKey((tiers.find((x) => x.key === "comfortable") ?? tiers[0])?.key);
      setMeals(2);
    }
  }
  const close = () => {
    setProviderId(undefined);
    setOfferKey(undefined);
    setRumours(false);
    setRoleKey(undefined);
  };
  const forSale = provider?.rumours ?? [];
  const rumourReply = (): TalkReply => ({
    tag: (
      <>
        Rumours <em>· {forSale.filter((r) => !rumourLock(table, provider!, r.id, purseId)).length} for sale</em>
      </>
    ),
    text: "Heard anything interesting?",
    run: () => {
      push(
        { kind: "pc", text: "Heard anything interesting?", tag: "Rumours", key: nextKey("pc") },
        { kind: "npc", text: "Might have. Ears cost, mind. Coin on the bar.", key: nextKey("npc") },
      );
      setRumours(true);
    },
  });

  const replies: TalkReply[] = [];
  const payerName = character?.name ?? "You";
  if (provider?.kind === "hire" && !role) {
    const lock = providerLock(table, provider, purseId);
    for (const r of provider.link?.roles ?? [])
      replies.push({
        tag: (
          <>
            Hire · {r.name}{" "}
            <em>
              · {formatCopper(r.wageCopper)} / {r.periodDays === 1 ? "day" : `${r.periodDays} days`} ↗
            </em>
          </>
        ),
        text: `I need a ${r.name.toLowerCase()}.`,
        sub: "Proposes a staff contract for one of the party's properties. The DM approves it; wages follow the property's staff rules.",
        disabled: lock || undefined,
        run: () => {
          push(
            { kind: "pc", text: `I need a ${r.name.toLowerCase()}.`, tag: `Hire · ${r.name}`, key: nextKey("pc") },
            { kind: "npc", text: "Where would they work?", key: nextKey("npc") },
          );
          setRoleKey(r.key);
          setPropertyId(properties[0]?.id ?? "");
          setHireName(r.npcId ? (table.journal?.world?.npcs.find((n) => n.id === r.npcId)?.name ?? r.name) : r.name);
        },
      });
    replies.push({
      text: "Never mind.",
      tone: "leave",
      sub: "Back to the conversation.",
      run: () => {
        close();
        onBack();
      },
    });
  } else if (provider?.kind === "hire" && role) {
    const property = properties.find((h) => h.id === propertyId);
    replies.push({
      tag: (
        <>
          Propose hire <em>· DM review · nothing is paid now</em>
        </>
      ),
      text: "Send word when they can start.",
      tone: "dm",
      sub: property
        ? `${hireName || role.name} as ${role.name} at ${property.name}, ${formatCopper(role.wageCopper)} per ${role.periodDays === 1 ? "day" : `${role.periodDays} days`}.`
        : undefined,
      disabled: proposed.includes(hireAction.commandId)
        ? "Proposed. It waits for the DM."
        : !property
          ? "Choose a property to staff."
          : !hireName.trim()
            ? "Name the hireling."
            : undefined,
      run: async () => {
        if (!property) return;
        const id = hireAction.commandId;
        push({ kind: "pc", text: "Send word when they can start.", tag: "Propose hire", key: nextKey("pc") });
        const ok = await send(
          {
            kind: "estate-staff",
            before: null,
            staff: {
              id,
              propertyId: property.id,
              name: hireName.trim().slice(0, 160),
              role: role.name,
              wageCopper: role.wageCopper,
              periodDays: role.periodDays,
              status: seat.role === "dm" ? "active" : "proposed",
              manager: false,
              duties: [],
              budgetCopper: 0,
              budgetPeriodDays: 30,
              budgetStartDay: readFinance(table.journal?.finance).day,
              budgetSpentCopper: 0,
              notes: `Hired through ${provider.name} (${npc.name}).`,
              ...(role.npcId ? { npcId: role.npcId } : {}),
            },
          },
          id,
          hireAction.renew,
        );
        if (ok) {
          setProposed((x) => [...x, id]);
          push(
            {
              kind: "sys",
              key: nextKey("sys"),
              node: (
                <>
                  Staff contract proposed: <b>{hireName.trim()}</b>, {role.name} at {property.name}. It waits in the DM's Review
                  Inbox; nothing is paid until wages fall due under the property's staff rules.
                </>
              ),
            },
            { kind: "npc", text: "I'll send them along once it's settled.", key: nextKey("npc") },
          );
          setRoleKey(undefined);
        }
      },
    });
    replies.push({ text: "Never mind.", tone: "leave", sub: "Back to the roles.", run: () => setRoleKey(undefined) });
  } else if (provider && rumours) {
    for (const r of forSale) {
      const lock = rumourLock(table, provider, r.id, purseId);
      replies.push({
        tag: (
          <>
            Rumour <em>· {formatCopper(r.priceCopper)}</em>
          </>
        ),
        text: r.teaser,
        sub: lock ? undefined : `Only you get the full story, in your private thread with ${npc.name}.`,
        disabled: lock || undefined,
        run: async () => {
          if (!purseId) return;
          let q;
          try {
            q = rumourQuote(table, provider.id, r.id, purseId);
          } catch {
            return;
          }
          const id = `${rumourAction.commandId}-${r.id}`.slice(0, 150);
          push({ kind: "pc", text: r.teaser, tag: `Rumour · ${formatCopper(r.priceCopper)}`, key: nextKey("pc") });
          const ok = await send(
            { kind: "service-rumour", providerId: provider.id, rumourId: r.id, purseId, before: q.before },
            id,
            rumourAction.renew,
          );
          if (ok) push({ kind: "order", id, key: nextKey("order") });
        },
      });
    }
    replies.push({ text: "Never mind.", tone: "leave", sub: "Back to the inn.", run: () => setRumours(false) });
  } else if (provider && !offer) {
    const waiting = services.orders.filter((o) => o.providerId === provider.id && o.purseId === purseId && o.status === "requested");
    const ready = services.orders.filter((o) => o.providerId === provider.id && o.purseId === purseId && o.status === "ready");
    for (const r of ready) {
      const out = r.terms.offer.output,
        name = `${out.kind === "holding" ? out.name : r.terms.offer.name}${r.terms.units > 1 ? ` ×${r.terms.units}` : ""}`;
      replies.push({
        tag: `Collect · ${name}`,
        text: "I've come for my order.",
        sub: "Adds it to your inventory once.",
        run: async () => {
          setMine((m) => [...m, r.id]);
          push({ kind: "pc", text: "I've come for my order.", tag: "Collect", key: nextKey("pc") });
          if (await send({ kind: "service-claim", orderId: r.id, before: r }, `${r.id}-claim`, () => undefined))
            push({ kind: "order", id: r.id, key: nextKey("order") });
        },
      });
    }
    for (const w of waiting)
      replies.push({
        tag: `Cancel request · ${w.terms.offer.name}`,
        text: "Forget I asked.",
        sub: "Withdraws the request. Nothing has moved, so nothing needs refunding.",
        run: async () => {
          setMine((m) => [...m, w.id]);
          push({ kind: "pc", text: "Forget I asked.", tag: "Cancel request", key: nextKey("pc") });
          await send({ kind: "service-cancel", orderId: w.id, before: w }, `${w.id}-cancel`, () => undefined);
        },
      });
    // Trainer: open lessons are logged in Downtime & NPC training.
    for (const l of services.orders.filter(
      (o) => o.providerId === provider.id && o.terms.lessons?.pupilId === purseId && o.status === "active",
    ))
      replies.push({
        tag: <>Log a session · {l.terms.lessons!.topic} ↗</>,
        text: "When can we start?",
        sub: "Opens Downtime & NPC training with these lessons selected.",
        href: `/features/downtime?lesson=${encodeURIComponent(l.id)}#paid-lessons`,
      });
    const lock = providerLock(table, provider, purseId);
    for (const o of approvedOffers(provider)) {
      if (o.time.kind === "coach") {
        // One reply per coach route; an undrawn route is listed but locked.
        for (const r of provider.routes ?? []) {
          const place = placeOf(r.toLocationId);
          const deci = routeDeci(r);
          // Split the party: the coach carries the paying character's group.
          const passengers = journeyTravellers(table, coachGroup(table, purseId ?? "")).length;
          replies.push({
            tag: (
              <>
                Coach{" "}
                <em>
                  · {formatCopper(o.priceCopper)} a mile each{deci ? ` · ${miles(deci)} mi` : ""}
                </em>
              </>
            ),
            text: `Take us to ${place}.`,
            sub: (
              <span className="svc-flags">
                {deci ? (
                  <span className="svc-flag time">
                    {downtimeDays(journeyDurationMinutes(deci, r.paceMilesPerDay))} downtime days
                  </span>
                ) : null}
                <span className="svc-flag review">Becomes a journey · DM approves departure</span>
                {passengers ? <span className="svc-flag">{passengers} passengers</span> : null}
              </span>
            ),
            disabled:
              lock ||
              (!r.mapId || !r.points ? `Coach to ${place}: the DM hasn't drawn this route on a map yet.` : "") ||
              (openJourney(table, coachGroup(table, purseId ?? "")) ? "The party already has a journey planned. Finish or withdraw it first." : "") ||
              undefined,
            run: () => {
              push(
                { kind: "pc", text: `Take us to ${place}.`, tag: "Coach", key: nextKey("pc") },
                { kind: "npc", text: "Coach leaves at first light.", key: nextKey("npc") },
              );
              chooseOffer(o);
              setRouteKey(r.key);
            },
          });
        }
        continue;
      }
      const settlement = offerSettlementLock(table, provider, o) || (o.target ? identifyLock(table, purseId) : "");
      replies.push({
        tag: (
          <>
            {o.name} <em>· {formatCopper(o.priceCopper)}{o.time.kind === "delivery" ? " a mile" : o.time.kind === "training" ? " a training day" : o.time.kind === "per-night" ? (provider.kind === "stable" ? " a night each" : "") : maxUnits(o) > 1 ? " each" : ""}{o.components?.length ? ` + ${o.components.map((c) => c.label.toLowerCase()).join(", ")}` : ""}</em>
          </>
        ),
        text: speech(o),
        sub: offerFlags(o),
        disabled: lock || settlement || undefined,
        run: () => {
          push(
            { kind: "pc", text: speech(o), tag: o.name, key: nextKey("pc") },
            { kind: "npc", text: offerLine[provider.kind] ?? "Here's what that will take.", key: nextKey("npc") },
          );
          chooseOffer(o);
        },
      });
    }
    if (provider.kind === "inn" && forSale.length) replies.push(rumourReply());
    if (provider.kind === "courier") {
      replies.push({
        tag: <>Property letter ↗</>,
        text: "To the steward of our property.",
        sub: "Reports and instructions to a property manager use the existing property letter (the DM's postage).",
        href: "/features/properties",
      });
      replies.push({ tag: "Parcel", text: "Can you carry a parcel?", disabled: "Parcels aren't carried yet (letters only)." });
    }
    replies.push({
      text: "Never mind.",
      tone: "leave",
      sub: "Back to the conversation.",
      run: () => {
        close();
        onBack();
      },
    });
  } else if (provider && offer) {
    const review = quote?.terms.review === "dm" || (!quote && offer.review === "dm");
    const price = quote ? formatCopper(quote.terms.priceCopper) : "…";
    const lessons = offer.time.kind === "training";
    const letter = offer.time.kind === "delivery";
    const coach = offer.time.kind === "coach";
    const stall = provider.kind === "stable" && offer.time.kind === "per-night";
    const say = lessons
      ? "Agreed."
      : coach
        ? "Book us seats."
        : stall
          ? "Here's the coin."
      : letter && !review
        ? "Send it."
      : review
        ? offer.target
          ? "This one."
          : "Please. Here is what we bring."
        : offer.time.kind === "downtime-days"
          ? "Let's do it."
          : offer.time.kind === "per-night"
            ? "We'll take it."
            : "Here's the offering.";
    replies.push({
      tag: lessons ? (
        <>
          Agree terms <em>· nothing charged now{review ? " · DM review" : ""}</em>
        </>
      ) : coach ? (
        <>
          Request the journey <em>· charged on departure</em>
        </>
      ) : review ? (
        <>
          Ask the {provider.kind === "temple" ? "priest" : provider.kind === "sage" ? "sage" : npc.name}{" "}
          <em>· DM review · {offer.target ? "charged on answer" : "charged on approval"}</em>
        </>
      ) : (
        <>
          {offer.time.kind === "downtime-days" ? "Commission" : offer.time.kind === "per-night" ? "Book" : `Pay ${price}`}{" "}
          <em>
            ·{" "}
            {letter
              ? `arrives after ${quote?.terms.workDays ?? "…"} downtime ${quote?.terms.workDays === 1 ? "day" : "days"}`
              : offer.time.kind === "downtime-days"
              ? `pay ${price} · ready after ${quote?.terms.workDays ?? "…"} downtime days`
              : offer.time.kind === "per-night"
                ? `pay ${price} · ${units} ${units === 1 ? "night" : "nights"}`
                : "recorded at once"}
          </em>
        </>
      ),
      text: say,
      tone: review ? "dm" : "check",
      sub: coach
        ? "Appears in the DM's Review Inbox as a journey request with a coach fare line."
        : lessons
        ? "Adds the lessons to Downtime & NPC training. Log sessions there after the DM approves downtime."
        : letter && !review
          ? "One payment. The letter travels only with DM-approved downtime."
        : review
        ? offer.target
          ? "The item stays with you while the DM answers. Nothing is charged now."
          : "Sends the request to the DM's Review Inbox. Nothing is charged now."
        : offer.time.kind === "per-night"
          ? "Records the stay. A long rest is still the DM's call."
          : "One payment, one receipt. Retrying after a dropped connection can't charge twice.",
      disabled: problem || (!quote ? "Checking" : undefined),
      run: async () => {
        if (!quote || !request || !purseId) return;
        const id = action.commandId;
        push({
          kind: "pc",
          text: say,
          tag: lessons ? "Agree terms" : coach ? "Request the journey" : review ? "Ask · DM review" : `Pay ${price}`,
          key: nextKey("pc"),
        });
        const ok = await send(
          { kind: "service-order", providerId: provider.id, offerKey: offer.key, purseId, request, before: quote.before },
          id,
          action.renew,
        );
        if (ok) {
          setMine((m) => [...m, id]);
          push({ kind: "order", id, key: nextKey("order") });
          setOfferKey(undefined);
        }
      },
    });
    if (provider.kind === "inn" && forSale.length) replies.push(rumourReply());
    const single = provider.kind === "inn" && approvedOffers(provider).length === 1;
    replies.push({
      text: "Never mind.",
      tone: "leave",
      sub: single ? "Back to the conversation." : "Back to the list of services.",
      run: () => {
        setOfferKey(undefined);
        if (single) {
          close();
          onBack();
        }
      },
    });
  }

  let drawer: ReactNode = null;
  if (provider?.kind === "hire" && role && character) {
    drawer = (
      <div className="npc-talk-drawer">
        <div className="npc-talk-drawer-head">
          <h3>Hire · {role.name}</h3>
          <span className="svc-flags">
            <span className="svc-flag link">Existing staff contract</span>
            <span className="svc-flag review">DM review</span>
          </span>
        </div>
        <div className="svc-section">
          <h4>Property</h4>
          <div className="npc-talk-chips" role="group" aria-label="Property to staff">
            {properties.map((h) => (
              <button key={h.id} type="button" className="npc-talk-chip" aria-pressed={propertyId === h.id} onClick={() => setPropertyId(h.id)}>
                {h.name}
              </button>
            ))}
          </div>
          {!properties.length && <p className="npc-talk-hint">The party owns no property to staff.</p>}
        </div>
        <div className="svc-section">
          <label>
            <h4>Name on the contract</h4>
            <input value={hireName} maxLength={160} onChange={(e) => setHireName(e.target.value)} aria-label="Name on the contract" />
          </label>
        </div>
        <dl className="svc-total">
          <dt>Wage</dt>
          <dd>
            {formatCopper(role.wageCopper)} / {role.periodDays === 1 ? "day" : `${role.periodDays} days`}
          </dd>
          <dt className="sum">Paid now</dt>
          <dd className="sum">Nothing</dd>
          <dd className="note">
            A proposal only. The DM approves it in Review Inbox; wages are then paid by the property's staff rules over approved
            downtime, as for any staff contract.
          </dd>
        </dl>
      </div>
    );
  } else if (provider && offer && character) {
    const rule = beneficiaryRule(provider.kind, offer),
      people = serviceBeneficiaries(table, provider);
    drawer = (
      <div className="npc-talk-drawer">
        <div className="npc-talk-drawer-head">
          <h3>
            {offer.name}
            {offer.review === "dm" ? " · your request" : ""}
          </h3>
          {offerFlags(offer)}
        </div>
        {offer.description && <p className="npc-talk-hint">{offer.description}</p>}
        {rule.max > 0 && (
          <div className="svc-section">
            <h4>{provider.kind === "temple" ? "Cast on" : provider.kind === "trainer" ? "Pupil" : "Who stays"}</h4>
            <div
              className="npc-talk-chips"
              role="group"
              aria-label={provider.kind === "temple" ? "Cast on" : provider.kind === "trainer" ? "Pupil" : "Who stays"}
            >
              {people.map((b) => (
                <button
                  key={b.purseId}
                  type="button"
                  className="npc-talk-chip"
                  aria-pressed={beneficiaries.includes(b.purseId)}
                  disabled={!b.here}
                  onClick={() =>
                    setBeneficiaries((current) =>
                      rule.max === 1
                        ? [b.purseId]
                        : current.includes(b.purseId)
                          ? current.filter((x) => x !== b.purseId)
                          : [...current, b.purseId],
                    )
                  }
                >
                  {b.name} <small>{b.purseId === purseId ? "you" : b.here ? "here" : `not at ${quote?.terms.placeName ?? "this place"}`}</small>
                </button>
              ))}
            </div>
            <p className="npc-talk-hint">
              Only party characters at this place. Paying for someone gives you no control over their sheet or purse, and their
              player doesn't need to confirm.
            </p>
          </div>
        )}
        {provider.kind === "stable" && offer.time.kind === "per-night" && (
          <fieldset className="svc-section">
            <h4>Animals</h4>
            {stableAnimals(character.id).map(({ holding, owner, blocked }) => (
              <label key={holding.id} className={`svc-choice${animalIds.includes(holding.id) ? " on" : ""}${blocked ? " blocked" : ""}`}>
                <input
                  type="checkbox"
                  checked={animalIds.includes(holding.id)}
                  disabled={!!blocked}
                  onChange={(e) => setAnimalIds((ids) => (e.target.checked ? [...ids, holding.id] : ids.filter((x) => x !== holding.id)))}
                />
                <b>
                  {holding.name}
                  {holding.quantity > 1 ? ` × ${holding.quantity}` : ""}
                </b>
                <span className="svc-amt" />
                <small>{blocked || (owner?.kind === "party" ? "Party fund" : `${owner?.name ?? character.name}'s`)}</small>
              </label>
            ))}
            {!stableAnimals(character.id).length && (
              <p className="npc-talk-hint">{character.name} has no animals here. Buy one on the shelf or ask whoever owns it.</p>
            )}
            {!!offer.feedCopper && (
              <label className="svc-check">
                <input type="checkbox" checked={feed} onChange={(e) => setFeed(e.target.checked)} /> Feed included{" "}
                <small>{formatCopper(offer.feedCopper)} an animal a day</small>
              </label>
            )}
            <p className="npc-talk-hint">
              Animals the payer owns or the party fund holds, found the same way the journey planner finds mounts. They stay in
              the inventory; nothing is stored or locked.
            </p>
          </fieldset>
        )}
        {offer.time.kind === "coach" && (() => {
          const r = provider.routes?.find((x) => x.key === routeKey);
          if (!r) return null;
          const deci = routeDeci(r);
          const minutes = deci ? journeyDurationMinutes(deci, r.paceMilesPerDay) : 0;
          return (
            <>
              <div className="svc-section">
                <h4>Route</h4>
                <p className="npc-talk-hint">
                  {placeOf(r.points?.[0].locationId ?? "") !== "the destination" ? placeOf(r.points![0].locationId!) : "Here"} →{" "}
                  {placeOf(r.toLocationId)} · {miles(deci)} mi on the{" "}
                  {table.journal?.world?.maps.find((m) => m.id === r.mapId)?.name ?? "DM's"} map · coach pace {r.paceMilesPerDay} mi a day ·{" "}
                  {downtimeDays(minutes)} downtime {downtimeDays(minutes) === 1 ? "day" : "days"}
                </p>
              </div>
              <div className="svc-section">
                <h4>Passengers</h4>
                <div className="npc-talk-chips" role="group" aria-label="Passengers">
                  {journeyTravellers(table, coachGroup(table, character.id)).map((p) => (
                    <button key={p.id} type="button" className="npc-talk-chip" aria-pressed="true" disabled>
                      {p.name} <small>{p.id === character.id ? "you" : "party"}</small>
                    </button>
                  ))}
                </div>
                <p className="npc-talk-hint">
                  The coach carries the whole party, like any party journey. Someone staying behind tells the DM, who places them.
                </p>
              </div>
            </>
          );
        })()}
        {provider.kind === "courier" && (
          <>
            <fieldset className="svc-section">
              <h4>To</h4>
              {courierRecipients(table, provider, character.id).map((r) => (
                <label key={r.npcId} className={`svc-choice${recipientId === r.npcId ? " on" : ""}${r.blocked ? " blocked" : ""}`}>
                  <input type="radio" name="svc-letter-to" checked={recipientId === r.npcId} disabled={!!r.blocked} onChange={() => setRecipientId(r.npcId)} />
                  <b>{r.name}</b>
                  <span className="svc-amt">{r.deciMiles && !r.blocked ? formatCopper(Math.ceil((r.deciMiles * offer.priceCopper) / 10)) : ""}</span>
                  <small>
                    {r.blocked ||
                      `${r.placeName} · ${miles(r.deciMiles!)} mi · ${r.days} downtime ${r.days === 1 ? "day" : "days"}`}
                  </small>
                </label>
              ))}
              {!courierRecipients(table, provider, character.id).length && (
                <p className="npc-talk-hint">{character.name} hasn't met anyone to write to yet.</p>
              )}
              <p className="npc-talk-hint">
                NPCs {character.name} has met and can see, at places the courier serves. Hidden NPCs and places{" "}
                {character.name} doesn't know aren't listed.
              </p>
            </fieldset>
            <div className="svc-section">
              <h4>Letter</h4>
              <textarea aria-label="Letter text" maxLength={2000} value={letterText} onChange={(e) => setLetterText(e.target.value)} />
              <p className="npc-talk-hint">
                Only you and the DM read it. It is delivered into your thread with the recipient; the DM (or their controller)
                answers there.
              </p>
            </div>
          </>
        )}
        {offer.target === "held-item" && (
          <fieldset className="svc-section">
            <h4>Which item</h4>
            {identifyCandidates(table, character.id).map(({ holding, blocked }) => (
              <label key={holding.id} className={`svc-choice${itemId === holding.id ? " on" : ""}${blocked ? " blocked" : ""}`}>
                <input type="radio" name="svc-identify-item" checked={itemId === holding.id} disabled={!!blocked} onChange={() => setItemId(holding.id)} />
                <b>{holding.name}</b>
                <span className="svc-amt" />
                <small>
                  {blocked ||
                    `Carried by ${character.name}${holding.equipped ? ", worn" : ""}.${holding.notes ? ` “${holding.notes.slice(0, 120)}${holding.notes.length > 120 ? "…" : ""}”` : ""}`}
                </small>
              </label>
            ))}
            <p className="npc-talk-hint">
              Items owned and carried by the paying character; worn items are fine. Stored, travelling and reserved items are not.
              The item stays with you.
            </p>
          </fieldset>
        )}
        {provider.kind === "inn" && (
          <div className="svc-section">
            <h4>Room</h4>
            <div className="svc-seg tiers" role="group" aria-label="Room">
              {(offer.tiers ?? [])
                .filter((x) => x.offered)
                .map((x) => (
                  <button key={x.key} type="button" aria-pressed={tierKey === x.key} onClick={() => setTierKey(x.key)}>
                    {x.name}
                    <small>{formatCopper(x.nightCopper)}/night</small>
                  </button>
                ))}
            </div>
            <p className="npc-talk-hint">Per guest per night. Meals use the same tier.</p>
            <div className="svc-row">
              <div>
                <h4>Meals a day</h4>
                <Stepper value={meals} min={0} max={3} label="Meals a day" onChange={setMeals} />
              </div>
            </div>
          </div>
        )}
        {maxUnits(offer) > 1 && (
          <div className="svc-section">
            <h4>{offer.time.kind === "per-night" ? "Nights" : offer.time.kind === "training" ? "Up to" : "How many"}</h4>
            <div className="svc-row">
              <Stepper
                value={units}
                min={1}
                max={maxUnits(offer)}
                label={offer.time.kind === "per-night" ? "Nights" : offer.time.kind === "training" ? "Training days" : "How many"}
                onChange={setUnits}
              />
              <span className="svc-hint">
                {offer.time.kind === "training"
                  ? `training days (1–${maxUnits(offer)}). Stops at ${units}; you can book more later.`
                  : `Up to ${maxUnits(offer)} per order.`}
              </span>
            </div>
          </div>
        )}
        {offer.time.kind === "training" && (
          <div className="svc-section">
            <h4>How you pay</h4>
            <dl className="svc-kv">
              <dt>Rate</dt>
              <dd>
                {formatCopper(offer.priceCopper)} a training day ({trainingHoursPerDay} hours)
              </dd>
              <dt>A 4-hour session</dt>
              <dd>{formatCopper(lessonFee(240, offer.priceCopper, trainingHoursPerDay))}</dd>
              <dt>A 6-hour session</dt>
              <dd>{formatCopper(lessonFee(360, offer.priceCopper, trainingHoursPerDay))}</dd>
              <dt>When</dt>
              <dd>Each session, when the DM approves it</dd>
              <dt>{units} days, if all are taken</dt>
              <dd>{formatCopper(offer.priceCopper * units)}</dd>
            </dl>
          </div>
        )}
        {(offer.components ?? []).map((c) => {
          const needed = c.quantity * (c.perUnit ? units : 1);
          const candidates = componentCandidates(table, character.id, c);
          const name = `svc-${c.key}`;
          return (
            <fieldset key={c.key} className="svc-section">
              <h4>
                {c.label}
                {needed > 1 ? ` × ${needed}` : ""}
              </h4>
              {c.supply !== "provider" &&
                candidates.map(({ holding, blocked }) => (
                  <label key={holding.id} className={`svc-choice${picks[c.key] === holding.id ? " on" : ""}${blocked ? " blocked" : ""}`}>
                    <input
                      type="radio"
                      name={name}
                      checked={picks[c.key] === holding.id}
                      disabled={!!blocked}
                      onChange={() => setPicks((p) => ({ ...p, [c.key]: holding.id }))}
                    />
                    <b>
                      Bring your own: {holding.name}
                      {!c.minCopper || holding.name.includes(formatCopper(holding.unitCopper)) ? "" : ` (${formatCopper(holding.unitCopper)})`}
                    </b>
                    <span className="svc-amt">
                      {c.supply === "either"
                        ? `−${formatCopper(c.supplyCopper * (request?.contributions.find((x) => x.holdingId === holding.id)?.quantity ?? Math.min(needed, holding.quantity)))}`
                        : ""}
                    </span>
                    <small>
                      {blocked ||
                        `${needed > 1 ? `${holding.quantity} carried by` : "Carried by"} ${character.name}, not equipped. ${c.consumed ? (offer.review === "dm" ? "Handed over and consumed when the DM approves." : "Handed over and consumed when you pay.") : "Shown, not consumed."}`}
                    </small>
                  </label>
                ))}
              {c.supply === "either" &&
                picks[c.key] &&
                picks[c.key] !== "provider" &&
                Math.min(needed, table.holdings.find((h) => h.id === picks[c.key])?.quantity ?? 0) > 1 &&
                (() => {
                  const most = Math.min(needed, table.holdings.find((h) => h.id === picks[c.key])?.quantity ?? 0);
                  return (
                    <div className="svc-row">
                      <Stepper
                        value={Math.max(1, Math.min(most, counts[c.key] ?? most))}
                        min={1}
                        max={most}
                        label={`${c.label} you bring`}
                        onChange={(n) => setCounts((x) => ({ ...x, [c.key]: n }))}
                      />
                      <span className="svc-hint">
                        You bring these; {npc.name} supplies the rest.
                      </span>
                    </div>
                  );
                })()}
              {c.supply !== "party" && (
                <label className={`svc-choice${picks[c.key] === "provider" ? " on" : ""}`}>
                  <input type="radio" name={name} checked={picks[c.key] === "provider"} onChange={() => setPicks((p) => ({ ...p, [c.key]: "provider" }))} />
                  <b>{npc.name} supplies it</b>
                  <span className="svc-amt">+{formatCopper(c.supplyCopper * needed)}</span>
                  <small>Added to the price.</small>
                </label>
              )}
              {c.supply === "party" && !candidates.some((x) => !x.blocked) && (
                <p className="npc-talk-hint">You need to bring this; nothing you carry fits.</p>
              )}
              <p className="npc-talk-hint">
                Your own lot must be owned by the paying character, carried (not stored, in transit or reserved), not equipped
                {c.minCopper ? `, and worth at least ${formatCopper(c.minCopper)}` : ""}.
              </p>
            </fieldset>
          );
        })}
        {offer.output.kind === "holding" && quote && (
          <div className="svc-section">
            <h4>What you get</h4>
            <dl className="svc-kv">
              <dt>Item</dt>
              <dd>
                {offer.output.name} × {units} (one holding)
              </dd>
              <dt>Value</dt>
              <dd>{formatCopper(offer.output.unitCopper)} each</dd>
              <dt>Work</dt>
              <dd>{quote.terms.workDays} approved downtime days</dd>
              <dt>Collect at</dt>
              <dd>
                {quote.terms.shopName}, {quote.terms.placeName}, with {character.name}
              </dd>
            </dl>
          </div>
        )}
        <dl className="svc-total">
          {(quote?.terms.lines ?? []).map((l, i) => (
            <span key={i} style={{ display: "contents" }}>
              <dt>{l.label}</dt>
              <dd>{formatCopper(l.copper)}</dd>
            </span>
          ))}
          <dt>{character.name} carries</dt>
          <dd>{formatCopper(toCopper(character.coins))}</dd>
          <dt className="sum">
            {offer.time.kind === "coach"
              ? "Charged on departure"
              : offer.time.kind === "training"
              ? "Pay now"
              : quote?.terms.review === "dm"
                ? offer.target
                  ? "Charged when answered"
                  : "Charged when approved"
                : "Pay now"}
          </dt>
          <dd className="sum">{offer.time.kind === "training" ? "nothing" : quote ? formatCopper(quote.terms.priceCopper) : "—"}</dd>
          <dd className="note">
            {provider.kind === "inn" && quote
              ? `Booked and paid up front: ${quote.terms.priceCopper} cp, one ledger line. Leaving early refunds nothing automatically. `
              : ""}
            {problem ||
              (offer.time.kind === "coach"
                ? "Nothing moves now. This sends a journey request. When the DM approves departure, the fare is charged once, and the party moves only over approved downtime."
                : provider.kind === "stable" && quote
                ? `Booked and paid up front: ${quote.terms.priceCopper} cp, one ledger line. The animals stay in your inventory; leaving early refunds nothing automatically.`
                : offer.time.kind === "delivery"
                ? `Paid once on sending. It arrives after ${quote?.terms.workDays ?? "…"} approved downtime days; session hours don't move it. Cancelling refunds nothing, as with property letters.`
                : offer.time.kind === "training"
                ? `Booking records the agreement only. Each logged session reserves hours for ${character.name} and ${npc.name}; the DM's approval counts the hours and charges that session's fee once. Fees are whole copper, rounded up.`
                : quote?.terms.review === "dm"
                ? offer.target
                  ? `Nothing moves now. The DM answers as ${npc.name}; approval charges ${quote ? formatCopper(quote.terms.priceCopper) : "the fee"} once and sends you the answer.`
                  : "Nothing moves now. If the DM approves, coins and any item you bring leave together, once."
                : offer.time.kind === "downtime-days"
                  ? "Paid once, now. Work advances only when the DM approves downtime, never by session hours or real time."
                  : provider.kind === "inn"
                    ? ""
                    : "Charged and recorded at once.")}
          </dd>
        </dl>
      </div>
    );
  }

  /** Orders to show: those placed or touched in this conversation, and open requests. */
  const shown = services.orders.filter(
    (o) =>
      o.purseId === purseId &&
      o.terms.npcId === npc.id &&
      (mine.includes(o.id) ||
        o.status === "requested" ||
        o.status === "ready" ||
        // A sage's answer from today rejoins the conversation (it stays in the private thread).
        (!!o.reveal && o.completedDay === readFinance(table.journal?.finance).day)),
  );
  const linesFor = (id: string): TalkLine[] => {
    const o = shown.find((x) => x.id === id);
    if (o) return orderLines(o, payerName, npc.name);
    // A rumour bought here: its text is in the buyer's private thread with this NPC.
    const message = table.journal?.world?.conversations
      .find((c) => c.npcId === npc.id && c.purseId === purseId)
      ?.messages.find((m) => m.id === `${id}-rumour`);
    if (!message) return [];
    const paid = table.ledger.find((l) => l.id === `${id}-payment`);
    return [
      { kind: "npc", key: `${id}-text`, text: message.text },
      {
        kind: "sys",
        key: `${id}-paid`,
        node: (
          <>
            {paid ? `Paid ${formatCopper(-paid.copper)}. ` : ""}The rumour is saved in your private thread with {npc.name}.{" "}
            {purseId && <ShareRumour text={message.text} npcName={npc.name} purseId={purseId} />}
          </>
        ),
      },
    ];
  };
  return {
    active: !!provider,
    providerId,
    open,
    close,
    replies,
    drawer,
    shown,
    linesFor,
    label: provider ? serviceLabel(provider) : "",
  };
}

function Stepper({
  value,
  min,
  max,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (n: number) => void;
}) {
  return (
    <span className="svc-stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </span>
  );
}

/** Copy a bought rumour into the party chat (owner decision: rumours may be shared). */
export function ShareRumour({ text, npcName, purseId }: { text: string; npcName: string; purseId: string }) {
  const seat = useSeat();
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const body = `Rumour from ${npcName}: ${text}`;
  return (
    <button
      type="button"
      className="npc-talk-chip"
      disabled={state === "busy" || state === "done"}
      onClick={async () => {
        setState("busy");
        try {
          await postNotes([{ from: seat.role === "dm" ? "dm" : "player", to: "party", purseId, text: body.length > 500 ? `${body.slice(0, 499)}…` : body }]);
          setState("done");
        } catch {
          setState("failed");
        }
      }}
    >
      {state === "done" ? "Shared in party chat" : state === "failed" ? "Couldn't share · try again" : "Share in party chat"}
    </button>
  );
}
