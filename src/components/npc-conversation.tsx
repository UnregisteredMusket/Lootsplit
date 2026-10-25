import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { seatGroups } from "@/lib/quire/party-groups";
import { useSeat } from "@/lib/quire/seat";
import { useCommandId, useEconomy } from "@/lib/quire/economy-context";
import { readWorld, type Npc } from "@/lib/quire/world-schema";
import { npcAvailableHere } from "@/lib/quire/world";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { formatCopper, toCopper } from "@/lib/quire/money";
import {
  STANCE_LINES,
  formatCampaignMinute,
  npcAnswersBarter,
  oddsWords,
  readNpcBarter,
  replyFor,
  type BarterOfferInput,
  type PublicBarterQuote,
} from "@/lib/quire/npc-barter";
import type { BarterAttempt, BarterSide } from "@/lib/quire/npc-barter-schema";
import { useNpcBarterQuote } from "@/lib/quire/use-npc-barter";
import type { CloudTable } from "@/lib/quire/cloud";
import type { Holding, Purse } from "@/lib/quire/types";
import { npcServices, servicesReply, type HubService } from "@/lib/quire/service-hub";
import { AppLink } from "./app-link";
import { useServiceTalk } from "./service-talk";

// The reusable NPC conversation (docs/NPC-BARTER.md): a portrait stage, a transcript and
// numbered replies. Barter is the worked branch; the others open existing pages.

const reduced = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function advantageWord(a: PublicBarterQuote["advantage"]) {
  return a === "advantage" ? "Advantage" : a === "disadvantage" ? "Disadvantage" : "Normal roll";
}

export function oddsText(chance: number) {
  return `${oddsWords(chance)} ~${Math.round(chance / 10)}%`;
}

function lotNames(side: BarterSide) {
  const names = side.items.map((item) => {
    try {
      const h = JSON.parse(item.before) as Holding;
      return `${item.quantity > 1 ? `${item.quantity} × ` : ""}${h.name}`;
    } catch {
      return "an item";
    }
  });
  if (side.copper) names.push(formatCopper(side.copper));
  return names.join(", ") || "nothing";
}

/** The tag the player's reply carried, rebuilt from the stored quote. */
export function replyTag(a: Pick<BarterAttempt, "reply" | "quote" | "mode">) {
  const q = a.quote;
  if (a.reply === "dm") return "DM decides";
  if (a.reply === "offer") return "Offer · no roll needed";
  if (a.reply === "too-low") return "Too low · refused without a roll";
  return `Persuasion · DC ${q.dc}${q.repeat ? ` (+${q.repeat} tries)` : ""} · ${oddsText(q.chance)} · ${advantageWord(q.advantage)}`;
}

const replySpeech: Record<BarterAttempt["reply"], string> = {
  persuade: "Come now, that's a fair price, and you know it.",
  offer: "Here. Take it, it's a good deal.",
  "too-low": "Take it or leave it.",
  dm: "Let the Dungeon Master judge this deal.",
};

type Line =
  | { kind: "attempt"; id: string; key: string }
  | { kind: "order"; id: string; key: string }
  | { kind: "npc"; text: string; key: string }
  | { kind: "pc"; text: string; tag?: string; key: string }
  | { kind: "sys"; node: ReactNode; key: string }
  | { kind: "roll"; attempt: BarterAttempt; key: string };

/** One attempt as transcript lines, for the conversation, history and the DM queue. */
export function attemptLines(a: BarterAttempt, characterName: string): Line[] {
  const lines: Line[] = [
    { kind: "pc", text: replySpeech[a.reply], tag: replyTag(a), key: `${a.id}-pc` },
    {
      kind: "sys",
      key: `${a.id}-offer`,
      node: (
        <>
          {characterName} offers <b>{lotNames(a.give)}</b> for <b>{lotNames(a.ask)}</b>.
        </>
      ),
    },
  ];
  if (a.roll) lines.push({ kind: "roll", attempt: a, key: `${a.id}-roll` });
  const counterAt = a.lines.findIndex((l) => l.key === "counter");
  a.lines.forEach((l, i) => {
    lines.push({ kind: "npc", text: l.text, key: `${a.id}-line-${i}` });
    if (i === counterAt && a.counterCopper !== undefined)
      lines.push({
        kind: "sys",
        key: `${a.id}-counter`,
        node: (
          <>
            Counter-offer: your coins{" "}
            <b>
              {formatCopper(a.give.copper)} → {formatCopper(a.give.copper + a.counterCopper)}
            </b>
            , everything else the same. Accepting needs no further roll.
          </>
        ),
      });
  });
  if (a.status === "queued")
    lines.push({ kind: "sys", key: `${a.id}-queued`, node: <>Sent to the DM's queue. The answer appears here.</> });
  if (a.status === "confirm")
    lines.push({ kind: "sys", key: `${a.id}-confirm`, node: <>Waiting for the DM to confirm this result. Nothing has moved yet.</> });
  if (a.status === "accepted")
    lines.push({
      kind: "sys",
      key: `${a.id}-receipt`,
      node: (
        <span className="npc-talk-receipt">
          <span>
            <small>Gave</small>
            {a.counterCopper !== undefined && a.settled !== a.id
              ? lotNames({ ...a.give, copper: a.give.copper + a.counterCopper })
              : lotNames(a.give)}
          </span>
          <span aria-hidden="true">⇄</span>
          <span>
            <small>Received</small>
            {lotNames(a.ask)}
          </span>
        </span>
      ),
    });
  if (a.status === "declined" || a.status === "cancelled")
    lines.push({
      kind: "sys",
      key: `${a.id}-closed`,
      node: <>{a.status === "cancelled" ? "Offer cancelled." : "No deal."} Nothing moved.</>,
    });
  if (a.dmReason)
    lines.push({ kind: "sys", key: `${a.id}-reason`, node: <>The DM decided: {a.dmReason}</> });
  return lines;
}

function RollCard({ attempt, spinning }: { attempt: BarterAttempt; spinning: boolean }) {
  const r = attempt.roll!,
    q = attempt.quote,
    keptIndex = r.dice.indexOf(r.kept),
    success = r.total >= q.dc,
    near = !success && attempt.counterCopper !== undefined && attempt.status !== "accepted";
  const missed = q.dc - r.total;
  return (
    <div className="npc-talk-roll">
      <div className="npc-talk-roll-kind">Charisma (Persuasion)</div>
      <div className="npc-talk-roll-dc">
        DC <b>{q.dc}</b>
      </div>
      <div
        className="npc-talk-dice"
        aria-label={
          r.dice.length > 1
            ? `${advantageWord(q.advantage)}: rolled ${r.dice.join(" and ")}, kept ${r.kept}`
            : `Rolled ${r.kept}`
        }
      >
        {r.dice.map((d, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`npc-talk-die${r.dice.length > 1 ? (i === keptIndex ? " kept" : " dropped") : " kept"}`}
          >
            <span className={`npc-talk-d20${spinning ? " spin" : ""}`}>
              <span>{spinning ? "?" : d}</span>
            </span>
            {r.dice.length > 1 && <small>{i === keptIndex ? "kept" : "dropped"}</small>}
          </span>
        ))}
      </div>
      {spinning ? (
        <p className="npc-talk-roll-math">Rolling…</p>
      ) : (
        <>
          <p className="npc-talk-roll-math">
            {r.dice.length > 1 ? `${advantageWord(q.advantage)}: kept ` : ""}
            <b>{r.kept}</b> {q.bonus >= 0 ? "+" : "−"} {Math.abs(q.bonus)} = <b>{r.total}</b> against DC{" "}
            {q.dc}
          </p>
          <p className={`npc-talk-result ${success ? "ok" : near ? "near" : "bad"}`}>
            {success ? "✔ Success" : near ? `◐ Missed by ${missed}` : "✖ Failure"}
          </p>
        </>
      )}
      <p className="npc-talk-roll-src">
        Rolled by {r.source === "server" ? "the room server" : "the DM's device"} · cannot be re-rolled
      </p>
    </div>
  );
}

/** Newest NPC line types out; any key or tap shows it in full. Screen readers get it whole. */
function NpcSay({ text, animate, onDone }: { text: string; animate: boolean; onDone: () => void }) {
  const [shown, setShown] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate || shown >= text.length) {
      if (shown >= text.length) onDone();
      return;
    }
    const timer = setTimeout(() => setShown((n) => Math.min(text.length, n + 2)), 22);
    return () => clearTimeout(timer);
  }, [animate, shown, text, onDone]);
  return (
    <span className="npc-talk-say" onClick={() => setShown(text.length)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className={shown < text.length ? "typing" : undefined}>
        {text.slice(0, shown)}
      </span>
    </span>
  );
}

export function Transcript({
  lines,
  npcName,
  characterName,
  typing,
  onTyped,
  spinning,
  live = false,
}: {
  lines: Line[];
  npcName: string;
  characterName: string;
  typing?: string;
  onTyped?: () => void;
  spinning?: string;
  live?: boolean;
}) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (live && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  });
  return (
    <ol
      ref={ref}
      className="npc-talk-log"
      aria-live={live ? "polite" : undefined}
      aria-label={`Conversation with ${npcName}`}
    >
      {lines.map((l) =>
        l.kind === "attempt" || l.kind === "order" ? null : l.kind === "npc" ? (
          <li key={l.key} className="npc-talk-line npc">
            <span className="npc-talk-who">{npcName}</span>
            <NpcSay text={l.text} animate={typing === l.key && !reduced()} onDone={onTyped ?? (() => undefined)} />
          </li>
        ) : l.kind === "pc" ? (
          <li key={l.key} className="npc-talk-line pc">
            <span className="npc-talk-who">{characterName}</span>
            {l.tag && <span className="npc-talk-tagline">[{l.tag}]</span>}
            <span className="npc-talk-say">“{l.text}”</span>
          </li>
        ) : l.kind === "roll" ? (
          <li key={l.key} className="npc-talk-line roll">
            <RollCard attempt={l.attempt} spinning={spinning === l.attempt.id && !reduced()} />
          </li>
        ) : (
          <li key={l.key} className="npc-talk-line sys">
            {l.node}
          </li>
        ),
      )}
    </ol>
  );
}

type Reply = {
  tag?: ReactNode;
  text: string;
  sub?: ReactNode;
  tone?: "check" | "red" | "dm" | "leave";
  disabled?: string;
  run?: () => void | Promise<void>;
  href?: string;
};

function FairnessBar({ quote, npcName }: { quote: PublicBarterQuote; npcName: string }) {
  const words: Record<PublicBarterQuote["band"], string> = {
    "too-low": "far too low",
    low: "low",
    close: "close to fair",
    fair: "fair",
    generous: "generous",
  };
  return (
    <span className="npc-talk-scale">
      <span className="npc-talk-scale-bar" aria-hidden="true">
        <i style={{ left: `${quote.position}%` }} />
      </span>
      {npcName}'s view: {words[quote.band]}
    </span>
  );
}

function OddsPips({ chance }: { chance: number }) {
  const lit = Math.round(chance / 100);
  return (
    <span className="npc-talk-pips" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={i < lit ? "on" : undefined} />
      ))}
    </span>
  );
}

type Draft = { give: Record<string, number>; giveCopper: number; ask: Record<string, number>; askCopper: number };
const emptyDraft = (): Draft => ({ give: {}, giveCopper: 0, ask: {}, askCopper: 0 });

const carried = (h: Holding) => h.quantity > 0 && !h.custody && !h.reservedFor && !h.pool && !h.service;

export function NpcConversation({
  npc,
  table,
  onFarewell,
}: {
  npc: Npc;
  table: CloudTable;
  /** On a map pin, Farewell closes the place card and returns to the map. */
  onFarewell?: () => void;
}) {
  const seat = useSeat(),
    dm = seat.role === "dm",
    { commandOutcome } = useEconomy();
  const world = readWorld(table.journal?.world),
    state = readNpcBarter(world),
    near = npcAvailableHere(npc, table, seatGroups(table, seat));
  const characters = table.purses.filter(
    (p: Purse) =>
      p.kind === "character" &&
      !p.nonParty &&
      p.control !== "npc" &&
      (dm || seat.purseIds.includes(p.id)),
  );
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? "");
  const character = characters.find((p) => p.id === characterId);
  const lines = npc.barter?.lines,
    say = (key: "greet" | "barter" | "bye") => lines?.[key] ?? STANCE_LINES.fair[key];
  const [step, setStep] = useState<"hub" | "barter" | "services" | "service" | "left">("hub");
  const [local, setLocal] = useState<Line[]>(() => [{ kind: "npc", text: say("greet"), key: "greet-0" }]);
  const [typing, setTyping] = useState<string | undefined>("greet-0");
  const [drawer, setDrawer] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [mine, setMine] = useState<string[]>([]);
  const [spinning, setSpinning] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const repliesRef = useRef<HTMLDivElement>(null);
  const counter = useRef(0);
  const nextKey = (p: string) => `${p}-${++counter.current}`;
  const push = (...items: Line[]) => setLocal((current) => [...current, ...items]);
  // Temple, workshop and inn branches (docs/SERVICES.md).
  const svc = useServiceTalk({
    table,
    npc,
    character,
    push,
    nextKey,
    send: (input, id, renew) => send(input, id, renew),
    onBack: () => {
      push({ kind: "npc", text: say("greet"), key: nextKey("npc") });
      setStep("hub");
    },
  });
  // Open offers with this NPC (a counter to answer, an offer waiting for the DM) join the conversation.
  const attempts = state.attempts.filter((a) => a.npcId === npc.id && a.purseId === characterId);
  const shown = attempts.filter(
    (a) => mine.includes(a.id) || ["countered", "queued", "confirm"].includes(a.status),
  );
  const active = shown.at(-1);
  const giveLots = table.holdings.filter((h) => h.purseId === characterId && carried(h));
  const askLots = table.holdings.filter((h) => h.purseId === npc.id && carried(h));
  const side = (purseId: string, picked: Record<string, number>, copper: number, lots: Holding[]): BarterSide => ({
    purseId,
    copper,
    items: Object.entries(picked)
      .filter(([, q]) => q > 0)
      .flatMap(([id, quantity]) => {
        const h = lots.find((l) => l.id === id);
        return h ? [{ holdingId: id, quantity: Math.min(quantity, h.quantity), before: canonicalJson(h) }] : [];
      }),
  });
  const offer: BarterOfferInput | null =
    character && step === "barter"
      ? {
          npcId: npc.id,
          purseId: character.id,
          give: side(character.id, draft.give, draft.giveCopper, giveLots),
          ask: side(npc.id, draft.ask, draft.askCopper, askLots),
        }
      : null;
  const empty = !offer || (!offer.give.copper && !offer.ask.copper && !offer.give.items.length && !offer.ask.items.length);
  const quoteState = useNpcBarterQuote(table, empty ? null : offer);
  const quote = quoteState.status === "ready" ? quoteState.quote : null;
  // One ID per offer, whichever reply sends it: a committed offer is never sent twice.
  const action = useCommandId(`${npc.id}|${characterId}|${offer ? canonicalJson(offer) : ""}`);
  // Each answer to an open attempt keeps its own ID across retries.
  const answer = useCommandId(`${active?.id ?? ""}|${active?.revision ?? ""}`);

  // Replay the server's roll briefly when a fresh attempt arrives with dice.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const a of shown) {
      if (seen.current.has(a.id)) continue;
      seen.current.add(a.id);
      if (mine.includes(a.id) && a.roll && !reduced()) setSpinning(a.id);
    }
  });
  useEffect(() => {
    if (!spinning) return;
    const timer = setTimeout(() => setSpinning(undefined), 900);
    return () => clearTimeout(timer);
  }, [spinning]);
  const linesOf = (a: BarterAttempt) => {
    const all = attemptLines(a, character?.name ?? "You");
    // While the dice replay, the answer waits behind the roll.
    return spinning === a.id ? all.slice(0, all.findIndex((l) => l.kind === "roll") + 1) : all;
  };
  // Attempts appear where they were made; open ones from earlier follow the greeting.
  const placed = new Set(local.flatMap((l) => (l.kind === "attempt" || l.kind === "order" ? [l.id] : [])));
  const earlier = shown.filter((a) => !placed.has(a.id));
  // Open service requests from earlier visits join the conversation too.
  const earlierOrders = svc.shown.filter((o) => !placed.has(o.id));
  const transcript: Line[] = [
    ...local.slice(0, 1),
    ...earlier.flatMap(linesOf),
    ...earlierOrders.flatMap((o) => svc.linesFor(o.id) as Line[]),
    ...local.slice(1).flatMap((l) => {
      if (l.kind === "order") return svc.linesFor(l.id) as Line[];
      if (l.kind !== "attempt") return [l];
      const a = shown.find((x) => x.id === l.id);
      return a ? linesOf(a) : [];
    }),
  ];
  const newestKey = [...transcript].reverse().find((l) => l.kind === "npc")?.key;
  const lastNewest = useRef(newestKey);
  useEffect(() => {
    if (newestKey && newestKey !== lastNewest.current) setTyping(newestKey);
    lastNewest.current = newestKey;
  }, [newestKey]);

  async function send(input: Record<string, unknown>, id: string, renew: () => void) {
    setBusy(true);
    setError("");
    try {
      await commandOutcome({ ...input, id } as never);
      renew();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Your offer is kept.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const replies: Reply[] = [];
  // Every provider this NPC runs, each with the same availability check the server runs.
  const providers = npcServices(table, npc.id, character?.id);
  const serviceReply = (p: HubService): Reply => ({
    // A link opens another screen (fence Sell tab, bank loan request, hire proposal).
    tag: p.link ? `${p.tag} ↗` : p.tag,
    text: p.text,
    // A locked entry shows its reason; a ready order is still worth mentioning.
    sub: p.locked && !p.ready ? undefined : p.sub,
    href: p.href,
    disabled: p.locked || undefined,
    ...(p.providerId
      ? {
          run: () => {
            svc.open(p.providerId!, p.text, p.tag);
            setStep("service");
          },
        }
      : {}),
  });
  const leave: Reply = {
    text: "Farewell.",
    tone: "leave",
    run: () => {
      push({ kind: "pc", text: "Farewell.", key: nextKey("pc") }, { kind: "npc", text: say("bye"), key: nextKey("npc") });
      setStep("left");
      setDrawer(false);
      // Let the goodbye line show before returning to the map.
      if (onFarewell) setTimeout(onFarewell, reduced() ? 0 : 900);
    },
  };
  if (step === "left") {
    replies.push({
      text: `Talk to ${npc.name} again`,
      tone: "leave",
      run: () => {
        push({ kind: "npc", text: say("greet"), key: nextKey("npc") });
        setStep("hub");
      },
    });
  } else if (active?.status === "countered") {
    replies.push({
      tag: `Accept counter · you add ${formatCopper(active.counterCopper ?? 0)}`,
      text: "Deal.",
      run: async () => {
        setMine((m) => [...m, active.id]);
        await send({ kind: "npc-barter-decide", attemptId: active.id, revision: active.revision, decision: "accept-counter" }, answer.commandId, answer.renew);
      },
    });
    replies.push({
      tag: "Decline",
      text: "That's too rich for me.",
      run: async () => {
        setMine((m) => [...m, active.id]);
        if (await send({ kind: "npc-barter-decide", attemptId: active.id, revision: active.revision, decision: "decline-counter" }, answer.commandId, answer.renew))
          setStep("barter");
      },
    });
    replies.push(leave);
  } else if (active?.status === "queued") {
    replies.push({
      tag: "Cancel offer",
      text: "Forget I asked.",
      run: async () => {
        setMine((m) => [...m, active.id]);
        if (await send({ kind: "npc-barter-decide", attemptId: active.id, revision: active.revision, decision: "cancel" }, answer.commandId, answer.renew))
          setStep("barter");
      },
    });
    replies.push(leave);
  } else if (step === "hub") {
    replies.push({
      tag: "Barter",
      text: "I'd like to make you an offer.",
      disabled: !npcAnswersBarter(npc)
        ? `${npc.name} doesn't trade on their own. Use Trading & Barter.`
        : !near
          ? `${npc.name} isn't here.`
          : !character
            ? "Choose a character first."
            : undefined,
      run: () => {
        push(
          { kind: "pc", text: "I'd like to make you an offer.", tag: "Barter", key: nextKey("pc") },
          { kind: "npc", text: say("barter"), key: nextKey("npc") },
        );
        setStep("barter");
        setDrawer(true);
      },
    });
    replies.push({ tag: "Shop", text: "What's for sale around here?", href: "/market", sub: "Opens the Market's shops at the party's location." });
    const services = servicesReply(providers, npc.name);
    replies.push(
      services.mode === "direct"
        ? serviceReply(services)
        : services.mode === "list"
          ? {
              tag: services.tag,
              text: services.text,
              sub: services.sub,
              disabled: services.locked || undefined,
              run: () => {
                push(
                  { kind: "pc", text: services.text, tag: "Services", key: nextKey("pc") },
                  { kind: "npc", text: "Here's what I can do for you.", key: nextKey("npc") },
                );
                setStep("services");
              },
            }
          : { tag: services.tag, text: services.text, disabled: services.locked },
    );
    replies.push({
      tag: "Talk",
      text: "Can I ask you something?",
      href: `/features/npcs?npc=${encodeURIComponent(npc.id)}#npc-messages`,
      sub: "Your message thread with this NPC. The DM (or a controller) replies.",
    });
    replies.push(leave);
  } else if (step === "service") {
    replies.push(...svc.replies);
    if (!svc.active)
      replies.push({
        text: "Never mind.",
        tone: "leave",
        run: () => {
          push({ kind: "npc", text: say("greet"), key: nextKey("npc") });
          setStep("hub");
        },
      });
  } else if (step === "services") {
    for (const p of providers) replies.push({ ...serviceReply(p), tag: `${p.tag} · ${p.place}${p.link ? " ↗" : ""}` });
    replies.push({
      text: "Never mind.",
      tone: "leave",
      sub: "Back to the conversation.",
      run: () => {
        push({ kind: "pc", text: "Never mind.", key: nextKey("pc") }, { kind: "npc", text: say("greet"), key: nextKey("npc") });
        setStep("hub");
      },
    });
  } else {
    replies.push({
      tag: drawer ? "Hide my offer" : "Show my goods",
      text: drawer ? "Let me think about what I'm offering." : "I've got something you might want…",
      run: () => setDrawer((d) => !d),
    });
    if (empty) replies.push({ tag: "Persuasion", text: "Put something in the offer first.", disabled: "Empty offer" });
    else if (quoteState.status === "loading" || quoteState.status === "idle")
      replies.push({ tag: "Checking the odds…", text: "…", disabled: "Checking" });
    else if (quoteState.status === "error")
      replies.push({ tag: "Unavailable", text: quoteState.message, tone: "red", disabled: quoteState.message });
    else if (quote) {
      const expected = replyFor(quote);
      const mode = quote.mode;
      const sendOffer = (r: string) => async () => {
        if (!offer) return;
        const id = action.commandId;
        if (await send({ kind: "npc-barter-offer", ...offer, reply: r }, id, action.renew)) {
          setMine((m) => [...m, id]);
          push({ kind: "attempt", id, key: `attempt-${id}` });
          setDraft(emptyDraft());
          setDrawer(false);
        }
      };
      if (quote.locked && quote.kind !== "dm")
        replies.push({
          tag: `Locked · until ${formatCampaignMinute(quote.locked.until)}`,
          text: "Make the same offer again.",
          tone: "red",
          disabled: `${npc.name} won't consider this or a worse offer yet. Make it clearly better to try now.`,
        });
      else if (expected === "dm")
        replies.push({
          tag: <>DM decides <em>· {quote.reasons.find((r) => /DM/.test(r)) ?? "the DM values this deal"}</em></>,
          text: "Here's my offer. Let the Dungeon Master judge it.",
          tone: "dm",
          sub: `Odds if the DM asks for a check: ${oddsText(quote.chance)} (DC ${quote.dc}).`,
          run: sendOffer("dm"),
        });
      else if (expected === "offer")
        replies.push({
          tag: <>Offer <em>· no roll needed{mode === "dm" ? " · the DM decides" : mode === "confirm" ? " · the DM confirms" : ` · ${npc.name} will accept`}</em></>,
          text: "Here. Take it, it's a good deal.",
          tone: "check",
          sub: <FairnessBar quote={quote} npcName={npc.name} />,
          run: sendOffer("offer"),
        });
      else if (expected === "too-low")
        replies.push({
          tag: <>Too low <em>· {npc.name} will refuse · no roll</em></>,
          text: "Take it or leave it.",
          tone: "red",
          sub: <FairnessBar quote={quote} npcName={npc.name} />,
          run: sendOffer("too-low"),
        });
      else
        replies.push({
          tag: (
            <>
              Persuasion{" "}
              <em>
                · DC {quote.dc}
                {quote.repeat ? ` (+${quote.repeat} tries)` : ""} · {oddsText(quote.chance)} · {advantageWord(quote.advantage)}
                {mode === "dm" ? " · the DM decides" : ""}
              </em>
            </>
          ),
          text: quote.band === "fair" || quote.band === "generous" ? "That's a fair price, and you know it." : quote.band === "close" ? "Come now, that's close enough to fair." : "Surely we can come to some arrangement?",
          tone: "check",
          sub: (
            <>
              <FairnessBar quote={quote} npcName={npc.name} />
              <br />
              <OddsPips chance={quote.chance} /> d20 {quote.bonus >= 0 ? "+" : "−"}
              {Math.abs(quote.bonus)}: you need {Math.max(1, quote.need)} or higher on{" "}
              {quote.advantage === "advantage" ? "either die" : quote.advantage === "disadvantage" ? "both dice" : "the die"}.
            </>
          ),
          run: sendOffer("persuade"),
        });
      if (quote.addCopper > 0 && (quote.kind === "check" || quote.kind === "refuse") && !quote.locked)
        replies.push({
          tag: <>Sweeten · add {formatCopper(quote.addCopper)} <em>· then no roll needed</em></>,
          text: `Fine. I'll add ${formatCopper(quote.addCopper)}.`,
          disabled:
            character && toCopper(character.coins) < draft.giveCopper + quote.addCopper ? "You don't have that much coin." : undefined,
          run: () => {
            setDraft((d) => ({ ...d, giveCopper: d.giveCopper + quote.addCopper }));
            setDrawer(true);
          },
        });
      if (expected !== "dm" && !(quote.locked && quote.kind !== "dm"))
        replies.push({
          tag: "DM decides",
          text: "Let the Dungeon Master judge this deal.",
          tone: "dm",
          sub: "Sends the offer to the DM's queue instead of rolling now.",
          run: sendOffer("dm"),
        });
    }
    replies.push({
      text: "Never mind.",
      tone: "leave",
      run: () => {
        push({ kind: "pc", text: "Never mind.", key: nextKey("pc") }, { kind: "npc", text: say("greet"), key: nextKey("npc") });
        setStep("hub");
        setDrawer(false);
      },
    });
  }

  const choose = async (r: Reply) => {
    if (busy || r.disabled || !r.run) return;
    setTyping(undefined);
    await r.run();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    if (typing) setTyping(undefined);
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= replies.length) {
      const r = replies[n - 1];
      if (r.href) repliesRef.current?.querySelectorAll<HTMLElement>("[data-reply]")[n - 1]?.click();
      else void choose(r);
      e.preventDefault();
    }
  };
  const characterLine = useMemo(() => {
    if (!character) return "";
    const s = character.sheet;
    return s ? `Charisma ${s.scores.cha}` : "No character sheet";
  }, [character]);

  return (
    <section className="npc-talk" aria-label={`Talk to ${npc.name}`} onKeyDown={onKeyDown}>
      <aside className="npc-talk-stage">
        <div className="npc-talk-portrait" aria-hidden="true">
          {npc.portrait ? <img src={npc.portrait} alt="" /> : npc.name.slice(0, 1)}
        </div>
        <span className="npc-talk-nameplate">{npc.name}</span>
        <p>{npc.description.split("\n")[0].slice(0, 120)}</p>
        {characters.length > 1 ? (
          <label className="npc-talk-character">
            Speaking as
            <select
              value={characterId}
              onChange={(e) => {
                // A new speaker starts a fresh conversation; their open offers rejoin it.
                setCharacterId(e.target.value);
                setDraft(emptyDraft());
                svc.close();
                setStep("hub");
                setDrawer(false);
                setError("");
                setLocal([{ kind: "npc", text: say("greet"), key: nextKey("greet") }]);
              }}
            >
              {characters.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          character && <p className="npc-talk-with">{character.name}</p>
        )}
        {character && <p className="npc-talk-with-detail">{characterLine}</p>}
      </aside>
      <div className="npc-talk-main">
        <Transcript
          lines={transcript}
          npcName={npc.name}
          characterName={character?.name ?? "You"}
          typing={typing}
          onTyped={() => setTyping(undefined)}
          spinning={spinning}
          live
        />
        {step === "service" && svc.drawer}
        {drawer && step === "barter" && character && (
          <div className="npc-talk-drawer">
            <div className="npc-talk-drawer-head">
              <h3>Your offer</h3>
              {quote && <FairnessBar quote={quote} npcName={npc.name} />}
            </div>
            <div className="npc-talk-drawer-cols">
              <OfferColumn
                title="You give"
                lots={giveLots}
                picked={draft.give}
                setPicked={(give) => setDraft((d) => ({ ...d, give }))}
                copper={draft.giveCopper}
                setCopper={(giveCopper) => setDraft((d) => ({ ...d, giveCopper }))}
                coinLabel={`Your coins (copper) · you carry ${formatCopper(toCopper(character.coins))}`}
                coinName="Coins you give (copper)"
              />
              <OfferColumn
                title={`You ask ${npc.name} for`}
                lots={askLots}
                picked={draft.ask}
                setPicked={(ask) => setDraft((d) => ({ ...d, ask }))}
                copper={draft.askCopper}
                setCopper={(askCopper) => setDraft((d) => ({ ...d, askCopper }))}
                coinLabel={`Coins from ${npc.name} (copper)`}
                coinName="Coins you ask for (copper)"
              />
            </div>
            {quote && (quote.unwanted.length > 0 || quote.unreferenced.length > 0) && (
              <p className="npc-talk-note">
                {quote.unwanted.length > 0 && `${npc.name} shows no interest in ${quote.unwanted.join(", ")}. `}
                {quote.unreferenced.length > 0 && `${quote.unreferenced.join(", ")}: no reference price, so the DM values it.`}
              </p>
            )}
            <p className="npc-talk-hint">
              Tap goods to add or remove them. {npc.name}'s purse stays private. For search and categories, use{" "}
              <AppLink href="/features/trading">Trading & Barter</AppLink>.
            </p>
          </div>
        )}
        <div className="npc-talk-replies" role="group" aria-label="Your replies" ref={repliesRef}>
          <p className="npc-talk-prompt">{busy ? "…" : "Your reply"}</p>
          {replies.map((r, i) => {
            const content = (
              <>
                <span className="npc-talk-n" aria-hidden="true">
                  {r.disabled ? "🔒" : i + 1}
                </span>
                {r.tag && <span className="npc-talk-tag">[{r.tag}]</span>}
                <span className="npc-talk-text">{r.text}</span>
                {r.sub && <span className="npc-talk-sub">{r.sub}</span>}
                {r.disabled && r.disabled !== r.text && <span className="npc-talk-sub">{r.disabled}</span>}
              </>
            );
            const className = `npc-talk-reply${r.tone ? ` ${r.tone}` : ""}`;
            return r.href && !r.disabled ? (
              <AppLink key={i} data-reply="" className={className} href={r.href} aria-keyshortcuts={String(i + 1)}>
                {content}
              </AppLink>
            ) : (
              <button
                key={i}
                type="button"
                data-reply=""
                className={className}
                disabled={!!r.disabled || busy}
                aria-keyshortcuts={String(i + 1)}
                onClick={() => void choose(r)}
              >
                {content}
              </button>
            );
          })}
          {error && (
            <p role="alert" className="npc-talk-error">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function OfferColumn({
  title,
  lots,
  picked,
  setPicked,
  copper,
  setCopper,
  coinLabel,
  coinName,
}: {
  coinName: string;
  title: string;
  lots: Holding[];
  picked: Record<string, number>;
  setPicked: (next: Record<string, number>) => void;
  copper: number;
  setCopper: (n: number) => void;
  coinLabel: string;
}) {
  const [all, setAll] = useState(false);
  const visible = all ? lots : lots.slice(0, 12);
  return (
    <div className="npc-talk-drawer-col">
      <h4>{title}</h4>
      <div className="npc-talk-chips">
        {visible.map((h) => (
          <button
            key={h.id}
            type="button"
            className="npc-talk-chip"
            aria-pressed={(picked[h.id] ?? 0) > 0}
            onClick={() => setPicked({ ...picked, [h.id]: picked[h.id] ? 0 : 1 })}
          >
            {h.name}
            {h.valueSource === "player" && <span title="No reference price"> ?</span>}{" "}
            <small>
              {formatCopper(h.unitCopper)}
              {h.quantity > 1 ? ` · ${h.quantity} held` : ""}
            </small>
          </button>
        ))}
        {!lots.length && <p className="npc-talk-hint">Nothing to offer here.</p>}
        {lots.length > 12 && (
          <button type="button" className="npc-talk-chip" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${lots.length}`}
          </button>
        )}
      </div>
      {Object.entries(picked)
        .filter(([, q]) => q > 0)
        .map(([id, q]) => {
          const h = lots.find((l) => l.id === id);
          if (!h || h.quantity < 2) return null;
          return (
            <label key={id} className="npc-talk-qty">
              {h.name} quantity
              <input
                type="number"
                min={1}
                max={h.quantity}
                value={q}
                onChange={(e) =>
                  setPicked({ ...picked, [id]: Math.max(1, Math.min(h.quantity, Math.floor(Number(e.target.value) || 1))) })
                }
              />
            </label>
          );
        })}
      <label className="npc-talk-coins">
        {coinLabel}
        <input
          type="number"
          aria-label={coinName}
          min={0}
          step={10}
          value={copper}
          onChange={(e) => setCopper(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        />
        <small>{formatCopper(copper)}</small>
      </label>
    </div>
  );
}
