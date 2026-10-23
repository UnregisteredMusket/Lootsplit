import { useState, type ReactNode } from "react";
import { useCommandId } from "@/lib/quire/economy-context";
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
import {
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

const intro: Record<ServiceProvider["kind"], string> = {
  temple: "Say what ails you, and who. The faithful ask an offering for each blessing.",
  workshop: "Tell me what you need made. Good work takes time.",
  inn: "Rooms upstairs, food on the fire. What'll it be?",
};
const offerLine: Record<ServiceProvider["kind"], string> = {
  temple: "Who is it for, and what do you bring?",
  workshop: "Here's what that will take.",
  inn: "How many of you, and for how long?",
};

/** What the character says when choosing a preset offer; custom offers use their name. */
const offerSpeech: Record<string, string> = {
  "cure-wounds": "Mend our wounds.",
  "lesser-restoration": "Cleanse this sickness.",
  "remove-curse": "Lift this curse.",
  revivify: "They only just fell. Bring them back.",
  "greater-restoration": "Restore what was taken.",
  "raise-dead": "Please, raise our friend.",
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
        <b>{t.kind === "inn" ? `Stay · ${t.shopName}` : t.offer.name}</b>
        <span className={`svc-status ${order.status}`}>
          {order.status === "completed" ? (order.history.some((h) => h.status === "requested") ? "Approved" : "Paid") : order.status}
        </span>
      </div>
      <dl className="svc-kv">
        {t.kind === "temple" && (
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
        {t.kind === "temple"
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
          {payer} asks for <b>{t.offer.name}</b>
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
          {brought.length ? ` and ${brought.join(", ")} stays with ${payer}` : ""} until the DM approves.
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
    const note = reviewed ? decided?.note.replace(/^Approved and paid\.( Recorded only; the DM updates character sheets\.| Work advances only with DM-approved downtime\.)?\s*/, "") : "";
    if (note) lines.push({ kind: "sys", key: `${o.id}-dm`, node: <>The DM decided: {note}</> });
    lines.push({ kind: "npc", key: `${o.id}-done`, text: t.kind === "temple" ? "It is done." : t.kind === "inn" ? "Room's at the top of the stairs." : "I'll get to work." });
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
  const [units, setUnits] = useState(1);
  const [mine, setMine] = useState<string[]>([]);
  const services = readServices(table.journal?.services);
  const provider = services.providers.find((p) => p.id === providerId);
  const offer = provider ? approvedOffers(provider).find((o) => o.key === offerKey) : undefined;
  const purseId = character?.id;

  const request: ServiceRequest | null =
    provider && offer && purseId
      ? {
          beneficiaryPurseIds: beneficiaries,
          units,
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

  function chooseOffer(o: ServiceOffer) {
    setOfferKey(o.key);
    setUnits(1);
    const rule = beneficiaryRule(provider!.kind);
    setBeneficiaries(rule.min && purseId ? [purseId] : []);
    // Bring your own when you carry a fitting lot; otherwise the provider supplies it.
    const next: Pick_ = {};
    for (const c of o.components ?? []) {
      const own = purseId ? componentCandidates(table, purseId, c).find((x) => !x.blocked) : undefined;
      next[c.key] = c.supply === "provider" ? "provider" : own ? own.holding.id : c.supply === "party" ? "" : "provider";
    }
    setPicks(next);
    setCounts({});
  }

  /** Open a provider's branch from the hub or the sub-list. */
  function open(id: string, text: string, tag: string) {
    const p = services.providers.find((x) => x.id === id);
    if (!p) return;
    push({ kind: "pc", text, tag, key: nextKey("pc") }, { kind: "npc", text: intro[p.kind], key: nextKey("npc") });
    setProviderId(id);
    setOfferKey(undefined);
  }
  const close = () => {
    setProviderId(undefined);
    setOfferKey(undefined);
  };

  const replies: TalkReply[] = [];
  const payerName = character?.name ?? "You";
  if (provider && !offer) {
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
    const lock = providerLock(table, provider, purseId);
    for (const o of approvedOffers(provider)) {
      const settlement = offerSettlementLock(table, provider, o);
      replies.push({
        tag: (
          <>
            {o.name} <em>· {formatCopper(o.priceCopper)}{o.time.kind === "per-night" ? "" : maxUnits(o) > 1 ? " each" : ""}{o.components?.length ? ` + ${o.components.map((c) => c.label.toLowerCase()).join(", ")}` : ""}</em>
          </>
        ),
        text: speech(o),
        sub: offerFlags(o),
        disabled: lock || settlement || undefined,
        run: () => {
          push(
            { kind: "pc", text: speech(o), tag: o.name, key: nextKey("pc") },
            { kind: "npc", text: offerLine[provider.kind], key: nextKey("npc") },
          );
          chooseOffer(o);
        },
      });
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
    replies.push({
      tag: review ? (
        <>
          Ask the {provider.kind === "temple" ? "priest" : npc.name} <em>· DM review · charged on approval</em>
        </>
      ) : (
        <>
          {offer.time.kind === "downtime-days" ? "Commission" : `Pay ${price}`}{" "}
          <em>· {offer.time.kind === "downtime-days" ? `pay ${price} · ready after ${quote?.terms.workDays ?? "…"} downtime days` : "recorded at once"}</em>
        </>
      ),
      text: review ? "Please. Here is what we bring." : offer.time.kind === "downtime-days" ? "Let's do it." : "Here's the offering.",
      tone: review ? "dm" : "check",
      sub: review ? "Sends the request to the DM's Review Inbox. Nothing is charged now." : "One payment, one receipt. Retrying after a dropped connection can't charge twice.",
      disabled: problem || (!quote ? "Checking" : undefined),
      run: async () => {
        if (!quote || !request || !purseId) return;
        const id = action.commandId;
        push({
          kind: "pc",
          text: review ? "Please. Here is what we bring." : offer.time.kind === "downtime-days" ? "Let's do it." : "Here's the offering.",
          tag: review ? "Ask · DM review" : `Pay ${price}`,
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
    replies.push({
      text: "Never mind.",
      tone: "leave",
      sub: "Back to the list of services.",
      run: () => setOfferKey(undefined),
    });
  }

  let drawer: ReactNode = null;
  if (provider && offer && character) {
    const rule = beneficiaryRule(provider.kind),
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
            <h4>{provider.kind === "temple" ? "Cast on" : "Who stays"}</h4>
            <div className="npc-talk-chips" role="group" aria-label={provider.kind === "temple" ? "Cast on" : "Who stays"}>
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
        {maxUnits(offer) > 1 && (
          <div className="svc-section">
            <h4>{offer.time.kind === "per-night" ? "Nights" : "How many"}</h4>
            <div className="svc-row">
              <Stepper value={units} min={1} max={maxUnits(offer)} label={offer.time.kind === "per-night" ? "Nights" : "How many"} onChange={setUnits} />
              <span className="svc-hint">Up to {maxUnits(offer)} per order.</span>
            </div>
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
          <dt className="sum">{quote?.terms.review === "dm" ? "Charged when approved" : "Pay now"}</dt>
          <dd className="sum">{quote ? formatCopper(quote.terms.priceCopper) : "—"}</dd>
          <dd className="note">
            {problem ||
              (quote?.terms.review === "dm"
                ? "Nothing moves now. If the DM approves, coins and any item you bring leave together, once."
                : offer.time.kind === "downtime-days"
                  ? "Paid once, now. Work advances only when the DM approves downtime, never by session hours or real time."
                  : "Charged and recorded at once.")}
          </dd>
        </dl>
      </div>
    );
  }

  /** Orders to show: those placed or touched in this conversation, and open requests. */
  const shown = services.orders.filter(
    (o) => o.purseId === purseId && o.terms.npcId === npc.id && (mine.includes(o.id) || o.status === "requested" || o.status === "ready"),
  );
  const linesFor = (id: string) => {
    const o = shown.find((x) => x.id === id);
    return o ? orderLines(o, payerName, npc.name) : [];
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
