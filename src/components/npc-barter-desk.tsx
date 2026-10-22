import { useState } from "react";
import { useSeat } from "@/lib/quire/seat";
import { useCommandId, useEconomy } from "@/lib/quire/economy-context";
import { readWorld, type Npc } from "@/lib/quire/world-schema";
import { formatCopper } from "@/lib/quire/money";
import {
  STANCE_LINES,
  attemptFailed,
  formatCampaignMinute,
  npcAnswersBarter,
  npcBarterMode,
  npcBarterStance,
  readNpcBarter,
} from "@/lib/quire/npc-barter";
import {
  barterLineKeys,
  barterModes,
  barterStances,
  type BarterAttempt,
  type BarterLineKey,
  type BarterRules,
  type BarterStance,
  type NpcBarterConfig,
} from "@/lib/quire/npc-barter-schema";
import type { CloudTable } from "@/lib/quire/cloud";
import type { Holding } from "@/lib/quire/types";
import { Transcript, attemptLines, oddsText } from "./npc-conversation";
import { CommandForm } from "./world-tools";
import { Button, Fold } from "./ui";

const modeLabel = { dm: "DM decides", confirm: "Server rolls, DM confirms", auto: "Automatic" } as const;
const stanceLabel = { generous: "Generous (DC −2)", fair: "Fair", shrewd: "Shrewd (DC +2)" } as const;
const lineLabel: Record<BarterLineKey, string> = {
  greet: "Greeting",
  barter: "Barter opens",
  accept: "Accepts",
  counter: "Counters ({coins})",
  refuse: "Refuses after a roll",
  tooLow: "Too low (no roll)",
  noInterest: "Doesn't want an item ({item})",
  cooldown: "Come back later ({time})",
  dm: "Sends to the DM",
  bye: "Farewell",
};
const statusLabel: Record<BarterAttempt["status"], string> = {
  accepted: "Accepted",
  countered: "Counter-offer",
  refused: "Refused",
  queued: "Waiting for the DM",
  confirm: "Rolled · confirm",
  declined: "Declined",
  cancelled: "Cancelled",
};
const characterName = (t: CloudTable, id: string) => t.purses.find((p) => p.id === id)?.name ?? "Former character";

/** DM tools on Trading & Barter, and every player's own NPC barter history. */
export function NpcBarterDesk({ table }: { table: CloudTable }) {
  const seat = useSeat(),
    dm = seat.role === "dm";
  const world = readWorld(table.journal?.world),
    state = readNpcBarter(world);
  if (!world.npcs.some(npcAnswersBarter) && !state.attempts.length && !dm) return null;
  return (
    <section className="npc-barter-desk" aria-label="NPC barter">
      <h2>NPC barter</h2>
      <p className="text-sm text-muted">
        Talk to a nearby NPC (People & NPCs) to barter in conversation. NPCs with a player controller
        keep the trading table below.
      </p>
      {dm && <NpcBarterQueue table={table} />}
      {dm && <NpcBarterRulesForm key={state.revision} rules={state.rules} revision={state.revision} />}
      <NpcBarterHistory table={table} />
    </section>
  );
}

function NpcBarterRulesForm({ rules, revision }: { rules: BarterRules; revision: number }) {
  const [draft, setDraft] = useState(rules);
  const num = (key: keyof BarterRules, label: string, min: number, max: number, hint?: string) => (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={draft[key] as number}
        onChange={(e) => setDraft({ ...draft, [key]: Math.floor(Number(e.target.value)) })}
      />
      {hint && <small className="text-muted">{hint}</small>}
    </label>
  );
  const flag = (key: keyof BarterRules, label: string) => (
    <label>
      <input
        type="checkbox"
        checked={draft[key] as boolean}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
      />{" "}
      {label}
    </label>
  );
  const dc = (ratio: number, shift: number) =>
    Math.max(5, Math.min(25, Math.round((35000 - 25 * ratio) / 1000) + shift));
  return (
    <Fold title="NPC barter rules" hint={`${modeLabel[rules.mode]} · ${stanceLabel[rules.stance]}`}>
      <CommandForm
        label="Save barter rules"
        dirty={JSON.stringify(draft) !== JSON.stringify(rules)}
        submit={() => ({ kind: "npc-barter-rules", revision, rules: draft })}
      >
        <label>
          Who answers offers to NPCs without a controller
          <select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as BarterRules["mode"] })}>
            {barterModes.map((m) => (
              <option key={m} value={m}>
                {modeLabel[m]}
              </option>
            ))}
          </select>
          <small className="text-muted">
            DM decides: offers wait in your queue. Server rolls, DM confirms: the roll happens at once,
            nothing moves until you confirm. Automatic: the NPC answers at once.
          </small>
        </label>
        <label>
          Default haggling stance
          <select value={draft.stance} onChange={(e) => setDraft({ ...draft, stance: e.target.value as BarterRules["stance"] })}>
            {barterStances.map((s) => (
              <option key={s} value={s}>
                {stanceLabel[s]}
              </option>
            ))}
          </select>
        </label>
        {num("receivePercent", "Goods an NPC receives count at (% of recorded value)", 0, 100, "Like a shop's buy rate. The NPC's own goods count at full value.")}
        {num("acceptPercent", "Accept without a roll at (% received ÷ given)", 100, 300)}
        {num("refusePercent", "Refuse without a roll below (%)", 10, 100)}
        {num("counterMargin", "Counter-offer when a roll misses by at most", 0, 10, "0 turns counters off.")}
        {num("cooldownMinutes", "Wait after a failed roll (in-game minutes)", 0, 10080, "Equal or worse offers are locked; clearly better ones may try at a higher DC.")}
        {num("repeatDc", "DC added per failed try in 24 in-game hours", 0, 5)}
        {num("attemptsBeforeQueue", "Failed tries before offers go to your queue", 1, 10)}
        {num("offerCapCopper", "Queue offers where the NPC gives more than (copper)", 0, 1e12)}
        {num("dailyCapCopper", "Queue once the NPC gives the party more than this in 24 in-game hours (copper)", 0, 1e12)}
        {num("unitCap", "Units of the same good an NPC values per 24 in-game hours", 1, 100)}
        {flag("partyMemory", "Refusals apply to the whole party (otherwise per player)")}
        {flag("combineTrades", "Judge barters with the same NPC in 24 in-game hours as one deal")}
        {flag("unreferencedToDm", "Send goods without a reference price to the DM")}
        <div className="scroll">
          <table className="npc-barter-table">
            <caption>Resulting DCs</caption>
            <thead>
              <tr>
                <th>Received ÷ given</th>
                <th>Generous</th>
                <th>Fair</th>
                <th>Shrewd</th>
              </tr>
            </thead>
            <tbody>
              {[1250, 1100, 1000, 900, 800, 700, 600, 500].map((r) => (
                <tr key={r}>
                  <td>{r / 10}%</td>
                  {[-2, 0, 2].map((shift) => (
                    <td key={shift}>
                      {r >= draft.acceptPercent * 10 ? "no roll" : r < draft.refusePercent * 10 ? "refused" : `DC ${dc(r, shift)}`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button variant="secondary" onClick={() => setDraft(rules)}>
          Discard changes
        </Button>
      </CommandForm>
    </Fold>
  );
}

function valuation(t: CloudTable, a: BarterAttempt) {
  const q = a.quote;
  return (
    <dl className="npc-barter-kv">
      <dt>NPC receives</dt>
      <dd>{formatCopper(q.received)}</dd>
      <dt>NPC gives</dt>
      <dd>{formatCopper(q.given)}</dd>
      <dt>Fairness</dt>
      <dd>{(q.ratio / 10).toFixed(1)}%</dd>
      <dt>Check</dt>
      <dd>
        DC {q.dc} · {characterName(t, a.purseId)} {q.bonus >= 0 ? "+" : "−"}
        {Math.abs(q.bonus)} · {q.advantage} · {oddsText(q.chance)}
      </dd>
      {q.reasons.length > 0 && (
        <>
          <dt>Notes</dt>
          <dd>{q.reasons.join(" ")}</dd>
        </>
      )}
    </dl>
  );
}

function NpcBarterQueue({ table }: { table: CloudTable }) {
  const world = readWorld(table.journal?.world),
    state = readNpcBarter(world);
  const waiting = state.attempts.filter((a) => a.status === "queued" || a.status === "confirm");
  return (
    <div className="npc-barter-queue">
      <h3>NPC barter queue · {waiting.length} waiting</h3>
      {!waiting.length && <p className="text-sm text-muted">No NPC offers are waiting for you.</p>}
      {waiting.map((a) => (
        <QueueItem key={a.id} table={table} attempt={a} npc={world.npcs.find((n) => n.id === a.npcId)} />
      ))}
      <NpcBarterActivity table={table} />
    </div>
  );
}

function QueueItem({ table, attempt: a, npc }: { table: CloudTable; attempt: BarterAttempt; npc?: Npc }) {
  const { commandOutcome } = useEconomy();
  const action = useCommandId(`${a.id}|${a.revision}`);
  const [counter, setCounter] = useState(String(Math.max(10, a.counterCopper ?? 100)));
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const unreferenced = a.give.items.flatMap((item) => {
    try {
      const h = JSON.parse(item.before) as Holding;
      return h.valueSource === "player" ? [h] : [];
    } catch {
      return [];
    }
  });
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(unreferenced.map((h) => [h.id, String(h.unitCopper)])),
  );
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      await commandOutcome({
        ...body,
        kind: "npc-barter-resolve",
        attemptId: a.id,
        revision: a.revision,
        id: action.commandId,
      } as never);
      action.renew();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action failed.");
    } finally {
      setBusy(false);
    }
  };
  const valueList = unreferenced.length
    ? { values: unreferenced.map((h) => ({ holdingId: h.id, copper: Math.max(0, Math.floor(Number(values[h.id]) || 0)) })) }
    : {};
  const name = characterName(table, a.purseId);
  return (
    <article className="npc-barter-item" aria-label={`${name} and ${npc?.name ?? "NPC"}`}>
      <h4>
        {name} → {npc?.name ?? "Former NPC"} · {statusLabel[a.status]}
      </h4>
      <details>
        <summary>What the player saw</summary>
        <Transcript lines={attemptLines(a, name)} npcName={npc?.name ?? "NPC"} characterName={name} />
      </details>
      <div className="npc-barter-dm-only">
        <p className="commodity-eyebrow">DM only · {npc?.name ?? "NPC"}'s view</p>
        {valuation(table, a)}
        {unreferenced.map((h) => (
          <label key={h.id}>
            Value {h.name} for this deal (copper each; recorded {formatCopper(h.unitCopper)})
            <input
              type="number"
              min={0}
              value={values[h.id] ?? ""}
              onChange={(e) => setValues({ ...values, [h.id]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <fieldset disabled={busy} className="npc-barter-actions">
        {a.status === "queued" ? (
          <>
            <Button onClick={() => void run({ action: "roll", ...valueList })}>Ask the server to roll</Button>
            <Button variant="secondary" onClick={() => void run({ action: "accept", ...valueList })}>
              Accept as offered
            </Button>
            <label>
              Counter: extra coins (copper)
              <input type="number" min={10} step={10} value={counter} onChange={(e) => setCounter(e.target.value)} />
            </label>
            <Button variant="secondary" onClick={() => void run({ action: "counter", counterCopper: Math.max(1, Math.floor(Number(counter) || 0)) })}>
              Send counter-offer
            </Button>
            <Button variant="danger" onClick={() => void run({ action: "decline" })}>
              Decline
            </Button>
          </>
        ) : (
          <>
            <label>
              Reason, if you overrule
              <input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label>
              <input type="checkbox" checked={showReason} onChange={(e) => setShowReason(e.target.checked)} /> Show
              the reason to the player
            </label>
            <Button onClick={() => void run({ action: "confirm" })}>Confirm the result</Button>
            <Button variant="danger" onClick={() => void run({ action: "overrule", reason, showReason })}>
              Overrule the roll
            </Button>
          </>
        )}
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </article>
  );
}

function NpcBarterActivity({ table }: { table: CloudTable }) {
  const world = readWorld(table.journal?.world),
    state = readNpcBarter(world);
  const [page, setPage] = useState(0);
  const all = [...state.attempts].reverse();
  const pages = Math.max(1, Math.ceil(all.length / 50));
  const rows = all.slice(page * 50, page * 50 + 50);
  const { commandOutcome } = useEconomy();
  if (!all.length) return null;
  return (
    <Fold title="NPC barter activity" hint={`${all.length} attempts · DM only`}>
      <div className="scroll">
        <table className="npc-barter-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Character → NPC</th>
              <th>Fairness</th>
              <th>Check</th>
              <th>Outcome</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>{formatCampaignMinute(a.minute)}</td>
                <td>
                  {characterName(table, a.purseId)} → {world.npcs.find((n) => n.id === a.npcId)?.name ?? "Former NPC"}
                </td>
                <td>{(a.quote.ratio / 10).toFixed(0)}%</td>
                <td>
                  {a.roll
                    ? `DC ${a.quote.dc} · [${a.roll.dice.join(", ")}] ${a.quote.bonus >= 0 ? "+" : "−"}${Math.abs(a.quote.bonus)} = ${a.roll.total}`
                    : "No roll"}
                </td>
                <td>
                  {statusLabel[a.status]}
                  {a.counterCopper !== undefined ? ` (+${formatCopper(a.counterCopper)})` : ""}
                  {a.cleared ? " · wait cleared" : ""}
                </td>
                <td>
                  {attemptFailed(a) && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void commandOutcome({ kind: "npc-barter-clear-wait", attemptId: a.id, revision: a.revision, id: `clear-${a.id}-${a.revision}` }).catch(() => undefined)
                      }
                    >
                      Clear wait
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="world-toolbar">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Newer
          </Button>
          <span>
            Page {page + 1} of {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Older
          </Button>
        </div>
      )}
    </Fold>
  );
}

function NpcBarterHistory({ table }: { table: CloudTable }) {
  const seat = useSeat(),
    world = readWorld(table.journal?.world),
    state = readNpcBarter(world);
  const mine = [...state.attempts]
    .filter((a) => seat.role === "dm" || seat.purseIds.includes(a.purseId))
    .reverse();
  const [count, setCount] = useState(10);
  if (!mine.length) return null;
  return (
    <Fold title="NPC conversations" hint={`${mine.length} barters with NPCs`}>
      {mine.slice(0, count).map((a) => {
        const npc = world.npcs.find((n) => n.id === a.npcId);
        const name = characterName(table, a.purseId);
        return (
          <article key={a.id} className="npc-barter-item">
            <h4>
              {name} and {npc?.name ?? "Former NPC"} · {statusLabel[a.status]} · {formatCampaignMinute(a.minute)}
            </h4>
            <Transcript lines={attemptLines(a, name)} npcName={npc?.name ?? "NPC"} characterName={name} />
            {(a.status === "countered" || a.status === "queued") && (
              <p className="text-sm text-muted">Answer this in the conversation with {npc?.name ?? "the NPC"} (People & NPCs).</p>
            )}
          </article>
        );
      })}
      {mine.length > count && (
        <Button variant="secondary" onClick={() => setCount(count + 10)}>
          Show more
        </Button>
      )}
    </Fold>
  );
}

/** Per-NPC barter answers, stance, wanted goods and dialogue lines (DM only). */
export function NpcBarterConfigForm({ npc, table }: { npc: Npc; table: CloudTable }) {
  const rules = readNpcBarter(readWorld(table.journal?.world)).rules;
  const before: NpcBarterConfig | null = npc.barter ?? null;
  const [draft, setDraft] = useState<NpcBarterConfig>(npc.barter ?? {});
  const categories = Array.from(
    new Set([
      "provisions",
      "smith",
      "cloth",
      "apothecary",
      "inn",
      "general",
      "curios",
      "stable",
      "scribe",
      "jewels",
      ...table.holdings.flatMap((h) => (h.category ? [h.category] : [])),
    ]),
  );
  const stance: BarterStance = draft.stance ?? rules.stance;
  const clean = (c: NpcBarterConfig): NpcBarterConfig | null => {
    const lines = Object.fromEntries(Object.entries(c.lines ?? {}).filter(([, v]) => v && v.trim()));
    const next: NpcBarterConfig = {
      ...(c.mode ? { mode: c.mode } : {}),
      ...(c.stance ? { stance: c.stance } : {}),
      ...(c.wants ? { wants: c.wants } : {}),
      ...(Object.keys(lines).length ? { lines } : {}),
    };
    return Object.keys(next).length ? next : null;
  };
  return (
    <Fold title={`Barter answers · ${npc.name}`} hint={`${modeLabel[npcBarterMode(npc, rules)]} · ${npcBarterStance(npc, rules)}`}>
      {npc.controllerPurseId && (
        <p className="text-sm text-muted">This NPC has a player controller, who answers offers as today. These choices are kept for later.</p>
      )}
      <CommandForm
        label={`Save ${npc.name} barter answers`}
        dirty={JSON.stringify(clean(draft)) !== JSON.stringify(before)}
        submit={() => ({ kind: "npc-barter-npc", npcId: npc.id, before, config: clean(draft) })}
      >
        <label>
          Who answers
          <select
            value={draft.mode ?? ""}
            onChange={(e) => setDraft({ ...draft, mode: (e.target.value || undefined) as NpcBarterConfig["mode"] })}
          >
            <option value="">Campaign rule ({modeLabel[rules.mode]})</option>
            {barterModes.map((m) => (
              <option key={m} value={m}>
                {modeLabel[m]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Haggling stance
          <select
            value={draft.stance ?? ""}
            onChange={(e) => setDraft({ ...draft, stance: (e.target.value || undefined) as NpcBarterConfig["stance"] })}
          >
            <option value="">Campaign stance ({stanceLabel[rules.stance]})</option>
            {barterStances.map((s) => (
              <option key={s} value={s}>
                {stanceLabel[s]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="npc-barter-wants">
          <legend>Goods {npc.name} wants</legend>
          <label>
            <input
              type="checkbox"
              checked={!draft.wants}
              onChange={(e) => setDraft({ ...draft, wants: e.target.checked ? undefined : [] })}
            />{" "}
            Every category
          </label>
          {draft.wants &&
            categories.map((c) => (
              <label key={c}>
                <input
                  type="checkbox"
                  checked={draft.wants!.includes(c)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      wants: e.target.checked ? [...draft.wants!, c] : draft.wants!.filter((w) => w !== c),
                    })
                  }
                />{" "}
                {c}
              </label>
            ))}
        </fieldset>
        <fieldset>
          <legend>Dialogue lines</legend>
          <p className="text-sm text-muted">
            Empty lines use the {stance} stance default. {"{coins}"}, {"{time}"}, {"{item}"} and {"{character}"} are filled in.
            Players only hear the lines you write here or the defaults; nothing is generated.
          </p>
          {barterLineKeys.map((key) => (
            <label key={key}>
              {lineLabel[key]}
              <textarea
                rows={2}
                maxLength={500}
                placeholder={STANCE_LINES[stance][key]}
                value={draft.lines?.[key] ?? ""}
                onChange={(e) => setDraft({ ...draft, lines: { ...draft.lines, [key]: e.target.value || undefined } })}
              />
            </label>
          ))}
        </fieldset>
      </CommandForm>
    </Fold>
  );
}

