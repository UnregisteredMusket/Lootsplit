import { ImportStatblock } from "./import-statblock";
import { usePrefs } from "@/lib/quire/prefs";
import { encounterRequest } from "@/lib/encounters/client";
import { localEncounterRequest } from "@/lib/encounters/local";
import { useSeat } from "@/lib/quire/seat";
import { getCampaigns, serverCampaigns, subscribeCampaigns } from "@/lib/quire/campaigns";
import { useSyncExternalStore } from "react";
import { FantasyIcon } from "@/components/fantasy-icon";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { useDesktop } from "@/lib/quire/use-desktop";
import { HpBar } from "@/components/control-panel/readouts";
import { getCloudTable } from "@/lib/quire/cloud-client";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { z } from "zod";
import { Shield } from "lucide-react";
import { accountRequest } from "@/lib/account/client";
import { useEconomy } from "@/lib/quire/economy-context";
import { downloadJson } from "@/lib/quire/table";
import {
  blankEncounter,
  blankCombatant,
  blankLoot,
  encounterSchema,
  combatantSchema,
  generatorSchema,
  estimate,
  nextTurn,
} from "@/lib/encounters/model.mjs";
type Encounter = z.infer<typeof encounterSchema>;
type Combatant = z.infer<typeof combatantSchema>;
type Filters = z.infer<typeof generatorSchema>;
type Purse = { id: string; name: string; kind: string };
type Campaign = { code: string; name: string; purses: Purse[] };
type Summary = {
  id: string;
  code: string;
  name: string;
  status: string;
  updated_at: number;
};
type Detail = {
  id: string;
  code: string;
  body: Encounter;
  revision: number;
  status: string;
  purses: Purse[];
  award: null | { receiptId: string; at: number };
};
type Roll = {
  seq: number;
  at: number;
  label: string;
  formula: string;
  source: string;
  total: number;
  selected?: number;
  tableId?: string;
  resultName?: string;
};
const message = (e: unknown) => (e instanceof Error ? e.message : "Unable to complete request.");
const defaults: Filters = {
  partySize: 4,
  level: 1,
  difficulty: "medium",
  mode: "difficulty",
  cr: 1,
  count: 1,
  enemy: "",
  environment: "",
};
const n = (value: string) => Number(value) || 0;
export function EncounterWorkspace() {
  const seat = useSeat();
  const campaign = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const personal =
    typeof window !== "undefined" &&
    new URLSearchParams(location.search).get("storage") === "personal";
  if (seat.role !== "dm" && !personal)
    return (
      <section className="encounter-panel">
        <h1>Encounters</h1>
        <p>Only the DM can manage this campaign’s encounters.</p>
      </section>
    );
  return (
    <EncounterLibrary key={`${campaign.activeId}-${seat.role}`} allowDevice={seat.role === "dm"} />
  );
}
function EncounterLibrary({ allowDevice }: { allowDevice: boolean }) {
  const desktop = useDesktop();
  const [library, setLibrary] = useState<{
      campaigns: Campaign[];
      encounters: Summary[];
    } | null>(null),
    [code, setCode] = useState(() =>
      typeof window !== "undefined" &&
      new URLSearchParams(location.search).get("storage") === "personal"
        ? "personal"
        : "",
    ),
    [selected, setSelected] = useState(""),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const selectedCode = useRef(code);
  selectedCode.current = code;
  const dirty = useRef(false),
    createKey = useRef("");
  useEffect(() => {
    const c = new AbortController();
    type Library = { campaigns: Campaign[]; encounters: Summary[] };
    const local = (
      allowDevice
        ? localEncounterRequest<Library>("encounters")
        : Promise.resolve<Library>({ campaigns: [], encounters: [] })
    ).then((data) => {
      if (!c.signal.aborted) {
        setLibrary((previous) =>
          previous
            ? {
                ...previous,
                encounters: [
                  ...data.encounters,
                  ...previous.encounters.filter((r) => r.code !== "device"),
                ],
              }
            : data,
        );
        setCode(
          (v) =>
            v ||
            (getCloudTable().joined ? getCloudTable().code : allowDevice ? "device" : "personal"),
        );
      }
      return data;
    });
    Promise.all([
      local,
      accountRequest<Library>("encounters", undefined, c.signal).catch(() => null),
    ])
      .then(([local, cloud]) => ({
        campaigns: [...local.campaigns, ...(cloud?.campaigns || [])],
        encounters: [...local.encounters, ...(cloud?.encounters || [])],
      }))
      .then((data) => {
        if (c.signal.aborted) return;
        setLibrary(data);
        const current = getCloudTable().code;
        setCode(
          (v) =>
            (data.campaigns.some((c) => c.code === v) ? v : "") ||
            data.campaigns.find((x) => x.code === current)?.code ||
            data.campaigns[0]?.code ||
            "",
        );
        const params = new URLSearchParams(location.search);
        if (params.has("resume") || params.has("review")) {
          const eligible = data.encounters.filter(
            (x) =>
              x.code === (selectedCode.current || (getCloudTable().joined ? current : "device")) &&
              x.status !== "awarded",
          );
          const match =
            eligible.find((x) => x.status === (params.has("review") ? "review" : "active")) ||
            eligible[0];
          if (match) setSelected((v) => v || match.id);
        }
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      });
    return () => c.abort();
  }, [refresh, allowDevice]); // Destination changes do not reload or discard an open draft.
  function canLeave() {
    return (
      !dirty.current ||
      window.confirm(
        "Discard unsaved encounter changes? Export your draft first if you want to keep it.",
      )
    );
  }
  async function create(encounter = blankEncounter()) {
    if (!canLeave()) return;
    setBusy(true);
    setError("");
    try {
      createKey.current ||= crypto.randomUUID();
      const r = await encounterRequest<{ id: string }>("encounters/create", {
        code,
        id: createKey.current,
        encounter,
      });
      createKey.current = "";
      dirty.current = false;
      setSelected(r.id);
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="character-play encounter-workspace" aria-label="DM encounters">
      <header className="character-heading">
        <div>
          <p className="eyebrow">THE DUNGEON MASTER’S DESK</p>
          <h1>Encounters</h1>
          <p>Prepare the opposition. Run the battle. Review the spoils.</p>
        </div>
        <span className="encounter-badge">
          <Shield size={16} /> DM only
        </span>
      </header>
      {error && (
        <p role="alert" className="character-error">
          {error}
        </p>
      )}
      {!library ? (
        <p>Loading encounters…</p>
      ) : (
        <>
          <div className="character-toolbar">
            <label>
              Save in
              <select
                aria-label="Save in"
                value={code}
                onChange={(e) => {
                  if (canLeave()) {
                    dirty.current = false;
                    createKey.current = "";
                    setCode(e.target.value);
                    setSelected("");
                  }
                }}
              >
                {library.campaigns.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                    {!["device", "personal"].includes(c.code) ? ` · ${c.code}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy || !library.campaigns.some((c) => c.code === code)}
              onClick={() => void create()}
            >
              <FantasyIcon ui="Encounters" size={22} /> New encounter
            </button>
            <label className="encounter-import">
              Import encounter JSON
              <input
                type="file"
                accept=".json,application/json"
                disabled={busy || !library.campaigns.some((c) => c.code === code)}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    if (file.size > 500000)
                      throw new Error("Encounter imports must be under 500 KB.");
                    const v = JSON.parse(await file.text());
                    const body = encounterSchema.parse(v.body || v);
                    await create({
                      ...body,
                      coinPurseId: "",
                      loot: body.loot
                        .filter((item) => !item.sourceTableId)
                        .map((item) => ({ ...item, purseId: "" })),
                      tables: body.tables.map((t) => ({
                        ...t,
                        selected: null,
                        entries: t.entries.map((entry) => ({
                          ...entry,
                          loot: { ...entry.loot, purseId: "" },
                        })),
                      })),
                    });
                  } catch (err) {
                    setError(message(err));
                  }
                }}
              />
            </label>
          </div>
          <p className="text-sm text-muted">
            {!library.campaigns.length
              ? "Sign in to load your account drafts."
              : code === "device"
                ? "Saved in your owned device campaign. Build offline here, or import an exported encounter."
                : code === "personal"
                  ? "Saved to your account. Export a draft to import it into the app or a DM campaign."
                  : "Saved to this multiplayer DM campaign."}{" "}
            <Link to="/account">My account</Link>
          </p>
          <div className="encounter-layout">
            <aside className="encounter-library">
              <details open={!selected || desktop}>
                <summary>Saved encounters</summary>
                <h2 className="sr-only">Saved encounters</h2>
                <p className="text-sm text-muted">
                  Private drafts, active battles and award receipts.
                </p>
                {library.encounters
                  .filter((r) => r.code === code)
                  .map((r) => (
                    <button
                      key={r.id}
                      className="encounter-library-row"
                      aria-pressed={selected === r.id}
                      onClick={() => {
                        if (canLeave()) {
                          dirty.current = false;
                          setSelected(r.id);
                        }
                      }}
                    >
                      <strong>{r.name}</strong>
                      <span>
                        {r.status === "review" ? "Loot review" : r.status} ·{" "}
                        {new Date(r.updated_at).toLocaleDateString()}
                      </span>
                    </button>
                  ))}
                {!library.encounters.some((r) => r.code === code) && <p>No encounters yet.</p>}
              </details>
            </aside>
            {selected ? (
              <EncounterEditor
                key={selected}
                id={selected}
                onDirty={(v) => {
                  dirty.current = v;
                }}
                onSaved={() => setRefresh((v) => v + 1)}
              />
            ) : (
              <div className="encounter-panel encounter-empty">
                <FantasyIcon ui="Encounters" size={40} />
                <h2>Set the scene</h2>
                <p>
                  Create an encounter, choose enemies from the index or generator, and attach loot
                  before play. Physical dice and manually entered results are always available to
                  the DM.
                </p>
                <button
                  disabled={busy || !library.campaigns.some((c) => c.code === code)}
                  onClick={() => void create()}
                >
                  Build an encounter
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
function EncounterEditor({
  id,
  onDirty,
  onSaved,
}: {
  id: string;
  onDirty: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { prefs, setPrefs } = usePrefs();
  const manual = prefs.rollMode === "manual";
  const setManual = (value: boolean) => setPrefs({ rollMode: value ? "manual" : "virtual" });
  const [tableTotals, setTableTotals] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<Detail | null>(null),
    [draft, setDraft] = useState<Encounter | null>(null),
    [tab, setTab] = useState(
      typeof window !== "undefined" && new URLSearchParams(location.search).has("review")
        ? "loot"
        : "battle",
    ),
    [expanded, setExpanded] = useState(""),
    [hpAmount, setHpAmount] = useState(1),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reload, setReload] = useState(0),
    [filters, setFilters] = useState<Filters>(defaults),
    [index, setIndex] = useState<(Combatant & { type: string; environments: string })[]>([]),
    [indexMore, setIndexMore] = useState(false),
    [indexPage, setIndexPage] = useState(0),
    [querying, setQuerying] = useState(false),
    [rolls, setRolls] = useState<Roll[]>([]),
    [moreRolls, setMoreRolls] = useState(false),
    [rollLabel, setRollLabel] = useState("Encounter roll"),
    [formula, setFormula] = useState("1d20"),
    [total, setTotal] = useState(""),
    [lootSearch, setLootSearch] = useState("");
  const pendingRoll = useRef<{
    path: string;
    body: Record<string, unknown>;
  } | null>(null);
  const { catalog, reload: reloadEconomy } = useEconomy();
  useEffect(() => {
    const c = new AbortController();
    encounterRequest<Detail>("encounters/detail", { id }, c.signal)
      .then((d) => {
        setDetail(d);
        setDraft(d.body);
        setFilters({
          ...defaults,
          partySize: d.body.partySize,
          level: d.body.level,
          difficulty: d.body.difficulty,
        });
        setDirty(false);
        onDirty(false);
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      });
    return () => c.abort();
  }, [id, reload]); // callback only updates parent's ref
  useEffect(() => {
    const c = new AbortController();
    encounterRequest<{ rolls: Roll[]; more: boolean }>("encounters/log", { id }, c.signal)
      .then((r) => {
        setRolls(r.rolls);
        setMoreRolls(r.more);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      });
    return () => c.abort();
  }, [id, reload]);
  useDraftGuard(dirty, "encounter");
  function change(next: Encounter) {
    setDraft(next);
    setDirty(true);
    onDirty(true);
    setNotice("");
  }
  async function action(path: string, extra: Record<string, unknown> = {}) {
    if (!detail || !draft) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await encounterRequest(`encounters/${path}`, {
        id,
        revision: detail.revision,
        ...extra,
      });
      const saved = await encounterRequest<Detail>("encounters/detail", { id });
      setDetail(saved);
      setDraft(saved.body);
      setDirty(false);
      onDirty(false);
      onSaved();
      if (path === "award" && id.startsWith("local-")) await reloadEconomy();
      setNotice(
        path === "award"
          ? "Loot transferred. This encounter cannot award loot again."
          : path === "conclude"
            ? "Encounter concluded. Review recipients and loot before transferring."
            : "Encounter saved.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function search(generate = false, page = 1) {
    if (!detail || !draft) return;
    setQuerying(true);
    setError("");
    try {
      const f = {
        ...filters,
        partySize: draft.partySize,
        level: draft.level,
        difficulty: draft.difficulty,
      };
      if (generate) {
        const r = await encounterRequest<{ combatants: Combatant[] }>("encounters/generate", {
          code: detail.code,
          filters: f,
        });
        if (draft.combatants.length + r.combatants.length > 100)
          throw new Error("An encounter can contain up to 100 combatants.");
        change({
          ...draft,
          combatants: [...draft.combatants, ...r.combatants],
        });
        setNotice(
          `Added ${r.combatants.length} enemies. Review the estimated difficulty and adjust as needed.`,
        );
      } else {
        const r = await encounterRequest<{
          creatures: typeof index;
          more: boolean;
        }>("encounters/index", { code: detail.code, filters: f, page });
        setIndex(r.creatures);
        setIndexMore(r.more);
        setIndexPage(page);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setQuerying(false);
    }
  }
  async function roll(tableId?: string, retry = false) {
    if (!detail || !draft) return;
    if (!retry && manual) {
      const raw = tableId ? (tableTotals[tableId] ?? "") : total;
      const value = Number(raw);
      const maximum = tableId
        ? (draft.tables
            .find((table) => table.id === tableId)
            ?.entries.reduce((sum, row) => sum + row.weight, 0) ?? 0)
        : 100000;
      const minimum = tableId ? 1 : -100000;
      if (!raw.trim() || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
        setError(`Enter a whole-number physical total from ${minimum} to ${maximum}.`);
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      if (!retry)
        pendingRoll.current = {
          path: "encounters/roll",
          body: {
            id,
            revision: detail.revision,
            requestKey: crypto.randomUUID(),
            formula,
            label: rollLabel,
            manual,
            total:
              (tableId ? (tableTotals[tableId] ?? "") : total).trim() === ""
                ? null
                : Number(tableId ? tableTotals[tableId] : total),
            tableId,
          },
        };
      const pending = pendingRoll.current;
      if (!pending) return;
      const r = await encounterRequest<Roll>(pending.path, pending.body);
      pendingRoll.current = null;
      const history = await encounterRequest<{ rolls: Roll[]; more: boolean }>("encounters/log", {
        id,
      });
      setRolls(history.rolls);
      setMoreRolls(history.more);
      if (r.tableId && r.selected !== undefined)
        change({
          ...draft,
          tables: draft.tables.map((t) =>
            t.id === r.tableId ? { ...t, selected: r.selected! } : t,
          ),
        });
      setNotice(
        `${r.label}: ${r.resultName || r.total} (${r.source === "manual" ? "manual result" : "app-generated"}).${r.tableId ? " Save to keep the selected loot result." : ""}`,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (!detail || !draft)
    return (
      <div className="encounter-panel">
        {error ? <p role="alert">{error}</p> : <p>Loading encounter…</p>}
      </div>
    );
  const readOnly = detail.status === "awarded",
    review = detail.status === "review",
    locked = readOnly || busy || querying;
  const stats = estimate(draft);
  const updateCombatant = (id: string, patch: Partial<Combatant>) =>
    change({
      ...draft,
      combatants: draft.combatants.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  const recipients = (value: string, onChange: (v: string) => void, label = "Recipient") => (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose recipient</option>
        {detail.purses.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.kind === "party" ? " · party inventory" : ""}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="encounter-editor">
      <div className="encounter-panel">
        <div className="encounter-heading">
          <div>
            <p className="eyebrow">
              {detail.status === "review" ? "READY FOR LOOT REVIEW" : detail.status.toUpperCase()}
            </p>
            <h2>{draft.name}</h2>
          </div>
          <span className="encounter-badge">
            {dirty
              ? "Unsaved changes"
              : id.startsWith("local-")
                ? "Saved on this device"
                : "Saved to your profile"}
          </span>
        </div>
        <div className="character-savebar">
          <button
            disabled={locked || !dirty}
            onClick={() => void action("save", { encounter: draft })}
          >
            Save encounter
          </button>
          <button
            disabled={busy}
            onClick={() => {
              if (!dirty || window.confirm("Discard unsaved changes and reload?"))
                setReload((v) => v + 1);
            }}
          >
            Reload
          </button>
          <button
            onClick={() =>
              void downloadJson(`${draft.name.replace(/[^a-z0-9-]/gi, "_")}.json`, {
                body: draft,
                status: detail.status,
                award: detail.award,
              })
            }
          >
            Export draft
          </button>
          {detail.status === "draft" && (
            <button disabled={locked || dirty} onClick={() => void action("start")}>
              Start encounter
            </button>
          )}
          {!review && !readOnly && (
            <button
              disabled={busy || dirty}
              onClick={() => {
                if (
                  window.confirm(
                    "Conclude the encounter and prepare its loot for review? Nothing transfers yet.",
                  )
                ) {
                  setTab("loot");
                  void action("conclude");
                }
              }}
            >
              Conclude & review loot
            </button>
          )}
        </div>
        {dirty && (
          <p className="text-sm text-muted">
            Save changes before rolling, starting, concluding or transferring loot.
          </p>
        )}
        {error && (
          <p role="alert" className="character-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="encounter-notice">
            {notice}
          </p>
        )}
        {readOnly && (
          <p className="encounter-notice">
            Awarded {detail.award ? new Date(detail.award.at).toLocaleString() : ""}. Receipt:{" "}
            {detail.award?.receiptId}. This encounter is locked against a second award.
          </p>
        )}
        <nav className="encounter-tabs" aria-label="Encounter sections">
          {[
            ["battle", "Battle tracker"],
            ["build", "Builder & generator"],
            ["loot", "Loot & rewards"],
            ["rolls", "Roll history"],
          ].map(([key, label]) => (
            <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
      </div>
      <fieldset disabled={locked} className="encounter-fieldset">
        {tab === "battle" && (
          <div className="encounter-panel">
            <div className="encounter-heading">
              <h3>
                <FantasyIcon ui="Encounters" size={26} /> Initiative & combat
              </h3>
              <span>Round {draft.round}</span>
            </div>
            <p>
              Enter physical initiative rolls, adjust HP and conditions, and choose any active
              combatant. Ties follow roster order. Effects and defeated turns are handled by the DM.
            </p>
            <div className="character-toolbar">
              <label>
                Round
                <input
                  type="number"
                  min="1"
                  value={draft.round}
                  onChange={(e) => change({ ...draft, round: n(e.target.value) })}
                />
              </label>
              <button disabled={!draft.combatants.length} onClick={() => change(nextTurn(draft))}>
                Next turn
              </button>
              <button
                onClick={() =>
                  change({
                    ...draft,
                    combatants: [...draft.combatants, blankCombatant()],
                  })
                }
              >
                Add combatant
              </button>
            </div>
            {!draft.combatants.length && (
              <p>No combatants yet. Add a custom combatant or open Builder & generator.</p>
            )}
            {[...draft.combatants]
              .sort((a, b) => (b.initiative ?? -1001) - (a.initiative ?? -1001))
              .map((c) => (
                <details
                  key={c.id}
                  open={draft.activeId === c.id || expanded === c.id || !draft.activeId}
                  className={`encounter-combatant ${draft.activeId === c.id ? "is-active" : ""}`}
                >
                  <summary className="combat-summary" onClick={() => setExpanded(c.id)}>
                    <span className="initiative-number">{c.initiative ?? "—"}</span>
                    <span className="combat-portrait">
                      <FantasyIcon entry={{ ...c, kind: "creatures" }} size={36} />
                    </span>
                    <span className="combat-identity">
                      <strong>{c.name}</strong>
                      <HpBar hp={c.hp} max={c.maxHp} />
                    </span>
                    <span className="combat-hp">
                      {c.hp} / {c.maxHp}
                      <small>{c.hp === 0 ? "Defeated" : c.conditions || `AC ${c.ac}`}</small>
                    </span>
                  </summary>
                  <div className="combat-expanded">
                    <div className="combat-quick-adjust">
                      <label>
                        HP adjustment
                        <input
                          type="number"
                          min="1"
                          max="1000000"
                          value={hpAmount}
                          onChange={(e) => setHpAmount(Math.max(1, n(e.target.value)))}
                        />
                      </label>
                      <button
                        onClick={() =>
                          updateCombatant(c.id, {
                            hp: Math.max(0, c.hp - hpAmount),
                          })
                        }
                      >
                        Damage
                      </button>
                      <button
                        onClick={() =>
                          updateCombatant(c.id, {
                            hp: Math.min(c.maxHp, c.hp + hpAmount),
                          })
                        }
                      >
                        Heal
                      </button>
                    </div>
                    <div className="encounter-heading">
                      <h4>
                        {c.name} {c.hp === 0 ? "· 0 HP" : ""}
                      </h4>
                      <button
                        aria-pressed={draft.activeId === c.id}
                        onClick={() => change({ ...draft, activeId: c.id })}
                      >
                        {draft.activeId === c.id ? "Current turn" : "Set active"}
                      </button>
                    </div>
                    <div className="encounter-vitals">
                      <label>
                        Name
                        <input
                          value={c.name}
                          onChange={(e) => updateCombatant(c.id, { name: e.target.value })}
                        />
                      </label>
                      <label>
                        Side
                        <select
                          value={c.side}
                          onChange={(e) =>
                            updateCombatant(c.id, {
                              side: e.target.value as Combatant["side"],
                            })
                          }
                        >
                          <option value="enemy">Enemy</option>
                          <option value="ally">Ally / player</option>
                        </select>
                      </label>
                      <label>
                        Initiative
                        <input
                          type="number"
                          value={c.initiative ?? ""}
                          placeholder="Not rolled"
                          onChange={(e) =>
                            updateCombatant(c.id, {
                              initiative: e.target.value === "" ? null : n(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        HP
                        <input
                          type="number"
                          min="0"
                          max={c.maxHp}
                          value={c.hp}
                          onChange={(e) => updateCombatant(c.id, { hp: n(e.target.value) })}
                        />
                      </label>
                      <label>
                        Max HP
                        <input
                          type="number"
                          min="1"
                          value={c.maxHp}
                          onChange={(e) => updateCombatant(c.id, { maxHp: n(e.target.value) })}
                        />
                      </label>
                      <label>
                        AC
                        <input
                          type="number"
                          value={c.ac}
                          onChange={(e) => updateCombatant(c.id, { ac: n(e.target.value) })}
                        />
                      </label>
                    </div>
                    <label>
                      Conditions
                      <input
                        placeholder="Prone, frightened, concentration…"
                        value={c.conditions}
                        onChange={(e) => updateCombatant(c.id, { conditions: e.target.value })}
                      />
                    </label>
                    <details>
                      <summary>Stats, notes & source</summary>
                      <div className="encounter-grid">
                        <label>
                          CR
                          <input
                            type="number"
                            min="0"
                            max="30"
                            step="0.125"
                            value={c.cr}
                            onChange={(e) => updateCombatant(c.id, { cr: n(e.target.value) })}
                          />
                        </label>
                        <label>
                          XP
                          <input
                            type="number"
                            value={c.xp}
                            onChange={(e) => updateCombatant(c.id, { xp: n(e.target.value) })}
                          />
                        </label>
                        <label>
                          Initiative modifier
                          <input
                            type="number"
                            value={c.initiativeBonus}
                            onChange={(e) =>
                              updateCombatant(c.id, {
                                initiativeBonus: n(e.target.value),
                              })
                            }
                          />
                        </label>
                      </div>
                      <label>
                        Actions & notes
                        <textarea
                          rows={5}
                          value={c.notes}
                          onChange={(e) => updateCombatant(c.id, { notes: e.target.value })}
                        />
                      </label>
                      <p className="text-sm text-muted">{c.source}</p>
                      <button
                        onClick={() =>
                          change({
                            ...draft,
                            combatants: draft.combatants.filter((r) => r.id !== c.id),
                            activeId: draft.activeId === c.id ? "" : draft.activeId,
                          })
                        }
                      >
                        Remove combatant
                      </button>
                    </details>
                  </div>
                </details>
              ))}
          </div>
        )}
        {tab === "build" && (
          <div className="encounter-panel">
            <h3>Encounter builder</h3>
            <label>
              Encounter name
              <input
                value={draft.name}
                onChange={(e) => change({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Scene & DM notes
              <textarea
                rows={3}
                value={draft.notes}
                onChange={(e) => change({ ...draft, notes: e.target.value })}
              />
            </label>
            <div className="encounter-grid">
              <label>
                Party size
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={draft.partySize}
                  onChange={(e) => change({ ...draft, partySize: n(e.target.value) })}
                />
              </label>
              <label>
                Party level
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={draft.level}
                  onChange={(e) => change({ ...draft, level: n(e.target.value) })}
                />
              </label>
              <label>
                Desired difficulty
                <select
                  value={draft.difficulty}
                  onChange={(e) =>
                    change({
                      ...draft,
                      difficulty: e.target.value as Encounter["difficulty"],
                    })
                  }
                >
                  {["easy", "medium", "hard", "deadly"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="encounter-estimate">
              <strong>Estimated: {stats.label}</strong>
              <span>
                {stats.adjusted.toLocaleString()} adjusted XP · {stats.raw.toLocaleString()} base XP
              </span>
            </div>
            <p className="text-sm text-muted">
              D&D 2014 estimate for a same-level party, including group-size multipliers. Custom
              actions, terrain and house rules can change the challenge. XP is informational and is
              not awarded automatically.
            </p>
            <h3>
              <FantasyIcon ui="Dice" size={26} /> Generate editable enemies
            </h3>
            <div className="encounter-grid">
              <label>
                Generation target
                <select
                  value={filters.mode}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      mode: e.target.value as Filters["mode"],
                    })
                  }
                >
                  <option value="difficulty">Party difficulty</option>
                  <option value="cr">Exact enemy CR</option>
                </select>
              </label>
              {filters.mode === "cr" && (
                <>
                  <label>
                    Enemy CR
                    <select
                      value={filters.cr}
                      onChange={(e) => setFilters({ ...filters, cr: n(e.target.value) })}
                    >
                      {[0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)].map(
                        (v) => (
                          <option key={v} value={v}>
                            {v === 0.125 ? "1/8" : v === 0.25 ? "1/4" : v === 0.5 ? "1/2" : v}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    Enemy count
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={filters.count}
                      onChange={(e) => setFilters({ ...filters, count: n(e.target.value) })}
                    />
                  </label>
                </>
              )}
            </div>
            <div className="encounter-grid">
              <label>
                Enemy name or type
                <input
                  placeholder="Goblin, undead, beast…"
                  value={filters.enemy}
                  onChange={(e) => setFilters({ ...filters, enemy: e.target.value })}
                />
              </label>
              <label>
                Environment filter
                <input
                  placeholder="Forest, caves, urban…"
                  value={filters.environment}
                  onChange={(e) => setFilters({ ...filters, environment: e.target.value })}
                />
              </label>
            </div>
            <ImportStatblock
              disabled={review || busy}
              onImport={(creature) => {
                change({ ...draft, combatants: [...draft.combatants, creature] });
                setTab("battle");
              }}
            />
            <div className="character-toolbar">
              <button disabled={querying || review} onClick={() => void search(true)}>
                {querying ? "Loading Open5e…" : "Generate & add enemies"}
              </button>
              <button disabled={querying} onClick={() => void search(false)}>
                Search enemy index
              </button>
              <button
                disabled={review}
                onClick={() => {
                  change({
                    ...draft,
                    combatants: [...draft.combatants, blankCombatant()],
                  });
                  setTab("battle");
                }}
              >
                Add custom enemy
              </button>
            </div>
            <p className="text-sm text-muted">
              Generation adds to your existing roster. Difficulty mode selects a creature group near
              the target; CR mode uses the selected CR per enemy. Open5e SRD 5.1 source credits are
              retained with each creature.
            </p>
            {index.map((c) => (
              <div key={c.sourceKey} className="encounter-index-row">
                <div>
                  <strong>
                    <FantasyIcon entry={{ ...c, kind: "creatures" }} className="fantasy-inline" />
                    {c.name}
                  </strong>
                  <p>
                    CR {c.cr} · {c.type} · HP {c.maxHp} · AC {c.ac}
                  </p>
                  <small>{c.environments}</small>
                </div>
                <button
                  disabled={review}
                  onClick={() =>
                    change({
                      ...draft,
                      combatants: [...draft.combatants, { ...c, id: crypto.randomUUID() }],
                    })
                  }
                >
                  Add {c.name}
                </button>
              </div>
            ))}
            {indexPage > 0 && !index.length && <p>No creatures match those filters.</p>}
            <div className="character-toolbar">
              {indexPage > 1 && (
                <button disabled={querying} onClick={() => void search(false, indexPage - 1)}>
                  Previous enemies
                </button>
              )}
              {indexMore && (
                <button disabled={querying} onClick={() => void search(false, indexPage + 1)}>
                  More enemies
                </button>
              )}
            </div>
          </div>
        )}
        {tab === "loot" && (
          <div className="encounter-panel">
            <h3>
              <FantasyIcon ui="gift" size={26} />{" "}
              {review ? "Review the loot award" : "Assigned loot"}
            </h3>
            <p>
              {review
                ? "Adjust the award and choose who receives each item. Save your review, then transfer once."
                : "Attach guaranteed items and optional weighted loot tables. Select a physical result or roll a saved table before concluding."}
            </p>
            <div className="encounter-coins">
              {(["cp", "sp", "ep", "gp", "pp"] as const).map((k) => (
                <label key={k}>
                  {k.toUpperCase()}
                  <input
                    type="number"
                    min="0"
                    value={draft.coins[k]}
                    onChange={(e) =>
                      change({
                        ...draft,
                        coins: { ...draft.coins, [k]: n(e.target.value) },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            {recipients(
              draft.coinPurseId,
              (v) => change({ ...draft, coinPurseId: v }),
              "Coin recipient",
            )}
            <div className="character-toolbar">
              <button onClick={() => change({ ...draft, loot: [...draft.loot, blankLoot()] })}>
                Add custom loot
              </button>
              <button
                onClick={() => {
                  const recipient = detail.purses.find((p) => p.kind === "party")?.id;
                  if (recipient)
                    change({
                      ...draft,
                      coinPurseId: recipient,
                      loot: draft.loot.map((l) => ({
                        ...l,
                        purseId: recipient,
                      })),
                    });
                  else setError("Create a party fund in this campaign first.");
                }}
              >
                Assign all to party inventory
              </button>
            </div>
            <details>
              <summary>Add items from your current catalog</summary>
              <label>
                Find catalog item
                <input value={lootSearch} onChange={(e) => setLootSearch(e.target.value)} />
              </label>
              <p className="text-sm text-muted">
                Catalog items are copied into the encounter with their notes and value. Your current
                device campaign supplies this catalog.
              </p>
              {catalog
                .filter(
                  (c) => !c.service && c.name.toLowerCase().includes(lootSearch.toLowerCase()),
                )
                .slice(0, 20)
                .map((c) => (
                  <button
                    className="encounter-catalog"
                    key={c.id}
                    onClick={() =>
                      change({
                        ...draft,
                        loot: [
                          ...draft.loot,
                          {
                            ...blankLoot(),
                            name: c.name,
                            unitCopper: c.baseCopper,
                            notes: c.notes,
                            catalogId: c.id,
                          },
                        ],
                      })
                    }
                  >
                    <FantasyIcon entry={c} className="fantasy-inline" />
                    Add {c.name}
                  </button>
                ))}
            </details>
            {draft.loot.map((l, i) => (
              <article className="encounter-combatant" key={l.id}>
                <FantasyIcon entry={l} size={32} />
                <div className="encounter-grid">
                  <label>
                    Item name
                    <input
                      value={l.name}
                      onChange={(e) =>
                        change({
                          ...draft,
                          loot: draft.loot.map((r, j) =>
                            i === j ? { ...r, name: e.target.value } : r,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Quantity
                    <input
                      type="number"
                      min="1"
                      value={l.quantity}
                      onChange={(e) =>
                        change({
                          ...draft,
                          loot: draft.loot.map((r, j) =>
                            i === j ? { ...r, quantity: n(e.target.value) } : r,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Value each (cp)
                    <input
                      type="number"
                      min="0"
                      value={l.unitCopper}
                      onChange={(e) =>
                        change({
                          ...draft,
                          loot: draft.loot.map((r, j) =>
                            i === j ? { ...r, unitCopper: n(e.target.value) } : r,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
                {recipients(
                  l.purseId,
                  (v) =>
                    change({
                      ...draft,
                      loot: draft.loot.map((r, j) => (i === j ? { ...r, purseId: v } : r)),
                    }),
                  `Recipient for item ${i + 1}`,
                )}
                <details>
                  <summary>Item notes</summary>
                  <textarea
                    aria-label={`Notes for item ${i + 1}`}
                    value={l.notes}
                    onChange={(e) =>
                      change({
                        ...draft,
                        loot: draft.loot.map((r, j) =>
                          i === j ? { ...r, notes: e.target.value } : r,
                        ),
                      })
                    }
                  />
                </details>
                <button
                  onClick={() =>
                    change({
                      ...draft,
                      loot: draft.loot.filter((r) => r.id !== l.id),
                    })
                  }
                >
                  Remove item
                </button>
              </article>
            ))}
            {!review && !readOnly && (
              <>
                <h3>Loot tables</h3>
                <p>
                  Each table contributes one selected result when the encounter concludes. Weight
                  controls its chance in an app-generated draw. A manual selection represents a
                  physical roll or DM choice.
                </p>
                <button
                  onClick={() =>
                    change({
                      ...draft,
                      tables: [
                        ...draft.tables,
                        {
                          id: crypto.randomUUID(),
                          name: "Loot table",
                          selected: null,
                          entries: [{ weight: 1, loot: blankLoot() }],
                        },
                      ],
                    })
                  }
                >
                  Attach loot table
                </button>
                {draft.tables.map((t, ti) => {
                  const update = (patch: Partial<Encounter["tables"][number]>) =>
                    change({
                      ...draft,
                      tables: draft.tables.map((r, i) => (i === ti ? { ...r, ...patch } : r)),
                    });
                  return (
                    <article className="encounter-combatant" key={t.id}>
                      <label>
                        Table name
                        <input value={t.name} onChange={(e) => update({ name: e.target.value })} />
                      </label>
                      {t.entries.map((entry, ei) => (
                        <div className="encounter-table-entry" key={ei}>
                          <label>
                            Result name
                            <input
                              value={entry.loot.name}
                              onChange={(e) =>
                                update({
                                  selected: null,
                                  entries: t.entries.map((r, i) =>
                                    i === ei
                                      ? {
                                          ...r,
                                          loot: {
                                            ...r.loot,
                                            name: e.target.value,
                                          },
                                        }
                                      : r,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label>
                            Weight
                            <input
                              type="number"
                              min="1"
                              value={entry.weight}
                              onChange={(e) =>
                                update({
                                  selected: null,
                                  entries: t.entries.map((r, i) =>
                                    i === ei ? { ...r, weight: n(e.target.value) } : r,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label>
                            Quantity
                            <input
                              type="number"
                              min="1"
                              value={entry.loot.quantity}
                              onChange={(e) =>
                                update({
                                  selected: null,
                                  entries: t.entries.map((r, i) =>
                                    i === ei
                                      ? {
                                          ...r,
                                          loot: {
                                            ...r.loot,
                                            quantity: n(e.target.value),
                                          },
                                        }
                                      : r,
                                  ),
                                })
                              }
                            />
                          </label>
                          <button
                            onClick={() =>
                              update({
                                selected: null,
                                entries: t.entries.filter((_, i) => i !== ei),
                              })
                            }
                          >
                            Remove result
                          </button>
                        </div>
                      ))}
                      <div className="character-toolbar">
                        <button
                          onClick={() =>
                            update({
                              selected: null,
                              entries: [...t.entries, { weight: 1, loot: blankLoot() }],
                            })
                          }
                        >
                          Add result
                        </button>
                        <label>
                          Add catalog result
                          <select
                            value=""
                            onChange={(e) => {
                              const c = catalog.find((c) => c.id === e.target.value);
                              if (c)
                                update({
                                  selected: null,
                                  entries: [
                                    ...t.entries,
                                    {
                                      weight: 1,
                                      loot: {
                                        ...blankLoot(),
                                        name: c.name,
                                        unitCopper: c.baseCopper,
                                        notes: c.notes,
                                        catalogId: c.id,
                                      },
                                    },
                                  ],
                                });
                            }}
                          >
                            <option value="">Choose catalog item</option>
                            {catalog
                              .filter((c) => !c.service)
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      </div>
                      <label>
                        Selected result (physical roll or DM choice)
                        <select
                          value={t.selected ?? ""}
                          onChange={(e) =>
                            update({
                              selected: e.target.value === "" ? null : n(e.target.value),
                            })
                          }
                        >
                          <option value="">Not resolved</option>
                          {t.entries.map((r, i) => (
                            <option key={i} value={i}>
                              {i + 1}. {r.loot.name} × {r.loot.quantity}
                            </option>
                          ))}
                        </select>
                      </label>
                      {manual && (
                        <label>
                          Physical table total (1–
                          {t.entries.reduce((sum, row) => sum + row.weight, 0)})
                          <input
                            aria-label={`${t.name} physical table total`}
                            type="number"
                            step="1"
                            min="1"
                            max={t.entries.reduce((sum, row) => sum + row.weight, 0)}
                            value={tableTotals[t.id] ?? ""}
                            onChange={(e) =>
                              setTableTotals({ ...tableTotals, [t.id]: e.target.value })
                            }
                          />
                        </label>
                      )}
                      <div className="character-toolbar">
                        <button
                          disabled={
                            dirty ||
                            !!pendingRoll.current ||
                            (manual && !(tableTotals[t.id] ?? "").trim())
                          }
                          onClick={() => void roll(t.id)}
                        >
                          {manual ? "Record physical loot-table roll" : "Roll saved loot table"}
                        </button>
                        <button
                          onClick={() =>
                            change({
                              ...draft,
                              tables: draft.tables.filter((r) => r.id !== t.id),
                            })
                          }
                        >
                          Remove table
                        </button>
                      </div>
                    </article>
                  );
                })}
              </>
            )}
            {review && (
              <div className="encounter-award">
                <h3>Transfer reviewed loot</h3>
                <p>
                  This updates the selected players’ or party’s campaign inventory and ledger
                  together. The stored receipt prevents this encounter from awarding twice,
                  including after a connection failure.
                </p>
                <button
                  disabled={busy || dirty}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Transfer the reviewed loot from “${draft.name}” to the selected campaign inventories?`,
                      )
                    )
                      void action("award");
                  }}
                >
                  Transfer loot once
                </button>
              </div>
            )}
          </div>
        )}
      </fieldset>
      {tab === "rolls" && (
        <div className="encounter-panel">
          <h3>
            <FantasyIcon ui="Dice" size={26} /> Encounter rolls
          </h3>
          <p>
            Physical results are labeled Manual. Virtual rolls are generated and recorded by the
            app. Changing the source changes your device’s Roll mode setting. Apply results to
            initiative, HP and gameplay yourself.
          </p>
          <fieldset disabled={busy || readOnly || review || dirty} className="encounter-fieldset">
            <div className="encounter-grid">
              <label>
                Roll label
                <input value={rollLabel} onChange={(e) => setRollLabel(e.target.value)} />
              </label>
              <label>
                Dice formula
                <input
                  placeholder="1d20+3"
                  value={formula}
                  onChange={(e) => setFormula(e.target.value)}
                />
              </label>
              <label>
                Roll source
                <select
                  aria-label="Roll source"
                  value={manual ? "manual" : "server"}
                  onChange={(e) => setManual(e.target.value === "manual")}
                >
                  <option value="manual">Manual / physical dice</option>
                  <option value="server">App-generated</option>
                </select>
              </label>
              {manual && (
                <label>
                  Manual total
                  <input type="number" value={total} onChange={(e) => setTotal(e.target.value)} />
                </label>
              )}
            </div>
            <button disabled={!!pendingRoll.current} onClick={() => void roll()}>
              {manual ? "Record manual roll" : "Roll dice"}
            </button>
          </fieldset>
          {pendingRoll.current && (
            <button disabled={busy} onClick={() => void roll(undefined, true)}>
              Retry pending roll
            </button>
          )}
          <ol className="encounter-rolls">
            {rolls.map((r) => (
              <li key={r.seq}>
                <div>
                  <strong>{r.label}</strong>
                  <span>
                    {r.source === "manual" ? "Manual" : "App-generated"} · {r.formula} ·{" "}
                    {new Date(r.at).toLocaleString()}
                  </span>
                </div>
                <strong>{r.resultName || r.total}</strong>
              </li>
            ))}
          </ol>
          {!rolls.length && <p>No rolls recorded yet.</p>}
          {moreRolls && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await encounterRequest<{
                    rolls: Roll[];
                    more: boolean;
                  }>("encounters/log", { id, before: rolls.at(-1)?.seq });
                  setRolls([...rolls, ...r.rolls]);
                  setMoreRolls(r.more);
                } catch (e) {
                  setError(message(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Older rolls
            </button>
          )}
        </div>
      )}
    </div>
  );
}
