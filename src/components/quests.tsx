/**
 * Quest log screens (docs/QUESTS.md; mockups approved by the owner on 2026-10-25). "Quests" for
 * the DM and "Quest log" for players at /features/quests, the Desk card, the player Home card, the
 * NPC strip, the Here group and the "Quest updated" toast. Every change is one DM-only `quest-*`
 * command (or a player's private `journal-note`); nothing here moves coins or items.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";
import { Bell, EyeOff, Lock, Map as MapIcon, Pin, Plus, X } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { FantasyIcon } from "@/components/fantasy-icon";
import { Button, Field, Modal, Switch, TextArea, TextInput, Select } from "@/components/ui";
import { useEconomy, useCommandId } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { characterVisible } from "@/lib/quire/character-position";
import { questAudienceCharacters, questCharacter, questsOf } from "@/lib/quire/quests";
import { previewQuestAs } from "@/lib/quire/quest-preview";
import { emptyCloudTable } from "@/lib/quire/cloud";
import { MAX_QUEST_OBJECTIVES, type Quest, type QuestAudience, type QuestDraft } from "@/lib/quire/quests-schema";
import { readMarketLocations } from "@/lib/quire/shop-locations";
import { activeGroups, groupInfo, groupMembers, MAIN_GROUP, partySplit } from "@/lib/quire/party-groups";
import { formatCopper } from "@/lib/quire/money";
import {
  audienceLabel,
  giverName,
  nextObjective,
  npcQuests,
  objectiveProgress,
  placeName,
  questMapRecord,
  questStateKey,
  questsByTab,
  questUpdated,
  readQuestState,
  revealed,
  stampLabel,
  writeQuestState,
  noteOwner,
  type QuestTab,
} from "@/lib/quire/quest-view";
import type { CommandRequest } from "@/lib/quire/commands";
import type { CloudTable } from "@/lib/quire/cloud";
import { cn } from "@/lib/cn";
import { useRouter } from "@tanstack/react-router";
import { appLinkDestination } from "@/lib/quire/feature-navigation";

type Table = Pick<CloudTable, "purses" | "journal" | "ledger">;

function useQuestTable(): Table & { ready: boolean } {
  const economy = useEconomy();
  return useMemo(
    () => ({ purses: economy.purses, journal: economy.journal as Table["journal"], ledger: economy.ledger, ready: economy.ready }),
    [economy.purses, economy.journal, economy.ledger, economy.ready],
  );
}
/** Follow and Updated, per device (owner decision D4). */
function useQuestState() {
  const seat = useSeat();
  const key = questStateKey(seat);
  const subscribe = (fn: () => void) => {
    window.addEventListener("quire-quest-state", fn);
    window.addEventListener("storage", fn);
    return () => {
      window.removeEventListener("quire-quest-state", fn);
      window.removeEventListener("storage", fn);
    };
  };
  const snapshot = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(readQuestState(key)),
    () => '{"seen":{}}',
  );
  const state = JSON.parse(snapshot) as ReturnType<typeof readQuestState>;
  return {
    state,
    follow: (id: string | undefined) => {
      const next = { ...readQuestState(key) };
      if (id) next.follow = id;
      else delete next.follow;
      writeQuestState(key, next);
    },
    markSeen: (q: Quest) => {
      const current = readQuestState(key);
      if (current.seen[q.id] === q.updatedAt) return;
      writeQuestState(key, { ...current, seen: { ...current.seen, [q.id]: q.updatedAt } });
    },
  };
}
function useQuestCommand() {
  const { commandOutcome } = useEconomy();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    run: async (input: CommandRequest, ok: string) => {
      setBusy(true);
      try {
        const outcome = await commandOutcome(input);
        toast.success(outcome.status === "pending" ? `${ok} It is waiting to be sent.` : ok);
        return true;
      } catch (error) {
        toast.error(error instanceof Error && error.message ? error.message : "The quest could not be saved.");
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}
/** Client-side navigation (never a document reload, so the title screen never replays). */
function useGo() {
  const router = useRouter();
  return (href: string) => {
    const url = appLinkDestination(href, router.state.location.href);
    void router.navigate({ to: url.pathname as never, search: router.options.parseSearch!(url.search) as never, hash: url.hash.slice(1) });
  };
}
const questHref = (id?: string) => `/features/quests${id ? `?quest=${encodeURIComponent(id)}` : ""}`;
const mapHref = (record: string) => `/maps?record=${encodeURIComponent(record)}`;

function Chip({ children, tone = "plain", icon }: { children: ReactNode; tone?: "plain" | "main" | "new" | "hidden" | "done" | "failed"; icon?: ReactNode }) {
  return (
    <span className={`quest-chip ${tone}`}>
      {icon}
      {children}
    </span>
  );
}
function ObjectiveMark({ state, hidden }: { state: string; hidden?: boolean }) {
  return (
    <span
      className={cn("quest-mark", state, hidden && "hidden-objective")}
      aria-hidden="true"
    />
  );
}
const stateWord = (state: string) => (state === "done" ? "Done" : state === "failed" ? "Failed" : "Open");

// ---------------------------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------------------------

export function QuestsScreen({ initialQuest }: { initialQuest?: string }) {
  const seat = useSeat();
  return seat.role === "dm" ? <DmQuests initialQuest={initialQuest} /> : <PlayerQuestLog initialQuest={initialQuest} />;
}

function QuestRow({ q, t, selected, onOpen, updated, followed }: { q: Quest; t: Table; selected: boolean; onOpen: () => void; updated?: boolean; followed?: boolean }) {
  const seat = useSeat();
  const next = nextObjective(q);
  const where = placeName(t, next?.locationId ?? q.locationIds[0]);
  return (
    <li>
      <button type="button" className={cn("quest-row", selected && "selected")} aria-current={selected ? "true" : undefined} onClick={onOpen}>
        <FantasyIcon ui="scroll" size={30} className="quest-row-icon" />
        <span className="quest-row-body">
          <strong>{q.title}</strong>
          {next ? <span className="quest-row-next">{next.text}</span> : null}
          <span className="quest-chips">
            {q.main && <Chip tone="main">Main</Chip>}
            {updated && <Chip tone="new">Updated</Chip>}
            {followed && <Chip icon={<Pin size={12} aria-hidden="true" />}>Following</Chip>}
            {seat.role === "dm" || q.audience.kind === "characters" ? <Chip>{audienceLabel(t, q, seat)}</Chip> : null}
            {where && <Chip>{where}</Chip>}
          </span>
        </span>
        <span aria-hidden="true" className="quest-row-chevron">›</span>
      </button>
    </li>
  );
}

function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count: number }[] }) {
  return (
    <div className="quest-tabs" role="tablist" aria-label="Quest lists">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}>
          {o.label} <span>{o.count}</span>
        </button>
      ))}
    </div>
  );
}

// --- Player ---------------------------------------------------------------------------------

function PlayerQuestLog({ initialQuest }: { initialQuest?: string }) {
  const t = useQuestTable();
  const seat = useSeat();
  const { state, follow, markSeen } = useQuestState();
  const tabs = questsByTab(t);
  const [tab, setTab] = useState<"play" | "done" | "failed">("play");
  const [selected, setSelected] = useState(initialQuest ?? "");
  const all = questsOf(t);
  const quest = all.find((q) => q.id === selected);
  useEffect(() => {
    if (quest) markSeen(quest);
  }, [quest?.id, quest?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t.ready) return <p className="text-muted">Loading…</p>;
  const mine = t.purses.filter((p) => seat.purseIds.includes(p.id) && p.kind === "character");
  if (quest)
    return (
      <div className="quest-screen">
        <button type="button" className="quest-back" onClick={() => setSelected("")}>
          ← Quest log
        </button>
        <PlayerQuestDetail q={quest} t={t} updated={questUpdated(state, quest)} following={state.follow === quest.id} onFollow={() => follow(state.follow === quest.id ? undefined : quest.id)} />
      </div>
    );
  const followed = all.find((q) => q.id === state.follow && q.status === "active");
  const list = tabs[tab];
  return (
    <div className="quest-screen">
      <p className="eyebrow">{mine.map((p) => p.name).join(", ") || "Your character"}</p>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "play", label: "Active", count: tabs.play.length },
          { value: "done", label: "Done", count: tabs.done.length },
          { value: "failed", label: "Failed", count: tabs.failed.length },
        ]}
      />
      {tab === "play" && followed ? <FollowingCard q={followed} t={t} open={() => setSelected(followed.id)} /> : null}
      {list.length ? (
        <ul className="quest-list">
          {list.map((q) => (
            <QuestRow key={q.id} q={q} t={t} selected={false} onOpen={() => setSelected(q.id)} updated={questUpdated(state, q)} followed={state.follow === q.id} />
          ))}
        </ul>
      ) : (
        <p className="quest-empty">
          {tab === "play"
            ? "No quests yet. When your DM shares a quest with you, it appears here."
            : tab === "done"
              ? "No finished quests yet."
              : "No failed quests."}
        </p>
      )}
    </div>
  );
}

function FollowingCard({ q, t, open }: { q: Quest; t: Table; open: () => void }) {
  const visible = q.objectives.filter((o) => !o.hidden);
  const lastDone = [...visible].reverse().find((o) => o.state !== "open");
  const next = nextObjective(q);
  const record = questMapRecord(t, q);
  return (
    <section className="quest-following" aria-label={`Following: ${q.title}`}>
      <span className="quest-following-tag">Following</span>
      <p className="eyebrow">{q.main ? "Main quest" : "Quest"}</p>
      <h2>{q.title}</h2>
      <ul className="quest-objectives compact">
        {[lastDone, next].filter(Boolean).map((o) => (
          <li key={o!.id} className={o!.state}>
            <ObjectiveMark state={o!.state} />
            <span>
              <span className="quest-objective-text">{o!.text}</span>
              {o!.locationId && <small>{placeName(t, o!.locationId)}</small>}
            </span>
          </li>
        ))}
      </ul>
      <div className="quest-actions">
        {record && (
          <AppLink className="quick-action" href={mapHref(record)}>
            <MapIcon size={16} aria-hidden="true" /> Show on map
          </AppLink>
        )}
        <button type="button" className="quest-link" onClick={open}>
          Open quest →
        </button>
      </div>
    </section>
  );
}

function PlayerQuestDetail({ q, t, updated, following, onFollow }: { q: Quest; t: Table; updated: boolean; following: boolean; onFollow: () => void }) {
  const seat = useSeat();
  const giver = giverName(t, q);
  const giverNpc = t.journal?.world?.npcs.find((n) => n.id === q.giverNpcId);
  const progress = objectiveProgress(q);
  const record = questMapRecord(t, q);
  const seenBefore = useRef(readQuestState(questStateKey(seat)).seen[q.id]);
  return (
    <article className="quest-detail">
      <div className="quest-chips">
        <Chip tone={q.status === "completed" ? "done" : q.status === "failed" ? "failed" : "plain"}>
          {q.status === "active" ? "Active" : q.status === "completed" ? "Done" : "Failed"}
        </Chip>
        {q.main && <Chip tone="main">Main</Chip>}
        {updated && <Chip tone="new">Updated</Chip>}
        {q.audience.kind === "characters" && <Chip>{audienceLabel(t, q, seat)}</Chip>}
      </div>
      <h2 className="quest-title">{q.title}</h2>
      {giver && (
        <div className="quest-giver">
          <span>
            <strong>{giver}</strong>
            {giverNpc && <small>{placeName(t, giverNpc.locationId)}</small>}
          </span>
          <AppLink className="quick-action" href={`/features/npcs?npc=${encodeURIComponent(q.giverNpcId!)}`}>
            Talk
          </AppLink>
        </div>
      )}
      {q.summary && <p className="quest-summary">{q.summary}</p>}
      <div className="quest-actions">
        {q.status === "active" && (
          <Button variant={following ? "secondary" : "primary"} aria-pressed={following} onClick={onFollow}>
            <Pin size={16} aria-hidden="true" /> {following ? "Following" : "Follow this quest"}
          </Button>
        )}
        {record && (
          <AppLink className="quick-action" href={mapHref(record)}>
            <MapIcon size={16} aria-hidden="true" /> Show on map
          </AppLink>
        )}
      </div>
      <section aria-label="Objectives">
        <h3 className="quest-heading">
          Objectives
          {progress.total ? <small>{progress.done} of {progress.total} done</small> : null}
        </h3>
        <ul className="quest-objectives">
          {q.objectives.map((o) => {
            const fresh = seenBefore.current !== undefined && (o.changedAt ?? 0) > seenBefore.current && o.state === "open";
            return (
              <li key={o.id} className={cn(o.state, fresh && "fresh")}>
                <ObjectiveMark state={o.state} />
                <span>
                  <span className="quest-objective-text">{o.text}</span>
                  <small>
                    {fresh && <Chip tone="new">New</Chip>}
                    {o.optional && "Optional · "}
                    {o.state !== "open" ? `${stateWord(o.state)}${o.sessionId ? ` · ${stampLabel(t, { sessionId: o.sessionId })}` : ""}` : ""}
                    {o.locationId ? ` ${placeName(t, o.locationId)}` : ""}
                  </small>
                </span>
              </li>
            );
          })}
          {!q.objectives.length && <li className="quest-empty">No objectives yet.</li>}
        </ul>
      </section>
      {(q.rewardText || q.rewardLinks.length > 0) && (
        <section className="quest-reward" aria-label="Reward">
          <strong>Reward promised</strong>
          {q.rewardText && <p>{q.rewardText}</p>}
          {q.rewardLinks.map((l) => (
            <Chip key={`${l.kind}:${l.id}`} tone="done">
              Linked: {l.label ?? "Receipt"}
            </Chip>
          ))}
          <small>Your DM pays rewards when the quest is done.</small>
        </section>
      )}
      <Chronicle q={q} t={t} />
      <MyNotes q={q} />
    </article>
  );
}

function Chronicle({ q, t, dm = false, heading = true }: { q: Quest; t: Table; dm?: boolean; heading?: boolean }) {
  const lines = [...q.log].reverse();
  return (
    <section aria-label="Chronicle">
      {heading && <h3 className="quest-heading">Chronicle</h3>}
      {lines.length ? (
        <ol className="quest-chronicle">
          {lines.map((l) => (
            <li key={l.id} className={l.shared ? "" : "dm-only"}>
              <small>
                {stampLabel(t, l)}
                {dm ? (l.shared ? " · shared with players" : " · DM only") : ""}
              </small>
              <p>{l.text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="quest-empty">Nothing written yet.</p>
      )}
    </section>
  );
}

/** Private journal entries linked to the quest (owner decision D5). */
function MyNotes({ q }: { q: Quest }) {
  const { journal, purses: economyPurses } = useEconomy();
  const seat = useSeat();
  const { busy, run } = useQuestCommand();
  const [text, setText] = useState("");
  const { commandId, renew } = useCommandId(`${q.id}:${text}`);
  // The note belongs to one of this seat's characters who know the quest.
  const own = noteOwner(q, seat.purseIds, economyPurses);
  const notes = (journal.entries ?? []).filter((e) => e.questId === q.id && e.visibility === "player");
  if (!own) return null;
  return (
    <section aria-label="My notes">
      <h3 className="quest-heading">
        My notes <small>Private · only you see these</small>
      </h3>
      {notes.map((n) => (
        <p key={n.id} className="quest-note">
          {n.text}
        </p>
      ))}
      <Field label="Add a private note">
        <TextArea value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Button
        className="mt-2"
        variant="secondary"
        disabled={busy || !text.trim()}
        onClick={async () => {
          const ok = await run(
            { id: commandId, kind: "journal-note", title: `Notes · ${q.title}`.slice(0, 100), text: text.trim(), visibility: "player", purseId: own, reportIds: [], questId: q.id },
            "Note saved. Only you can read it.",
          );
          if (ok) {
            setText("");
            renew();
          }
        }}
      >
        Save note
      </Button>
    </section>
  );
}

// --- DM -------------------------------------------------------------------------------------

function DmQuests({ initialQuest }: { initialQuest?: string }) {
  const t = useQuestTable();
  const tabs = questsByTab(t);
  const all = questsOf(t);
  const initial = all.find((q) => q.id === initialQuest);
  const [tab, setTab] = useState<QuestTab>(initial ? questTabOf(initial) : "play");
  // `?quest=new` (the command palette's New quest) opens the editor for a new draft.
  const [selected, setSelected] = useState<string>(initialQuest === "new" ? "" : (initialQuest ?? ""));
  const [creating, setCreating] = useState(initialQuest === "new");
  const [query, setQuery] = useState("");
  const quest = all.find((q) => q.id === selected);
  const questTabNow = quest ? questTabOf(quest) : undefined;
  useEffect(() => {
    if (questTabNow) setTab(questTabNow);
  }, [questTabNow]);
  if (!t.ready) return <p className="text-muted">Loading…</p>;
  const shown = tabs[tab].filter((q) =>
    `${q.title} ${giverName(t, q) ?? ""} ${q.locationIds.map((id) => placeName(t, id)).join(" ")}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const detail = creating ? (
    <QuestEditor
      key="new"
      t={t}
      onSaved={(id) => {
        setCreating(false);
        setSelected(id);
        setTab("drafts");
      }}
      onCancel={() => setCreating(false)}
    />
  ) : quest ? (
    <QuestEditor key={quest.id} t={t} quest={quest} onSaved={() => undefined} onDeleted={() => setSelected("")} />
  ) : null;
  return (
    <div className={cn("quest-screen dm", (detail ? "has-detail" : ""))}>
      <div className="quest-toolbar">
        <Button onClick={() => { setCreating(true); setSelected(""); }}>
          <Plus size={16} aria-hidden="true" /> New quest
        </Button>
      </div>
      <div className="quest-columns">
        <div className={cn("quest-list-column", detail && "quest-hide-phone")}>
          <label className="block">
            <span className="sr-only">Search quests, givers, places</span>
            <TextInput placeholder="Search quests, givers, places" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { value: "play", label: "In play", count: tabs.play.length },
              { value: "drafts", label: "Drafts", count: tabs.drafts.length },
              { value: "done", label: "Done", count: tabs.done.length },
              { value: "failed", label: "Failed", count: tabs.failed.length },
              { value: "archived", label: "Archived", count: tabs.archived.length },
            ]}
          />
          {shown.length ? (
            <ul className="quest-list">
              {shown.map((q) => (
                <QuestRow key={q.id} q={q} t={t} selected={q.id === selected && !creating} onOpen={() => { setCreating(false); setSelected(q.id); }} />
              ))}
            </ul>
          ) : (
            <p className="quest-empty">
              {tab === "drafts"
                ? "No drafts. New quests start here, visible only to you."
                : tab === "play"
                  ? "No quests in play. Write one with New quest, then choose who knows about it."
                  : "Nothing here."}
            </p>
          )}
          <p className="quest-hint">Players see only quests you reveal to them. DM notes and hidden objectives are never sent.</p>
        </div>
        {detail && (
          <div className="quest-detail-column">
            <button type="button" className="quest-back quest-phone-only" onClick={() => { setCreating(false); setSelected(""); }}>
              ← Quests
            </button>
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}
const questTabOf = (q: Quest): QuestTab => (q.archived ? "archived" : q.status === "completed" ? "done" : q.status === "failed" ? "failed" : revealed(q) ? "play" : "drafts");

const emptyDraft = (): QuestDraft => ({ title: "", summary: "", locationIds: [], markers: [], areas: [], objectives: [] });
function draftOf(q: Quest): QuestDraft {
  return {
    title: q.title,
    ...(q.main ? { main: true } : {}),
    summary: q.summary,
    ...(q.giverNpcId ? { giverNpcId: q.giverNpcId } : {}),
    locationIds: q.locationIds,
    markers: q.markers.map((m) => ({ mapId: m.mapId, markerId: m.markerId })),
    areas: q.areas.map((a) => ({ id: a.id, mapId: a.mapId, x: a.x, y: a.y, r: a.r, ...(a.label ? { label: a.label } : {}), ...(a.objectiveId ? { objectiveId: a.objectiveId } : {}) })),
    objectives: q.objectives.map((o) => ({
      id: o.id,
      text: o.text,
      ...(o.hidden ? { hidden: true } : {}),
      ...(o.optional ? { optional: true } : {}),
      ...(o.locationId ? { locationId: o.locationId } : {}),
      ...(o.marker ? { marker: { mapId: o.marker.mapId, markerId: o.marker.markerId } } : {}),
    })),
    ...(q.rewardText ? { rewardText: q.rewardText } : {}),
    ...(q.dmNotes ? { dmNotes: q.dmNotes } : {}),
  };
}

function QuestEditor({ t, quest, onSaved, onCancel, onDeleted, giverNpcId }: { t: Table; quest?: Quest; onSaved: (id: string) => void; onCancel?: () => void; onDeleted?: () => void; giverNpcId?: string }) {
  const seat = useSeat();
  const [draft, setDraft] = useState<QuestDraft>(() => (quest ? draftOf(quest) : { ...emptyDraft(), ...(giverNpcId ? { giverNpcId } : {}) }));
  const [sheet, setSheet] = useState<"" | "reveal" | "close" | "receipt" | "entry" | "preview" | "delete">("");
  const { busy, run } = useQuestCommand();
  const saveKey = JSON.stringify({ draft, revision: quest?.revision ?? null });
  const { commandId: saveId, renew } = useCommandId(saveKey);
  const npcs = t.journal?.world?.npcs ?? [];
  const market = readMarketLocations(t.journal?.market);
  const dirty = !quest || JSON.stringify(draftOf(quest)) !== JSON.stringify(draft);
  // A newer revision from another device: adopt it unless this form has unsaved edits.
  const lastRevision = useRef(quest?.revision);
  useEffect(() => {
    if (quest && quest.revision !== lastRevision.current) {
      lastRevision.current = quest.revision;
      if (!dirty) setDraft(draftOf(quest));
    }
  }, [quest?.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<QuestDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setObjective = (id: string, patch: Partial<QuestDraft["objectives"][number]>) =>
    set({ objectives: draft.objectives.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  const save = async () => {
    const ok = await run(
      { id: saveId, kind: "quest-save", questId: quest?.id ?? null, revision: quest?.revision ?? null, quest: draft },
      quest ? (revealed(quest) ? "Quest saved. Players who know it see the change." : "Draft saved.") : "Quest drafted. Only you can see it.",
    );
    if (ok) {
      renew();
      onSaved(quest?.id ?? saveId);
    }
    return ok;
  };
  const state = (id: string) => quest?.objectives.find((o) => o.id === id);
  const locationOptions = market.locations.map((l) => ({ id: l.id, label: placeName(t, l.id) }));
  return (
    <article className="quest-editor" aria-label={quest ? `Edit ${quest.title}` : "New quest"}>
      <header className="quest-editor-header">
        <h2 className="quest-title">{quest ? quest.title : "New quest"}</h2>
        {quest && (
          <div className="quest-chips">
            {quest.main && <Chip tone="main">Main</Chip>}
            <Chip>{audienceLabel(t, quest, seat)}</Chip>
            <Chip>{quest.archived ? "Archived" : quest.status === "active" ? (revealed(quest) ? "In play" : "Draft") : stateWord(quest.status === "completed" ? "done" : "failed")}</Chip>
          </div>
        )}
        {quest && (
          <div className="quest-actions">
            <Button variant="secondary" onClick={() => setSheet("preview")}>View as player</Button>
            <Button variant="secondary" onClick={() => setSheet("reveal")}>{revealed(quest) ? "Who knows…" : "Reveal…"}</Button>
            <Button variant="secondary" onClick={() => setSheet("close")}>{quest.status === "active" ? "Close quest…" : "Reopen…"}</Button>
          </div>
        )}
      </header>
      <div className="quest-editor-grid">
        <div>
          <Field label="Quest name">
            <TextInput value={draft.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Switch checked={!!draft.main} onChange={(main) => set({ main: main || undefined })} label="Main quest" hint="Listed first for everyone who can see it." />
          <Field label="Given by">
            <Select value={draft.giverNpcId ?? ""} onChange={(e) => set({ giverNpcId: e.target.value || undefined })}>
              <option value="">Nobody in particular</option>
              {npcs.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                  {n.visible ? "" : " (hidden from players)"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Where" hint="Players see this place only if they can see the quest.">
            <Select
              value={draft.locationIds[0] ?? ""}
              onChange={(e) => set({ locationIds: e.target.value ? [e.target.value, ...draft.locationIds.slice(1).filter((id) => id !== e.target.value)] : draft.locationIds.slice(1) })}
            >
              <option value="">No place</option>
              {locationOptions.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="What the players read">
            <TextArea value={draft.summary} maxLength={2000} onChange={(e) => set({ summary: e.target.value })} />
          </Field>
          <section aria-label="Objectives">
            <h3 className="quest-heading">
              Objectives
              <button
                type="button"
                className="quest-link"
                disabled={draft.objectives.length >= MAX_QUEST_OBJECTIVES}
                onClick={() => set({ objectives: [...draft.objectives, { id: crypto.randomUUID(), text: "" }] })}
              >
                <Plus size={14} aria-hidden="true" /> Add objective
              </button>
            </h3>
            <ul className="quest-objectives editing">
              {draft.objectives.map((o, index) => {
                const stored = state(o.id);
                const known = !!quest && revealed(quest) && !!stored && !stored.hidden;
                return (
                  <li key={o.id} className={stored?.state ?? "open"}>
                    <ObjectiveMark state={stored?.state ?? "open"} hidden={o.hidden} />
                    <div className="quest-objective-edit">
                      <TextInput aria-label={`Objective ${index + 1}`} value={o.text} maxLength={200} onChange={(e) => setObjective(o.id, { text: e.target.value })} />
                      <div className="quest-objective-options">
                        <label>
                          <input type="checkbox" checked={!!o.hidden} onChange={(e) => setObjective(o.id, { hidden: e.target.checked || undefined })} /> Hidden from players
                        </label>
                        <label>
                          <input type="checkbox" checked={!!o.optional} onChange={(e) => setObjective(o.id, { optional: e.target.checked || undefined })} /> Optional
                        </label>
                        <select aria-label={`Place for objective ${index + 1}`} value={o.locationId ?? ""} onChange={(e) => setObjective(o.id, { locationId: e.target.value || undefined })}>
                          <option value="">No place</option>
                          {locationOptions.map((l) => (
                            <option key={l.id} value={l.id}>{l.label}</option>
                          ))}
                        </select>
                        {!known && (
                          <button type="button" className="quest-link" onClick={() => set({ objectives: draft.objectives.filter((x) => x.id !== o.id), areas: draft.areas.filter((a) => a.objectiveId !== o.id) })}>
                            Remove
                          </button>
                        )}
                      </div>
                      {o.hidden && <Chip tone="hidden" icon={<EyeOff size={12} aria-hidden="true" />}>Hidden from players</Chip>}
                      {stored && quest && !dirty && <ObjectiveActions quest={quest} id={o.id} />}
                      {stored && stored.state !== "open" && (
                        <small className="quest-muted">{stateWord(stored.state)}{stored.sessionId ? ` · ${stampLabel(t, { sessionId: stored.sessionId })}` : ""}</small>
                      )}
                    </div>
                  </li>
                );
              })}
              {!draft.objectives.length && <li className="quest-empty">No objectives yet.</li>}
            </ul>
            {quest && dirty && draft.objectives.some((o) => state(o.id)) && <p className="quest-muted">Save your edits to mark objectives done or failed.</p>}
          </section>
        </div>
        <div>
          <section className="quest-box" aria-label="Reward">
            <Field label="Promised reward (players read this)">
              <TextInput value={draft.rewardText ?? ""} maxLength={300} onChange={(e) => set({ rewardText: e.target.value || undefined })} />
            </Field>
            <p className="quest-muted">
              Writing a reward moves no money. Pay it with Encounters → Loot & rewards or{" "}
              <AppLink href="/party?action=add">Add loot</AppLink>, then link the receipt here.
            </p>
            {quest && (
              <>
                {quest.rewardLinks.map((l) => (
                  <span key={`${l.kind}:${l.id}`} className="quest-linked">
                    <Chip tone="done">Linked: {l.label ?? l.id}</Chip>
                    <RemoveLink quest={quest} link={l} />
                  </span>
                ))}
                <Button variant="secondary" onClick={() => setSheet("receipt")}>Link a receipt</Button>
              </>
            )}
          </section>
          <section className="quest-box dm-notes">
            <p className="quest-lock">
              <Lock size={14} aria-hidden="true" /> DM notes · never sent to players
            </p>
            <TextArea aria-label="DM notes" value={draft.dmNotes ?? ""} maxLength={4000} onChange={(e) => set({ dmNotes: e.target.value || undefined })} />
          </section>
          {quest && (
            <>
              <h3 className="quest-heading">
                <span>Chronicle</span>
                <button type="button" className="quest-link" onClick={() => setSheet("entry")}>
                  <Plus size={14} aria-hidden="true" /> Add entry
                </button>
              </h3>
              <Chronicle q={quest} t={t} dm heading={false} />
            </>
          )}
        </div>
      </div>
      <footer className="quest-editor-footer">
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
        {quest && !revealed(quest) && quest.revealedAt === undefined && (
          <Button variant="ghost" onClick={() => setSheet("delete")}>Delete draft</Button>
        )}
        {quest && quest.revealedAt !== undefined && <ArchiveButton quest={quest} />}
        <Button variant="secondary" disabled={busy || !dirty || !draft.title.trim()} onClick={() => void save()}>
          {quest ? "Save" : "Save draft"}
        </Button>
        {quest && (
          <Button
            disabled={busy || !draft.title.trim()}
            onClick={async () => {
              if (dirty && !(await save())) return;
              setSheet("reveal");
            }}
          >
            <Bell size={16} aria-hidden="true" /> {revealed(quest) ? "Save & tell players…" : "Save & reveal…"}
          </Button>
        )}
      </footer>
      {quest && sheet === "reveal" && <RevealSheet t={t} quest={quest} close={() => setSheet("")} />}
      {quest && sheet === "close" && <CloseSheet quest={quest} close={() => setSheet("")} />}
      {quest && sheet === "receipt" && <ReceiptSheet t={t} quest={quest} close={() => setSheet("")} />}
      {quest && sheet === "entry" && <EntrySheet quest={quest} close={() => setSheet("")} />}
      {quest && sheet === "preview" && (
        <Modal open onOpenChange={(o) => !o && setSheet("")} title="What players see">
          <PlayerPreview quest={quest} />
        </Modal>
      )}
      {quest && sheet === "delete" && <DeleteDraft quest={quest} close={() => setSheet("")} onDeleted={onDeleted} />}
    </article>
  );
}

function ObjectiveActions({ quest, id }: { quest: Quest; id: string }) {
  const { busy, run } = useQuestCommand();
  const o = quest.objectives.find((x) => x.id === id)!;
  const act = (action: "open" | "done" | "failed" | "reveal" | "hide", ok: string) =>
    run({ id: `${quest.id}:${id}:${action}:${quest.revision}`, kind: "quest-objective", questId: quest.id, revision: quest.revision, objectiveId: id, action }, ok);
  return (
    <div className="quest-objective-actions">
      {o.state !== "done" && <button type="button" className="quest-link" disabled={busy} onClick={() => void act("done", "Objective done.")}>Mark done</button>}
      {o.state !== "failed" && <button type="button" className="quest-link" disabled={busy} onClick={() => void act("failed", "Objective failed.")}>Mark failed</button>}
      {o.state !== "open" && <button type="button" className="quest-link" disabled={busy} onClick={() => void act("open", "Objective reopened.")}>Reopen</button>}
      {o.hidden && revealed(quest) && <button type="button" className="quest-link" disabled={busy} onClick={() => void act("reveal", "Objective revealed to the players who know this quest.")}>Reveal</button>}
    </div>
  );
}
function RemoveLink({ quest, link }: { quest: Quest; link: Quest["rewardLinks"][number] }) {
  const { busy, run } = useQuestCommand();
  return (
    <button
      type="button"
      className="map-icon-button"
      aria-label={`Unlink ${link.label ?? "receipt"}`}
      disabled={busy}
      onClick={() => void run({ id: `${quest.id}:unlink:${link.id}:${quest.revision}`, kind: "quest-link-reward", questId: quest.id, revision: quest.revision, link: { kind: link.kind, id: link.id }, remove: true }, "Receipt unlinked. Nothing was paid or refunded.")}
    >
      <X size={14} />
    </button>
  );
}
function ArchiveButton({ quest }: { quest: Quest }) {
  const { busy, run } = useQuestCommand();
  return (
    <Button
      variant="ghost"
      disabled={busy}
      onClick={() => void run({ id: `${quest.id}:archive:${quest.revision}`, kind: "quest-archive", questId: quest.id, revision: quest.revision, archived: !quest.archived }, quest.archived ? "Quest restored." : "Quest archived. It is kept in your records.")}
    >
      {quest.archived ? "Restore from archive" : "Archive"}
    </Button>
  );
}
function DeleteDraft({ quest, close, onDeleted }: { quest: Quest; close: () => void; onDeleted?: () => void }) {
  const { busy, run } = useQuestCommand();
  return (
    <Modal open onOpenChange={(o) => !o && close()} title="Delete this draft?">
      <p>Nobody has seen “{quest.title}”. Deleting it removes the draft for good.</p>
      <div className="quest-sheet-footer">
        <Button variant="secondary" onClick={close}>Keep it</Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            if (await run({ id: `${quest.id}:delete:${quest.revision}`, kind: "quest-delete", questId: quest.id, revision: quest.revision }, "Draft deleted.")) {
              close();
              onDeleted?.();
            }
          }}
        >
          Delete draft
        </Button>
      </div>
    </Modal>
  );
}

function RevealSheet({ t, quest, close }: { t: Table; quest: Quest; close: () => void }) {
  const characters = t.purses.filter((p) => questCharacter(t, p) && characterVisible(t, p));
  const [kind, setKind] = useState<QuestAudience["kind"]>(quest.audience.kind === "none" ? "party" : quest.audience.kind);
  const [picked, setPicked] = useState<string[]>(quest.audience.kind === "characters" ? quest.audience.purseIds : []);
  const firstReveal = !revealed(quest);
  const [message, setMessage] = useState(firstReveal);
  const { busy, run } = useQuestCommand();
  const audience: QuestAudience = kind === "characters" ? { kind, purseIds: picked } : { kind };
  const { commandId } = useCommandId(JSON.stringify({ audience, message, revision: quest.revision }));
  const groups = partySplit(t) ? [MAIN_GROUP, ...activeGroups(t).map((g) => g.id)] : [];
  const names = picked.map((id) => t.purses.find((p) => p.id === id)?.name ?? "").filter(Boolean);
  const hidden = quest.objectives.filter((o) => o.hidden).length;
  const giver = giverName(t, quest);
  const label =
    kind === "none" ? "Keep as a draft" : kind === "party" ? "Reveal to the party" : `Reveal to ${picked.length} character${picked.length === 1 ? "" : "s"}`;
  return (
    <Modal open onOpenChange={(o) => !o && close()} title="Who knows about it?">
      <p className="quest-muted">Only the people you choose see this quest, its open objectives and shared chronicle entries.</p>
      <div className="quest-radios" role="radiogroup" aria-label="Who knows about it">
        {(
          [
            ["none", "Nobody yet", firstReveal ? "Keep it as a draft." : "Hide it again. What they read stays in their memory, not in the app."],
            ["party", "The whole party", "Every party character, and anyone who joins later."],
            ["characters", "Chosen characters", groups.length ? "Pick a group to tick its members." : "Pick who knows."],
          ] as const
        ).map(([value, title, hint]) => (
          <label key={value} className={cn("quest-radio", kind === value && "selected")}>
            <input type="radio" name="quest-audience" checked={kind === value} onChange={() => setKind(value)} />
            <span>
              <strong>{title}</strong>
              <small>{hint}</small>
            </span>
          </label>
        ))}
      </div>
      {kind === "characters" && (
        <div className="quest-pick">
          {groups.length > 0 && (
            <div className="quest-chips" role="group" aria-label="Groups">
              {groups.map((ref) => {
                const info = groupInfo(t, ref);
                const members = groupMembers(t as CloudTable, ref).filter((p) => characters.some((c) => c.id === p.id)).map((p) => p.id);
                return (
                  <button key={ref} type="button" className="quest-chip" onClick={() => setPicked([...new Set([...picked, ...members])])}>
                    {info.letter} · {info.name}
                  </button>
                );
              })}
            </div>
          )}
          <div className="quest-checks">
            {characters.map((p) => (
              <label key={p.id}>
                <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((id) => id !== p.id))} />
                {p.name}
              </label>
            ))}
          </div>
        </div>
      )}
      {kind !== "none" && (
        <div className="quest-preview">
          <p className="eyebrow">{kind === "party" ? "The party will see" : names.length ? `${names.join(" and ")} will see` : "Choose who will see it"}</p>
          <strong>{quest.title}</strong>
          <p className="quest-muted">
            {quest.objectives.filter((o) => !o.hidden).length} objectives · reward: {quest.rewardText ? quest.rewardText : "none promised"}
            {giver ? ` · given by ${giver}` : ""}. Your DM notes{hidden ? ` and ${hidden} hidden objective${hidden === 1 ? "" : "s"}` : ""} stay with you.
          </p>
        </div>
      )}
      {kind !== "none" && (
        <label className="quest-message">
          <input type="checkbox" checked={message} onChange={(e) => setMessage(e.target.checked)} />
          Also send {kind === "party" ? "each of them" : "them"} a private message: “New quest: {quest.title}”
        </label>
      )}
      <div className="quest-sheet-footer">
        <Button variant="secondary" onClick={close}>Cancel</Button>
        <Button
          disabled={busy || (kind === "characters" && !picked.length) || (kind === "none" && !revealed(quest))}
          onClick={async () => {
            if (
              await run(
                { id: commandId, kind: "quest-reveal", questId: quest.id, revision: quest.revision, audience, ...(kind !== "none" && message ? { message: true, text: `New quest: ${quest.title}`.slice(0, 1000) } : {}) },
                kind === "none" ? "Hidden from players again." : "Revealed. They see it in their quest log.",
              )
            )
              close();
          }}
        >
          {label}
        </Button>
      </div>
    </Modal>
  );
}

function CloseSheet({ quest, close }: { quest: Quest; close: () => void }) {
  const reopening = quest.status !== "active";
  const [status, setStatus] = useState<"completed" | "failed">("completed");
  const [text, setText] = useState("");
  const [message, setMessage] = useState(false);
  const { busy, run } = useQuestCommand();
  const target = reopening ? "active" : status;
  const { commandId } = useCommandId(JSON.stringify({ target, text, message, revision: quest.revision }));
  return (
    <Modal open onOpenChange={(o) => !o && close()} title={reopening ? "Reopen this quest?" : "Close this quest"}>
      {!reopening && (
        <div className="quest-radios" role="radiogroup" aria-label="Outcome">
          {(["completed", "failed"] as const).map((s) => (
            <label key={s} className={cn("quest-radio", status === s && "selected")}>
              <input type="radio" name="quest-close" checked={status === s} onChange={() => setStatus(s)} />
              <span>
                <strong>{s === "completed" ? "Completed" : "Failed"}</strong>
                <small>{s === "completed" ? "Moves to Done for everyone who knows it." : "Moves to Failed. Players still see what happened."}</small>
              </span>
            </label>
          ))}
        </div>
      )}
      <Field label={reopening ? "Why it reopens (shared with players)" : "Closing entry (shared with players)"}>
        <TextArea value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
      </Field>
      {revealed(quest) && (
        <label className="quest-message">
          <input type="checkbox" checked={message} onChange={(e) => setMessage(e.target.checked)} /> Also message the players who know it
        </label>
      )}
      {!reopening && (
        <p className="quest-muted">
          Closing pays nothing. Pay the reward with <AppLink href="/party?action=add">Add loot</AppLink> or an encounter award, then link the receipt.
        </p>
      )}
      <div className="quest-sheet-footer">
        <Button variant="secondary" onClick={close}>Cancel</Button>
        <Button
          disabled={busy}
          onClick={async () => {
            if (await run({ id: commandId, kind: "quest-close", questId: quest.id, revision: quest.revision, status: target, ...(text.trim() ? { text: text.trim() } : {}), ...(message ? { message: true } : {}) }, reopening ? "Quest reopened." : status === "completed" ? "Quest completed." : "Quest marked failed."))
              close();
          }}
        >
          {reopening ? "Reopen quest" : status === "completed" ? "Mark completed" : "Mark failed"}
        </Button>
      </div>
    </Modal>
  );
}

function EntrySheet({ quest, close }: { quest: Quest; close: () => void }) {
  const [text, setText] = useState("");
  const [shared, setShared] = useState(revealed(quest));
  const [message, setMessage] = useState(false);
  const { busy, run } = useQuestCommand();
  const { commandId } = useCommandId(JSON.stringify({ text, shared, message, revision: quest.revision }));
  return (
    <Modal open onOpenChange={(o) => !o && close()} title="Add a chronicle entry">
      <Field label="Entry">
        <TextArea value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Switch checked={shared} onChange={setShared} label="Shared with players" hint={shared ? "Players who know the quest read it." : "A DM-only line; never sent to players."} />
      {shared && revealed(quest) && (
        <label className="quest-message">
          <input type="checkbox" checked={message} onChange={(e) => setMessage(e.target.checked)} /> Also message them
        </label>
      )}
      <p className="quest-muted">Stamped with the current session and campaign day.</p>
      <div className="quest-sheet-footer">
        <Button variant="secondary" onClick={close}>Cancel</Button>
        <Button
          disabled={busy || !text.trim()}
          onClick={async () => {
            if (await run({ id: commandId, kind: "quest-log", questId: quest.id, revision: quest.revision, text: text.trim(), shared, ...(message ? { message: true } : {}) }, shared ? "Entry added." : "DM note added."))
              close();
          }}
        >
          Add entry
        </Button>
      </div>
    </Modal>
  );
}

/** Receipts that already exist: encounter awards, ledger lines and treasure-pool resolutions. */
function ReceiptSheet({ t, quest, close }: { t: Table; quest: Quest; close: () => void }) {
  const { busy, run } = useQuestCommand();
  const linked = new Set(quest.rewardLinks.map((l) => `${l.kind}:${l.id}`));
  const awards = new Map<string, { id: string; label: string; at: number }>();
  for (const l of t.ledger ?? [])
    if (l.award?.receiptId && !awards.has(l.award.receiptId))
      awards.set(l.award.receiptId, { id: l.award.receiptId, label: l.summary.replace(/:.*$/, ""), at: l.at });
  const options = [
    ...[...awards.values()].map((a) => ({ kind: "encounter-award" as const, id: a.id, label: `Encounter award · ${a.label}`, at: a.at })),
    ...(t.journal?.events ?? []).filter((e) => e.lootResolution).map((e) => ({ kind: "loot-resolution" as const, id: e.lootResolution!.id, label: `Treasure pool · ${e.summary}`, at: e.at })),
    ...(t.ledger ?? []).filter((l) => !l.award).map((l) => ({ kind: "ledger" as const, id: l.id, label: `${t.purses.find((p) => p.id === l.purseId)?.name ?? "Account"} · ${l.summary} · ${formatCopper(l.copper)}`, at: l.at })),
  ]
    .filter((o) => !linked.has(`${o.kind}:${o.id}`))
    .sort((a, b) => b.at - a.at)
    .slice(0, 60);
  return (
    <Modal open onOpenChange={(o) => !o && close()} title="Link a receipt">
      <p className="quest-muted">Linking shows players what was paid. It never pays, moves or refunds anything.</p>
      {options.length ? (
        <ul className="quest-receipts">
          {options.map((o) => (
            <li key={`${o.kind}:${o.id}`}>
              <span>{o.label}</span>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  if (await run({ id: `${quest.id}:link:${o.kind}:${o.id}`, kind: "quest-link-reward", questId: quest.id, revision: quest.revision, link: { kind: o.kind, id: o.id } }, "Receipt linked."))
                    close();
                }}
              >
                Link
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No receipts this session yet. Pay the reward first, then link it here.</p>
      )}
    </Modal>
  );
}

/**
 * "View as player": the real player projection for one character (quest-preview.ts), so the DM
 * sees exactly what that device receives. A draft is shown as if revealed to the party.
 */
function PlayerPreview({ quest }: { quest: Quest }) {
  const economy = useEconomy();
  const full = useMemo(
    () =>
      ({
        ...emptyCloudTable(),
        purses: economy.purses,
        holdings: economy.holdings,
        shops: economy.shops,
        ledger: economy.ledger,
        journal: economy.journal,
      }) as CloudTable,
    [economy.purses, economy.holdings, economy.shops, economy.ledger, economy.journal],
  );
  const viewers = questAudienceCharacters(full, quest);
  const [viewer, setViewer] = useState(viewers[0]?.id ?? "");
  const current = viewers.some((p) => p.id === viewer) ? viewer : (viewers[0]?.id ?? "");
  const preview = useMemo(() => (current ? previewQuestAs(full, quest.id, current) : null), [full, quest.id, current]);
  if (!viewers.length) return <p className="quest-muted">No player character can see this quest yet.</p>;
  const q = preview?.quest;
  const t = preview?.table;
  return (
    <div className="quest-detail preview">
      {!revealed(quest) && <p className="quest-muted">Nobody can see this draft yet. Shown as if you revealed it to the party.</p>}
      {viewers.length > 1 && (
        <Field label="See it as">
          <Select value={current} onChange={(e) => setViewer(e.target.value)}>
            {viewers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
      )}
      {!q || !t ? (
        <p className="quest-muted">This character cannot see the quest.</p>
      ) : (
        <>
          <h2 className="quest-title">{q.title}</h2>
          {giverName(t, q) && <p><strong>{giverName(t, q)}</strong></p>}
          {q.summary && <p className="quest-summary">{q.summary}</p>}
          <ul className="quest-objectives">
            {q.objectives.map((o) => (
              <li key={o.id} className={o.state}>
                <ObjectiveMark state={o.state} />
                <span>
                  <span className="quest-objective-text">{o.text}</span>
                  {o.locationId && <small>{placeName(t, o.locationId)}</small>}
                </span>
              </li>
            ))}
          </ul>
          {q.rewardText && <p>Reward: {q.rewardText}</p>}
          {q.rewardLinks.map((l) => (
            <Chip key={`${l.kind}:${l.id}`} tone="done">Linked: {l.label ?? "Receipt"}</Chip>
          ))}
          <Chronicle q={q} t={t} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Entry points elsewhere
// ---------------------------------------------------------------------------------------------

/** Desk → Current session: quests in play (owner decision D8). */
export function DeskQuestsGlance() {
  const t = useQuestTable();
  const seat = useSeat();
  if (!t.ready) return null;
  const tabs = questsByTab(t);
  return (
    <div className="quest-glance">
      <h3>
        Quests in play <small>{tabs.play.length}{tabs.drafts.length ? ` · ${tabs.drafts.length} draft${tabs.drafts.length === 1 ? "" : "s"}` : ""}</small>
      </h3>
      {tabs.play.slice(0, 3).map((q) => (
        <AppLink key={q.id} href={questHref(q.id)} className="quest-glance-row">
          <span>
            <strong>{q.title}</strong>
            <small>{[nextObjective(q)?.text, audienceLabel(t, q, seat)].filter(Boolean).join(" · ")}</small>
          </span>
          {q.main && <Chip tone="main">Main</Chip>}
        </AppLink>
      ))}
      {!tabs.play.length && <p>No quests in play.</p>}
      <AppLink className="information-action" href={questHref()}>
        Open Quests →
      </AppLink>
    </div>
  );
}

/** Player Home: the followed quest and a text link with the updated count (decision D9). */
export function PlayerQuestHome() {
  const t = useQuestTable();
  const go = useGo();
  const { state } = useQuestState();
  if (!t.ready) return null;
  const quests = questsOf(t).filter((q) => !q.archived);
  const followed = quests.find((q) => q.id === state.follow && q.status === "active");
  const updated = quests.filter((q) => questUpdated(state, q)).length;
  return (
    <>
      {followed && <FollowingCard q={followed} t={t} open={() => go(questHref(followed.id))} />}
      <AppLink className="settings-link" href={questHref()}>
        Quest log{quests.length ? ` · ${updated ? `${updated} updated` : `${quests.filter((q) => q.status === "active").length} active`}` : ""} →
      </AppLink>
    </>
  );
}

/** NPC card: "Quests from <NPC>"; the DM also sees drafts and "New quest from <NPC>". */
export function NpcQuestStrip({ npcId, name }: { npcId: string; name: string }) {
  const t = useQuestTable();
  const seat = useSeat();
  const dm = seat.role === "dm";
  const [creating, setCreating] = useState(false);
  if (!t.ready) return null;
  const quests = npcQuests(t, npcId, seat);
  if (!quests.length && !dm) return null;
  return (
    <section className="quest-npc-strip" aria-label={`Quests from ${name}`}>
      <h3>Quests from {name}</h3>
      {quests.map((q) => (
        <AppLink key={q.id} href={questHref(q.id)} className="quest-glance-row">
          <span>
            <strong>{q.title}</strong>
            <small>{revealed(q) ? (nextObjective(q)?.text ?? stateWord(q.status === "completed" ? "done" : q.status === "failed" ? "failed" : "open")) : "Draft · only you"}</small>
          </span>
        </AppLink>
      ))}
      {dm &&
        (creating ? (
          <QuestEditor t={t} giverNpcId={npcId} onSaved={() => setCreating(false)} onCancel={() => setCreating(false)} />
        ) : (
          <button type="button" className="quest-link" onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" /> New quest from {name}
          </button>
        ))}
    </section>
  );
}

