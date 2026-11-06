/**
 * Quests and renown (quests.ts; factions PR C, owner decision 2026-11-05 22:35 ET).
 * - `QuestRenownEditor` (DM, quest editor): the giver faction and renown rewards, applied
 *   automatically when the quest is completed; locked once applied.
 * - `QuestRenownOffer` (DM): a completed quest without rewards offers a renown change, pre-filled
 *   with the party and the giver faction; nothing changes until the DM applies it.
 * - `PlayerQuestRenown`: the rewards a player may see (the projection already removed hidden
 *   factions and rewards that don't reach them).
 */
import { useState } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { factionCharacter, factionParty, MAX_RENOWN_DELTA, readFactions, type Faction } from "@/lib/quire/factions";
import { MAX_QUEST_RENOWN_REWARDS, type Quest, type QuestRenownReward } from "@/lib/quire/quests-schema";
import type { CommandInput } from "@/lib/quire/commands";
import { Status, useFactionCommand } from "./faction-command";
import { Button, Field, Select, TextInput } from "./ui";

function useFactionList(): { factions: Faction[]; table: { purses: ReturnType<typeof useEconomy>["purses"]; journal: ReturnType<typeof useEconomy>["journal"] } } {
  const { journal, purses } = useEconomy();
  let factions: Faction[] = [];
  try {
    factions = readFactions((journal as { factions?: unknown }).factions);
  } catch {
    factions = [];
  }
  return { factions, table: { purses, journal } };
}
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;

/** "The Black Hand +100 · the party" (names from the given lists; unknown ones are "a faction"). */
function rewardText(r: QuestRenownReward, factions: Faction[], names: Map<string, string>, you?: Set<string>) {
  const faction = factions.find((f) => f.id === r.factionId)?.name ?? "A faction";
  const who =
    r.target.kind === "party"
      ? "the party"
      : r.target.purseIds.map((id) => (you?.has(id) ? "you" : (names.get(id) ?? "a character"))).join(", ");
  return `${faction} ${signed(r.delta)} renown · ${who}`;
}

type Row = { factionId: string; delta: string; target: string };

export function QuestRenownEditor({ quest }: { quest: Quest }) {
  const { factions, table } = useFactionList();
  const live = factions.filter((f) => !f.deleted);
  const characters = table.purses.filter((p) => factionCharacter(table, p));
  const names = new Map(table.purses.map((p) => [p.id, p.name]));
  const locked = quest.renownAppliedAt !== undefined || quest.status === "completed";
  const toRows = () =>
    (quest.renownRewards ?? []).map((r) => ({
      factionId: r.factionId,
      delta: String(r.delta),
      target: r.target.kind === "party" ? "party" : r.target.purseIds.join(","),
    }));
  const [giver, setGiver] = useState(quest.giverFactionId ?? "");
  const [rows, setRows] = useState<Row[]>(toRows);
  const [problem, setProblem] = useState("");
  const command = useFactionCommand(`quest-renown|${quest.id}|${quest.revision}|${giver}|${JSON.stringify(rows)}`);
  if (!live.length && !quest.renownRewards?.length && !quest.giverFactionId) return null;
  const set = (i: number, patch: Partial<Row>) => setRows((x) => x.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  async function save() {
    const rewards: QuestRenownReward[] = [];
    for (const r of rows) {
      const delta = Number(r.delta);
      if (!r.factionId) return setProblem("Choose a faction for each renown reward.");
      if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > MAX_RENOWN_DELTA)
        return setProblem(`Each renown change is a whole number other than 0, up to ${MAX_RENOWN_DELTA}.`);
      rewards.push({
        factionId: r.factionId,
        delta,
        target: r.target === "party" ? { kind: "party" } : { kind: "characters", purseIds: r.target.split(",") },
      });
    }
    setProblem("");
    await command.send(
      {
        kind: "quest-renown",
        questId: quest.id,
        revision: quest.revision,
        giverFactionId: giver || null,
        rewards: locked ? (quest.renownRewards ?? []) : rewards,
      } as CommandInput,
      "Renown rewards saved.",
    );
  }
  return (
    <section className="quest-box" aria-label="Renown" data-testid="quest-renown-editor">
      <Field label="Giver faction" hint="Optional. Suggested when you change renown for this quest; players see it only while the faction is visible.">
        <Select aria-label="Giver faction" value={giver} onChange={(e) => setGiver(e.target.value)}>
          <option value="">None</option>
          {live.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.hidden ? " (hidden)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      <strong className="text-sm">Renown rewards</strong>
      {locked ? (
        <>
          {(quest.renownRewards ?? []).length ? (
            <ul className="grid gap-1 text-sm" data-testid="quest-renown-applied">
              {quest.renownRewards!.map((r, i) => (
                <li key={i}>
                  {rewardText(r, factions, names)}
                  {quest.renownSkipped?.includes(i) ? " (skipped: its faction was deleted or it reached nobody)" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="quest-muted">None.</p>
          )}
          <p className="quest-muted">
            {quest.renownAppliedAt !== undefined
              ? "Applied when the quest was completed. Reopening doesn't undo them; change renown on Factions."
              : "The quest is completed; change renown on Factions."}
          </p>
        </>
      ) : (
        <>
          <p className="quest-muted">Applied automatically when you complete the quest, with the Favor the gains earn. Nothing changes before then.</p>
          {rows.map((r, i) => (
            <div key={i} className="faction-grid" data-testid="quest-renown-row">
              <Field label="Faction">
                <Select aria-label={`Reward ${i + 1} faction`} value={r.factionId} onChange={(e) => set(i, { factionId: e.target.value })}>
                  <option value="">Choose…</option>
                  {live.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Renown change">
                <TextInput aria-label={`Reward ${i + 1} renown change`} inputMode="numeric" value={r.delta} onChange={(e) => set(i, { delta: e.target.value })} />
              </Field>
              <Field label="Who">
                <Select aria-label={`Reward ${i + 1} who`} value={r.target} onChange={(e) => set(i, { target: e.target.value })}>
                  <option value="party">The party (when completed)</option>
                  {characters.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  {r.target !== "party" && r.target.includes(",") ? <option value={r.target}>{r.target.split(",").map((id) => names.get(id) ?? "a character").join(", ")}</option> : null}
                </Select>
              </Field>
              <div className="flex items-end">
                <Button variant="ghost" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
          {rows.length < MAX_QUEST_RENOWN_REWARDS && live.length ? (
            <div>
              <Button
                variant="secondary"
                onClick={() => setRows((x) => [...x, { factionId: giver || live[0]!.id, delta: "10", target: "party" }])}
              >
                Add a renown reward
              </Button>
            </div>
          ) : null}
        </>
      )}
      <div>
        <Button disabled={command.busy} onClick={() => void save()}>
          {command.busy ? "Saving…" : "Save renown"}
        </Button>
      </div>
      {problem && <p role="alert">{problem}</p>}
      <Status error={command.error} notice={command.notice} />
    </section>
  );
}

const dismissKey = (questId: string) => `lootsplit.quest-renown-offer.${questId}`;
function readDismissed(questId: string) {
  try {
    return localStorage.getItem(dismissKey(questId)) === "1";
  } catch {
    return false;
  }
}

/**
 * A completed quest without configured rewards: offer one renown change for the party, with the
 * giver faction suggested. Dismissing it (or applying it) is remembered on this device only.
 */
export function QuestRenownOffer({ quest }: { quest: Quest }) {
  const { factions, table } = useFactionList();
  const live = factions.filter((f) => !f.deleted);
  const [dismissed, setDismissed] = useState(() => readDismissed(quest.id));
  const [factionId, setFactionId] = useState(quest.giverFactionId && live.some((f) => f.id === quest.giverFactionId) ? quest.giverFactionId : "");
  const [delta, setDelta] = useState("10");
  const [target, setTarget] = useState("party");
  const [problem, setProblem] = useState("");
  const command = useFactionCommand(`quest-offer|${quest.id}|${factionId}|${delta}|${target}`);
  if (quest.status !== "completed" || quest.renownRewards?.length || !live.length || dismissed) return null;
  const party = factionParty(table);
  const characters = table.purses.filter((p) => factionCharacter(table, p));
  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(quest.id), "1");
    } catch {
      /* Private mode: dismissed for this visit only. */
    }
    setDismissed(true);
  };
  async function apply() {
    const n = Number(delta);
    if (!factionId) return setProblem("Choose a faction.");
    if (!Number.isSafeInteger(n) || n === 0 || Math.abs(n) > MAX_RENOWN_DELTA) return setProblem("Choose a whole number other than 0.");
    const ids = target === "party" ? party.map((p) => p.id) : [target];
    if (!ids.length) return setProblem("Nobody is travelling with the party.");
    setProblem("");
    const ok = await command.send(
      {
        kind: "faction-renown",
        factionId,
        characters: ids.map((characterId) => ({ characterId, delta: n })),
        reason: `Quest: ${quest.title}`.slice(0, 200),
      } as CommandInput,
      "Renown changed.",
    );
    if (ok) dismiss();
  }
  return (
    <section className="quest-box" aria-label="Change renown for this quest" data-testid="quest-renown-offer">
      <strong className="text-sm">Change renown for this quest?</strong>
      <p className="quest-muted">This quest had no renown rewards. Adjust and apply a change, or dismiss it; nothing changes unless you apply.</p>
      <div className="faction-grid">
        <Field label="Faction">
          <Select aria-label="Offer faction" value={factionId} onChange={(e) => setFactionId(e.target.value)}>
            <option value="">Choose…</option>
            {live.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Renown change">
          <TextInput aria-label="Offer renown change" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} />
        </Field>
        <Field label="Who">
          <Select aria-label="Offer who" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="party">Whole party ({party.length})</option>
            {characters.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={command.busy} onClick={() => void apply()}>
          {command.busy ? "Applying…" : "Apply renown"}
        </Button>
        <Button variant="secondary" onClick={dismiss}>
          Dismiss
        </Button>
      </div>
      {problem && <p role="alert">{problem}</p>}
      <Status error={command.error} notice={command.notice} />
    </section>
  );
}

/** A player's view of the quest's renown rewards (already projected for their seat). */
export function PlayerQuestRenown({ quest, purseIds }: { quest: Quest; purseIds: readonly string[] }) {
  const { factions, table } = useFactionList();
  if (!quest.renownRewards?.length) return null;
  const names = new Map(table.purses.map((p) => [p.id, p.name]));
  const you = new Set(purseIds);
  return (
    <div className="grid gap-1" data-testid="player-quest-renown">
      <strong className="text-sm">Renown</strong>
      <ul className="grid gap-1 text-sm">
        {quest.renownRewards.map((r, i) => (
          <li key={i}>{rewardText(r, factions, names, you)}</li>
        ))}
      </ul>
      <small>{quest.renownAppliedAt !== undefined ? "Applied when the quest was completed." : "Applied when the quest is completed."}</small>
    </div>
  );
}

/** "Given by" a faction, when the projection kept it (visible factions only for players). */
export function QuestGiverFaction({ quest }: { quest: Quest }) {
  const { factions } = useFactionList();
  const name = quest.giverFactionId ? factions.find((f) => f.id === quest.giverFactionId)?.name : undefined;
  return name ? <p className="quest-muted" data-testid="quest-giver-faction">For {name}</p> : null;
}
