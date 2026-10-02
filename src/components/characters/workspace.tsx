import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { z } from "zod";
import { accountRequest } from "@/lib/account/client";
import {
  abilities,
  skills,
  blankSheet,
  sheetSchema,
  modifier,
  signed,
  rollSpec,
} from "@/lib/characters/model.mjs";
import { readCharacterSheet } from "@/lib/quire/sheet-file";
import { searchOpen5e } from "@/lib/quire/open5e-api";
import type { OpenEntry } from "@/lib/quire/open5e";
import { downloadJson } from "@/lib/quire/table";

type Sheet = z.infer<typeof sheetSchema>;
type Ability = keyof Sheet["scores"];
type Row = { id: string; body: Sheet; revision: number; campaign_code: string; purse_id: string };
type Campaign = {
  code: string;
  name: string;
  role: string;
  purses: { id: string; name: string }[];
};
type Detail = Row & {
  editable: boolean;
  assignmentError: string;
  campaign: null | {
    code: string;
    role: string;
    manualAllowed: boolean;
    coins: Sheet["coins"];
    holdings: { id: string; name: string; quantity: number }[];
  };
};
type Roll = {
  id: string;
  seq: number;
  at: number;
  character: string;
  actor: string;
  label: string;
  formula: string;
  source: string;
  dice: number[];
  modifier: number;
  total: number;
  mode: string;
};
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Unable to complete the request.";
const number = (value: string) => Number(value) || 0;
export function CharacterWorkspace({ campaignCode = "" }: { campaignCode?: string }) {
  const [data, setData] = useState<{ characters: Row[]; campaigns: Campaign[] } | null>(null),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0),
    [creating, setCreating] = useState(false);
  const dirtyRef = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    accountRequest<{ characters: Row[]; campaigns: Campaign[] }>("sheets", undefined, c.signal)
      .then((d) => {
        setData(d);
        setError("");
        setSelected(
          (v) =>
            v ||
            d.characters.find((r) => r.campaign_code === campaignCode)?.id ||
            d.characters[0]?.id ||
            "",
        );
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [reload, campaignCode]);
  async function create(sheet = blankSheet()) {
    if (dirtyRef.current && !window.confirm("Discard unsaved changes to open a new character?"))
      return;
    setCreating(true);
    try {
      const r = await accountRequest<{ id: string }>("sheets/save", { sheet });
      setSelected(r.id);
      setReload((n) => n + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setCreating(false);
    }
  }
  return (
    <section className="character-play" aria-label="Interactive characters">
      <header className="character-heading">
        <div>
          <p className="eyebrow">YOUR ADVENTURER, EVERYWHERE</p>
          <h1>Character sheets</h1>
          <p>Play from your phone or computer. Changes save to your member account.</p>
        </div>
        <Link to="/account">My account</Link>
      </header>
      {error && (
        <p role="alert" className="character-error">
          {error}
        </p>
      )}
      {!data ? (
        loading ? (
          <p>Opening your characters…</p>
        ) : (
          <p>
            <Link to="/account">Sign in to use account character sheets.</Link> Your existing guest
            campaign and imported sheets remain available.
          </p>
        )
      ) : (
        <>
          <div className="character-toolbar">
            <label>
              Character
              <select
                aria-label="Choose character"
                value={selected}
                onChange={(e) => {
                  if (
                    !dirtyRef.current ||
                    window.confirm("Discard unsaved changes and switch characters?")
                  )
                    setSelected(e.target.value);
                }}
              >
                <option value="">Choose a character</option>
                {data.characters.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.body.name}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={creating} onClick={() => void create()}>
              Create character
            </button>
            <button disabled={loading} onClick={() => setReload((n) => n + 1)}>
              Refresh character list
            </button>
          </div>
          <details>
            <summary>Import an existing character</summary>
            <p>
              Import a Lootsplit sheet JSON or a supported 2014 PDF/JSON as a new character. Review
              the result before assigning it. Original PDFs remain on your device; extracted sheet
              fields are saved to your account.
            </p>
            <input
              aria-label="Import account character"
              type="file"
              accept=".json,.pdf"
              disabled={creating}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  if (f.size > 10 * 1024 * 1024) throw Error("Use a file smaller than 10 MB.");
                  if (f.name.toLowerCase().endsWith(".json")) {
                    const raw = JSON.parse(await f.text());
                    if (raw.version === 1) {
                      await create(sheetSchema.parse(raw));
                      return;
                    }
                  }
                  const old = await readCharacterSheet(f),
                    next = blankSheet();
                  next.name = old.name || f.name;
                  next.species = old.race;
                  next.classes = old.classLevel;
                  next.background = old.background;
                  next.features = old.features;
                  next.description = [old.traits, old.ideals, old.bonds, old.flaws]
                    .filter(Boolean)
                    .join("\n");
                  next.notes = [old.attacks, old.equipment, old.spells, old.proficiencies]
                    .filter(Boolean)
                    .join("\n\n");
                  next.coins = old.coins;
                  for (const a of abilities as Ability[]) {
                    const score = Number(old.abilities[a].score);
                    if (score >= 1 && score <= 30) next.scores[a] = score;
                    if (old.saves[a].trim() && Number.isFinite(Number(old.saves[a])))
                      next.saves[a].extra = Number(old.saves[a]) - modifier(next.scores[a]);
                  }
                  for (const skill of old.skills) {
                    const a = skills[skill.name as keyof typeof skills] as Ability;
                    if (a && Number.isFinite(Number(skill.bonus)))
                      next.skills[skill.name] = {
                        rank: 0,
                        extra: Number(skill.bonus) - modifier(next.scores[a]),
                      };
                  }
                  if (Number(old.armorClass) > 0) next.ac = Number(old.armorClass);
                  if (Number(old.hitPoints) > 0) next.hp = next.maxHp = Number(old.hitPoints);
                  if (Number(old.proficiency) > 0) next.proficiency = Number(old.proficiency);
                  next.hitDice = old.hitDice;
                  next.speed = old.speed || next.speed;
                  next.source =
                    "Imported character sheet; review stats and convert imported notes into attacks, equipment and spells as needed.";
                  await create(sheetSchema.parse(next));
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            />
          </details>
          {selected && (
            <CharacterEditor
              key={selected}
              id={selected}
              campaigns={data.campaigns}
              changed={() => setReload((n) => n + 1)}
              onDirty={(v) => {
                dirtyRef.current = v;
              }}
            />
          )}
          {data.campaigns.some((c) => c.role === "dm") && (
            <DmCampaigns campaigns={data.campaigns.filter((c) => c.role === "dm")} />
          )}
        </>
      )}
    </section>
  );
}
function CharacterEditor({
  id,
  campaigns,
  changed,
  onDirty,
}: {
  id: string;
  campaigns: Campaign[];
  changed: () => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null),
    [sheet, setSheet] = useState<Sheet | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0),
    [tab, setTab] = useState("combat"),
    [code, setCode] = useState(""),
    [purse, setPurse] = useState(""),
    [rollRefresh, setRollRefresh] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    accountRequest<Detail>("sheets/detail", { id }, c.signal)
      .then((d) => {
        setDetail(d);
        setSheet(d.body);
        setCode(d.campaign_code);
        setPurse(d.purse_id);
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e));
      });
    return () => c.abort();
  }, [id, reload]);
  const dirty = !!sheet && JSON.stringify(sheet) !== JSON.stringify(detail?.body);
  useEffect(() => {
    onDirty?.(dirty);
    return () => onDirty?.(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const navigate = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (
        target?.closest("a[href]") &&
        !window.confirm("Discard unsaved character changes and leave this sheet?")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!sheet || !detail) return;
    setBusy(true);
    setError("");
    try {
      const parsed = sheetSchema.parse(sheet);
      await accountRequest("sheets/save", { id, sheet: parsed, revision: detail.revision });
      setNotice("Character saved to your account.");
      setDetail({ ...detail, body: parsed, revision: detail.revision + 1 });
      setSheet(parsed);
      changed();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function assign() {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await accountRequest("sheets/assign", {
        id,
        code,
        purseId: purse,
        revision: detail.revision,
      });
      setNotice(
        code
          ? "Character assigned. Campaign inventory and currency are shown from the shared ledger."
          : "Character unassigned. Previous campaign rolls remain in that campaign’s log.",
      );
      setReload((n) => n + 1);
      changed();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (!sheet || !detail)
    return <p role={error ? "alert" : "status"}>{error || "Loading character…"}</p>;
  const editable = detail.editable;
  const set = <K extends keyof Sheet>(key: K, value: Sheet[K]) =>
    setSheet({ ...sheet, [key]: value });
  const rollButton = (label: string, kind: string, key = "") => (
    <QuickRoll
      label={label}
      kind={kind}
      rollKey={key}
      detail={detail}
      disabled={dirty || busy || !!detail.assignmentError}
      onRoll={() => setRollRefresh((n) => n + 1)}
    />
  );
  const bonusFor = (a: Ability, rank = 0, extra = 0) =>
    modifier(sheet.scores[a]) + rank * sheet.proficiency + extra;
  const trained = (name: string, group: "saves" | "skills", a: Ability) => {
    const row = group === "saves" ? sheet.saves[a] : sheet.skills[name] || { rank: 0, extra: 0 };
    return (
      <div className="skill-row" key={name}>
        {rollButton(
          `${name} ${signed(bonusFor(a, row.rank, row.extra))}`,
          group === "saves" ? "save" : "skill",
          group === "saves" ? a : name,
        )}
        <select
          aria-label={`${name} proficiency`}
          disabled={!editable}
          value={row.rank}
          onChange={(e) =>
            set(group, {
              ...sheet[group],
              [group === "saves" ? a : name]: { ...row, rank: number(e.target.value) },
            })
          }
        >
          <option value={0}>Untrained</option>
          <option value={1}>Proficient</option>
          {group === "skills" && <option value={2}>Expertise</option>}
        </select>
        <input
          aria-label={`${name} extra bonus`}
          type="number"
          min={-100}
          max={100}
          disabled={!editable}
          value={row.extra}
          onChange={(e) =>
            set(group, {
              ...sheet[group],
              [group === "saves" ? a : name]: { ...row, extra: number(e.target.value) },
            })
          }
        />
      </div>
    );
  };
  return (
    <article className="play-sheet">
      <div className="character-title">
        {sheet.portrait && <img src={sheet.portrait} alt="Character portrait" />}
        <div>
          <p className="eyebrow">
            LEVEL {sheet.level} · {sheet.edition}
          </p>
          <h2>{sheet.name}</h2>
          <p>
            {[sheet.species, sheet.classes, sheet.background].filter(Boolean).join(" · ") ||
              "Build your adventurer in Character details."}
          </p>
        </div>
      </div>
      <div className="character-savebar">
        <strong role="status">
          {dirty
            ? "Unsaved changes — save before rolling"
            : editable
              ? "Saved character"
              : "DM read-only view"}
        </strong>
        {editable && (
          <button disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? "Saving…" : "Save character"}
          </button>
        )}
        <button
          onClick={() =>
            downloadJson(`${sheet.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-character.json`, sheet)
          }
        >
          Export sheet / draft
        </button>
        <button
          disabled={busy}
          onClick={() => {
            if (!dirty || window.confirm("Discard unsaved changes and reload this character?"))
              setReload((n) => n + 1);
          }}
        >
          Reload sheet
        </button>
      </div>
      {error && (
        <p role="alert" className="character-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {detail.assignmentError && (
        <p role="alert">
          {detail.assignmentError} Unassign the character to continue standalone play.
        </p>
      )}
      <fieldset disabled={busy} className="sheet-edit-fields">
        <nav className="sheet-tabs" aria-label="Character sheet sections">
          {[
            ["combat", "Combat"],
            ["abilities", "Abilities & skills"],
            ["spells", "Spells"],
            ["gear", "Inventory & currency"],
            ["details", "Character details"],
          ].map(([key, label]) => (
            <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="sheet-vitals">
          <strong>AC {sheet.ac}</strong>
          <strong>
            HP {sheet.hp} / {sheet.maxHp}
            {sheet.tempHp ? ` (+${sheet.tempHp} temp)` : ""}
          </strong>
          <strong>Speed {sheet.speed}</strong>
          <strong>Proficiency {signed(sheet.proficiency)}</strong>
        </div>
        {tab === "combat" && (
          <>
            <div className="sheet-grid">
              <section className="sheet-card">
                <h3>Health & defense</h3>
                <div className="field-grid">
                  {(["hp", "maxHp", "tempHp", "ac"] as const).map((k, i) => (
                    <Num
                      key={k}
                      label={["Current HP", "Maximum HP", "Temporary HP", "Armor class"][i]}
                      value={sheet[k]}
                      disabled={!editable}
                      onChange={(v) => set(k, v)}
                    />
                  ))}
                </div>
                <HealthActions sheet={sheet} change={setSheet} disabled={!editable} />
                <Text
                  label="Conditions"
                  value={sheet.conditions}
                  disabled={!editable}
                  onChange={(v) => set("conditions", v)}
                />
                <div className="field-grid">
                  <Num
                    label="Death save successes"
                    value={sheet.deathSuccesses}
                    max={3}
                    disabled={!editable}
                    onChange={(v) => set("deathSuccesses", v)}
                  />
                  <Num
                    label="Death save failures"
                    value={sheet.deathFailures}
                    max={3}
                    disabled={!editable}
                    onChange={(v) => set("deathFailures", v)}
                  />
                </div>
                {rollButton("Roll death saving throw", "death")}
                <p>
                  Record the outcome in the counters above; rolls do not apply death-save rules
                  automatically.
                </p>
                <Check
                  label="Inspiration"
                  value={sheet.inspiration}
                  disabled={!editable}
                  onChange={(v) => set("inspiration", v)}
                />
              </section>
              <section className="sheet-card">
                <h3>Initiative & attacks</h3>
                {rollButton(
                  `Initiative ${signed(bonusFor("dex", 0, sheet.initiative))}`,
                  "initiative",
                )}
                <Num
                  label="Initiative extra bonus"
                  value={sheet.initiative}
                  min={-100}
                  disabled={!editable}
                  onChange={(v) => set("initiative", v)}
                />
                {sheet.attacks.map((a, i) => (
                  <div className="sheet-row" key={i}>
                    <Text
                      label={`Attack ${i + 1} name`}
                      value={a.name}
                      disabled={!editable}
                      onChange={(v) =>
                        set(
                          "attacks",
                          sheet.attacks.map((r, j) => (j === i ? { ...r, name: v } : r)),
                        )
                      }
                    />
                    <div className="field-grid">
                      <Num
                        label={`${a.name} attack bonus`}
                        value={a.bonus}
                        min={-100}
                        disabled={!editable}
                        onChange={(v) =>
                          set(
                            "attacks",
                            sheet.attacks.map((r, j) => (j === i ? { ...r, bonus: v } : r)),
                          )
                        }
                      />
                      <Text
                        label={`${a.name} damage dice`}
                        value={a.damage}
                        disabled={!editable}
                        onChange={(v) =>
                          set(
                            "attacks",
                            sheet.attacks.map((r, j) => (j === i ? { ...r, damage: v } : r)),
                          )
                        }
                      />
                    </div>
                    <Text
                      label={`${a.name} notes`}
                      value={a.notes}
                      disabled={!editable}
                      onChange={(v) =>
                        set(
                          "attacks",
                          sheet.attacks.map((r, j) => (j === i ? { ...r, notes: v } : r)),
                        )
                      }
                    />
                    <div className="character-toolbar">
                      {rollButton(`Roll ${a.name} attack`, "attack", String(i))}
                      {rollButton(`Roll ${a.name} damage`, "damage", String(i))}
                      {editable && (
                        <button
                          onClick={() =>
                            set(
                              "attacks",
                              sheet.attacks.filter((_, j) => j !== i),
                            )
                          }
                        >
                          Remove attack
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {editable && (
                  <button
                    onClick={() =>
                      set("attacks", [
                        ...sheet.attacks,
                        { name: "New attack", bonus: 0, damage: "1d6", notes: "" },
                      ])
                    }
                  >
                    Add attack
                  </button>
                )}
              </section>
            </div>
            <section className="sheet-card">
              <h3>Limited-use resources</h3>
              <Text
                label="Hit dice"
                value={sheet.hitDice}
                disabled={!editable}
                onChange={(v) => set("hitDice", v)}
              />
              {sheet.resources.map((r, i) => (
                <div className="resource-row" key={i}>
                  <Text
                    label={`Resource ${i + 1} name`}
                    value={r.name}
                    disabled={!editable}
                    onChange={(v) =>
                      set(
                        "resources",
                        sheet.resources.map((x, j) => (j === i ? { ...x, name: v } : x)),
                      )
                    }
                  />
                  <Num
                    label={`${r.name} remaining`}
                    value={r.current}
                    disabled={!editable}
                    onChange={(v) =>
                      set(
                        "resources",
                        sheet.resources.map((x, j) => (j === i ? { ...x, current: v } : x)),
                      )
                    }
                  />
                  <Num
                    label={`${r.name} maximum`}
                    value={r.max}
                    disabled={!editable}
                    onChange={(v) =>
                      set(
                        "resources",
                        sheet.resources.map((x, j) => (j === i ? { ...x, max: v } : x)),
                      )
                    }
                  />
                  <label>
                    Recovery
                    <select
                      aria-label={`${r.name} recovery`}
                      disabled={!editable}
                      value={r.recovery}
                      onChange={(e) =>
                        set(
                          "resources",
                          sheet.resources.map((x, j) =>
                            j === i
                              ? { ...x, recovery: e.target.value as "short" | "long" | "manual" }
                              : x,
                          ),
                        )
                      }
                    >
                      {["short", "long", "manual"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={!editable || r.current === 0}
                    onClick={() =>
                      set(
                        "resources",
                        sheet.resources.map((x, j) =>
                          j === i ? { ...x, current: x.current - 1 } : x,
                        ),
                      )
                    }
                  >
                    Use {r.name}
                  </button>
                  {editable && (
                    <button
                      onClick={() =>
                        set(
                          "resources",
                          sheet.resources.filter((_, j) => j !== i),
                        )
                      }
                    >
                      Remove resource
                    </button>
                  )}
                </div>
              ))}
              {editable && (
                <>
                  <button
                    onClick={() =>
                      set("resources", [
                        ...sheet.resources,
                        { name: "New resource", current: 1, max: 1, recovery: "long" },
                      ])
                    }
                  >
                    Add resource
                  </button>
                  <div className="character-toolbar">
                    <button
                      onClick={() =>
                        set(
                          "resources",
                          sheet.resources.map((r) =>
                            r.recovery === "short" ? { ...r, current: r.max } : r,
                          ),
                        )
                      }
                    >
                      Restore short-rest resources
                    </button>
                    <button
                      onClick={() => {
                        if (
                          window.confirm("Restore HP, spell slots, and short/long-rest resources?")
                        )
                          setSheet({
                            ...sheet,
                            hp: sheet.maxHp,
                            deathSuccesses: 0,
                            deathFailures: 0,
                            slots: sheet.slots.map((s) => ({ ...s, used: 0 })),
                            resources: sheet.resources.map((r) =>
                              r.recovery !== "manual" ? { ...r, current: r.max } : r,
                            ),
                          });
                      }}
                    >
                      Long rest
                    </button>
                  </div>
                  <p>
                    Hit dice, conditions and custom rules are managed manually. Save after resting.
                  </p>
                </>
              )}
            </section>
          </>
        )}
        {tab === "abilities" && (
          <>
            <div className="ability-grid">
              {(abilities as Ability[]).map((a) => (
                <section className="sheet-card" key={a}>
                  <Num
                    label={a.toUpperCase()}
                    value={sheet.scores[a]}
                    min={1}
                    max={30}
                    disabled={!editable}
                    onChange={(v) => set("scores", { ...sheet.scores, [a]: v })}
                  />
                  {rollButton(
                    `Roll ${a.toUpperCase()} ${signed(modifier(sheet.scores[a]))}`,
                    "ability",
                    a,
                  )}
                </section>
              ))}
            </div>
            <div className="sheet-grid">
              <section className="sheet-card">
                <h3>Saving throws</h3>
                {(abilities as Ability[]).map((a) => trained(a.toUpperCase(), "saves", a))}
              </section>
              <section className="sheet-card">
                <h3>Skills</h3>
                <p>Training adds proficiency; the final field is an extra bonus.</p>
                {Object.entries(skills).map(([name, a]) => trained(name, "skills", a as Ability))}
                <p>
                  Passive Perception:{" "}
                  {10 +
                    bonusFor("wis", sheet.skills.Perception?.rank, sheet.skills.Perception?.extra)}
                </p>
              </section>
            </div>
          </>
        )}
        {tab === "spells" && (
          <section className="sheet-card">
            <h3>Spellcasting</h3>
            <label>
              Spellcasting ability
              <select
                aria-label="Spellcasting ability"
                disabled={!editable}
                value={sheet.spellAbility}
                onChange={(e) => set("spellAbility", e.target.value as Ability)}
              >
                {abilities.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            <p>Spell save DC: {8 + bonusFor(sheet.spellAbility, 1, sheet.spellDcExtra)}</p>
            {rollButton(
              `Spell attack ${signed(bonusFor(sheet.spellAbility, 1, sheet.spellAttackExtra))}`,
              "spellAttack",
            )}
            <div className="field-grid">
              <Num
                label="Spell attack extra bonus"
                value={sheet.spellAttackExtra}
                min={-100}
                disabled={!editable}
                onChange={(v) => set("spellAttackExtra", v)}
              />
              <Num
                label="Spell DC extra bonus"
                value={sheet.spellDcExtra}
                min={-100}
                disabled={!editable}
                onChange={(v) => set("spellDcExtra", v)}
              />
            </div>
            <h4>Spell slots</h4>
            {sheet.slots.map((slot, i) => (
              <div className="resource-row" key={slot.level}>
                <strong>Level {slot.level}</strong>
                <Num
                  label={`Level ${slot.level} slots maximum`}
                  value={slot.max}
                  max={99}
                  disabled={!editable}
                  onChange={(v) =>
                    set(
                      "slots",
                      sheet.slots.map((x, j) => (j === i ? { ...x, max: v } : x)),
                    )
                  }
                />
                <Num
                  label={`Level ${slot.level} slots used`}
                  value={slot.used}
                  max={99}
                  disabled={!editable}
                  onChange={(v) =>
                    set(
                      "slots",
                      sheet.slots.map((x, j) => (j === i ? { ...x, used: v } : x)),
                    )
                  }
                />
                <button
                  disabled={!editable || slot.used >= slot.max}
                  onClick={() =>
                    set(
                      "slots",
                      sheet.slots.map((x, j) => (j === i ? { ...x, used: x.used + 1 } : x)),
                    )
                  }
                >
                  Use level {slot.level} slot
                </button>
              </div>
            ))}
            {editable && sheet.slots.length < 9 && (
              <button
                onClick={() => {
                  const level = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(
                    (l) => !sheet.slots.some((s) => s.level === l),
                  )!;
                  set("slots", [...sheet.slots, { level, max: 0, used: 0 }]);
                }}
              >
                Add spell slot level
              </button>
            )}
            <p>
              Spend slots explicitly, including for upcasting. Spell rolls do not spend slots or
              apply effects automatically.
            </p>
            {sheet.spells.map((s, i) => (
              <details key={i} className="sheet-row">
                <summary>
                  {s.name} · {s.level === 0 ? "Cantrip" : `Level ${s.level}`}{" "}
                  {s.prepared ? "· Prepared" : ""}
                </summary>
                <Text
                  label={`Spell ${i + 1} name`}
                  value={s.name}
                  disabled={!editable}
                  onChange={(v) =>
                    set(
                      "spells",
                      sheet.spells.map((x, j) => (j === i ? { ...x, name: v } : x)),
                    )
                  }
                />
                <Num
                  label={`${s.name} level`}
                  value={s.level}
                  max={9}
                  disabled={!editable}
                  onChange={(v) =>
                    set(
                      "spells",
                      sheet.spells.map((x, j) => (j === i ? { ...x, level: v } : x)),
                    )
                  }
                />
                <Check
                  label={`Prepare ${s.name}`}
                  value={s.prepared}
                  disabled={!editable}
                  onChange={(v) =>
                    set(
                      "spells",
                      sheet.spells.map((x, j) => (j === i ? { ...x, prepared: v } : x)),
                    )
                  }
                />
                <Text
                  label={`${s.name} roll formula`}
                  value={s.formula}
                  disabled={!editable}
                  onChange={(v) =>
                    set(
                      "spells",
                      sheet.spells.map((x, j) => (j === i ? { ...x, formula: v } : x)),
                    )
                  }
                />
                <Text
                  multiline
                  label={`${s.name} description`}
                  value={s.description}
                  disabled={!editable}
                  onChange={(v) =>
                    set(
                      "spells",
                      sheet.spells.map((x, j) => (j === i ? { ...x, description: v } : x)),
                    )
                  }
                />
                <p className="character-source">{s.source}</p>
                {s.formula && rollButton(`Roll ${s.name}`, "spell", String(i))}
                {editable && (
                  <button
                    onClick={() =>
                      set(
                        "spells",
                        sheet.spells.filter((_, j) => j !== i),
                      )
                    }
                  >
                    Remove spell
                  </button>
                )}
              </details>
            ))}
            {editable && (
              <>
                <button
                  onClick={() =>
                    set("spells", [
                      ...sheet.spells,
                      {
                        name: "New spell",
                        level: 0,
                        prepared: false,
                        description: "",
                        formula: "",
                        source: "Custom content",
                      },
                    ])
                  }
                >
                  Add custom spell
                </button>
                <ReferenceSearch
                  onAdd={(entry) => {
                    const level = Number(
                      entry.facts.find((f) => f.startsWith("Spell level:"))?.split(":")[1] || 0,
                    );
                    set("spells", [
                      ...sheet.spells,
                      {
                        name: entry.name,
                        level,
                        prepared: false,
                        description: [...entry.facts, entry.description].join("\n\n"),
                        formula: "",
                        source: entry.attribution + "\n" + entry.url,
                      },
                    ]);
                  }}
                />
              </>
            )}
          </section>
        )}
        {tab === "gear" && (
          <section className="sheet-card">
            <h3>Inventory & currency</h3>
            {detail.campaign ? (
              <>
                <p>Live campaign ledger. Use Party or Market to move money and items.</p>
                <div className="sheet-vitals">
                  {Object.entries(detail.campaign.coins).map(([k, v]) => (
                    <strong key={k}>
                      {v} {k}
                    </strong>
                  ))}
                </div>
                <ul>
                  {detail.campaign.holdings.map((h) => (
                    <li key={h.id}>
                      {h.name} × {h.quantity}
                    </li>
                  ))}
                </ul>
                <Link to="/party" search={{ action: "" }}>
                  Open party inventory
                </Link>
                <p>
                  Use My account to resume this campaign before making transactions. Reload sheet to
                  refresh ledger totals.
                </p>
              </>
            ) : (
              <>
                <p>
                  Standalone character currency. Assigning a campaign shows its existing ledger and
                  does not transfer these coins.
                </p>
                <div className="field-grid">
                  {(Object.keys(sheet.coins) as (keyof Sheet["coins"])[]).map((k) => (
                    <Num
                      key={k}
                      label={k.toUpperCase()}
                      value={sheet.coins[k]}
                      disabled={!editable}
                      onChange={(v) => set("coins", { ...sheet.coins, [k]: v })}
                    />
                  ))}
                </div>
              </>
            )}
            <h4>Personal equipment & loadout</h4>
            <p>
              Track worn/carried gear and custom items here. These notes do not create tradeable
              campaign inventory.
            </p>
            {sheet.equipment.map((item, i) => (
              <div className="sheet-row" key={i}>
                <Text
                  label={`Item ${i + 1} name`}
                  value={item.name}
                  disabled={!editable}
                  onChange={(v) =>
                    set(
                      "equipment",
                      sheet.equipment.map((x, j) => (j === i ? { ...x, name: v } : x)),
                    )
                  }
                />
                <div className="field-grid">
                  <Num
                    label={`${item.name} quantity`}
                    value={item.quantity}
                    disabled={!editable}
                    onChange={(v) =>
                      set(
                        "equipment",
                        sheet.equipment.map((x, j) => (j === i ? { ...x, quantity: v } : x)),
                      )
                    }
                  />
                  <Num
                    label={`${item.name} unit weight`}
                    value={item.weight}
                    step="any"
                    disabled={!editable}
                    onChange={(v) =>
                      set(
                        "equipment",
                        sheet.equipment.map((x, j) => (j === i ? { ...x, weight: v } : x)),
                      )
                    }
                  />
                </div>
                <Check
                  label={`Equip ${item.name}`}
                  value={item.equipped}
                  disabled={!editable}
                  onChange={(v) =>
                    set(
                      "equipment",
                      sheet.equipment.map((x, j) => (j === i ? { ...x, equipped: v } : x)),
                    )
                  }
                />
                <Text
                  label={`${item.name} notes`}
                  value={item.notes}
                  disabled={!editable}
                  onChange={(v) =>
                    set(
                      "equipment",
                      sheet.equipment.map((x, j) => (j === i ? { ...x, notes: v } : x)),
                    )
                  }
                />
                {editable && (
                  <button
                    onClick={() =>
                      set(
                        "equipment",
                        sheet.equipment.filter((_, j) => j !== i),
                      )
                    }
                  >
                    Remove item
                  </button>
                )}
              </div>
            ))}
            <p>
              Loadout weight:{" "}
              {sheet.equipment.reduce((n, i) => n + i.quantity * i.weight, 0).toLocaleString()}
            </p>
            {editable && (
              <button
                onClick={() =>
                  set("equipment", [
                    ...sheet.equipment,
                    { name: "New item", quantity: 1, weight: 0, equipped: false, notes: "" },
                  ])
                }
              >
                Add equipment
              </button>
            )}
          </section>
        )}
        {tab === "details" && (
          <section className="sheet-card">
            <h3>Character details</h3>
            <div className="field-grid">
              {(["name", "species", "classes", "background", "speed"] as const).map((k) => (
                <Text
                  key={k}
                  label={
                    {
                      name: "Character name",
                      species: "Species",
                      classes: "Classes / subclasses",
                      background: "Background",
                      speed: "Speed",
                    }[k]
                  }
                  value={sheet[k]}
                  disabled={!editable}
                  onChange={(v) => set(k, v)}
                />
              ))}
              <Num
                label="Character level"
                value={sheet.level}
                min={1}
                max={20}
                disabled={!editable}
                onChange={(v) => set("level", v)}
              />
              <Num
                label="Proficiency bonus"
                value={sheet.proficiency}
                max={20}
                disabled={!editable}
                onChange={(v) => set("proficiency", v)}
              />
              <label>
                Rules edition
                <select
                  aria-label="Rules edition"
                  disabled={!editable}
                  value={sheet.edition}
                  onChange={(e) => set("edition", e.target.value as Sheet["edition"])}
                >
                  {["2014", "2024", "custom"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
            <p>
              Stats and class features are editable. Level changes do not automatically change
              proficiency, HP, spells or features.
            </p>
            {editable && (
              <label>
                Portrait
                <input
                  aria-label="Character portrait"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    if (f.size > 350000) {
                      setError("Choose a portrait smaller than 350 KB.");
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => set("portrait", String(reader.result));
                    reader.readAsDataURL(f);
                  }}
                />
              </label>
            )}
            {(["description", "features", "notes", "source"] as const).map((k) => (
              <Text
                multiline
                key={k}
                label={
                  {
                    description: "Personality & background",
                    features: "Features, traits & custom content",
                    notes: "Character notes",
                    source: "Source credits",
                  }[k]
                }
                value={sheet[k]}
                disabled={!editable}
                onChange={(v) => set(k, v)}
              />
            ))}
            {editable && (
              <>
                <h4>Campaign assignment</h4>
                <p>
                  A character belongs to one campaign at a time. The campaign DM can view the
                  assigned sheet; its rolls are visible to campaign members. Save changes before
                  assigning.
                </p>
                <label>
                  Campaign
                  <select
                    aria-label="Assign campaign"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value);
                      setPurse("");
                    }}
                  >
                    <option value="">Standalone character</option>
                    {campaigns.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} · {c.code}
                      </option>
                    ))}
                  </select>
                </label>
                {code && (
                  <label>
                    Campaign character
                    <select
                      aria-label="Assign campaign character"
                      value={purse}
                      onChange={(e) => setPurse(e.target.value)}
                    >
                      <option value="">Choose controlled character</option>
                      {campaigns
                        .find((c) => c.code === code)
                        ?.purses.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <button
                  disabled={busy || dirty || (!!code && !purse)}
                  onClick={() => void assign()}
                >
                  Save campaign assignment
                </button>
                <p>Missing a campaign? Save its membership from My account first.</p>
              </>
            )}
          </section>
        )}
        <section className="sheet-card">
          <h3>Dice tray</h3>
          <DiceTray
            detail={detail}
            disabled={dirty || busy || !!detail.assignmentError}
            onRoll={() => setRollRefresh((n) => n + 1)}
          />
        </section>
        <RollLog
          id={id}
          code={detail.assignmentError ? "" : detail.campaign_code}
          refresh={rollRefresh}
        />
      </fieldset>
    </article>
  );
}
function Num({
  label,
  value,
  onChange,
  disabled = false,
  min = 0,
  max = 9999,
  step = "1",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: string;
}) {
  return (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(number(e.target.value))}
      />
    </label>
  );
}
function Text({
  label,
  value,
  onChange,
  disabled = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  multiline?: boolean;
}) {
  return (
    <label>
      {label}
      {multiline ? (
        <textarea
          aria-label={label}
          rows={4}
          maxLength={12000}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          aria-label={label}
          maxLength={120}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
function Check({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="character-check">
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
function HealthActions({
  sheet,
  change,
  disabled,
}: {
  sheet: Sheet;
  change: (s: Sheet) => void;
  disabled: boolean;
}) {
  const [amount, setAmount] = useState(1);
  return (
    <div className="character-toolbar">
      <Num
        label="Damage / healing amount"
        value={amount}
        onChange={setAmount}
        disabled={disabled}
      />
      <button
        disabled={disabled || amount < 0}
        onClick={() => {
          const dmg = Math.max(0, Math.floor(amount));
          change({
            ...sheet,
            tempHp: Math.max(0, sheet.tempHp - dmg),
            hp: Math.max(0, sheet.hp - Math.max(0, dmg - sheet.tempHp)),
          });
        }}
      >
        Apply damage
      </button>
      <button
        disabled={disabled || amount < 0}
        onClick={() =>
          change({
            ...sheet,
            hp: Math.min(sheet.maxHp, sheet.hp + Math.max(0, Math.floor(amount))),
          })
        }
      >
        Heal
      </button>
    </div>
  );
}
function QuickRoll({
  label,
  kind,
  rollKey,
  detail,
  disabled,
  onRoll,
}: {
  label: string;
  kind: string;
  rollKey: string;
  detail: Detail;
  disabled: boolean;
  onRoll: () => void;
}) {
  const [mode, setMode] = useState("normal"),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState("");
  const retry = useRef({ signature: "", key: "" });
  async function roll() {
    setBusy(true);
    try {
      const signature = JSON.stringify([detail.id, detail.revision, kind, rollKey, mode]);
      if (retry.current.signature !== signature)
        retry.current = { signature, key: crypto.randomUUID() };
      const r = await accountRequest<Roll>("sheets/roll", {
        id: detail.id,
        revision: detail.revision,
        kind,
        key: rollKey,
        mode,
        requestKey: retry.current.key,
      });
      setResult(`${r.total} · ${r.dice.join(", ")} ${signed(r.modifier)} · ${r.mode}`);
      retry.current = { signature: "", key: "" };
      onRoll();
    } catch (e) {
      setResult(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  let d20 = false;
  try {
    d20 = rollSpec(detail.body, kind, rollKey).formula.startsWith("1d20");
  } catch {
    /* An incomplete custom formula is validated when rolled. */
  }
  return (
    <div className="quick-roll">
      <button disabled={disabled || busy} onClick={() => void roll()}>
        {label}
      </button>
      {d20 && (
        <select
          aria-label={`${label} mode`}
          value={mode}
          disabled={busy}
          onChange={(e) => {
            setMode(e.target.value);
            retry.current = { signature: "", key: "" };
          }}
        >
          {["normal", "advantage", "disadvantage"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      )}
      {result && <output aria-live="polite">{result}</output>}
    </div>
  );
}
function DiceTray({
  detail,
  disabled,
  onRoll,
}: {
  detail: Detail;
  disabled: boolean;
  onRoll: () => void;
}) {
  const [formula, setFormula] = useState("1d20"),
    [label, setLabel] = useState("Custom roll"),
    [manual, setManual] = useState(false),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState("");
  const retry = useRef({ signature: "", key: "" });
  async function roll(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const payload = {
      id: detail.id,
      revision: detail.revision,
      kind: "custom",
      formula,
      label,
      manual,
      total,
    };
    const signature = JSON.stringify(payload);
    if (retry.current.signature !== signature)
      retry.current = { signature, key: crypto.randomUUID() };
    try {
      const r = await accountRequest<Roll>("sheets/roll", {
        ...payload,
        requestKey: retry.current.key,
      });
      setResult(
        `${r.label}: ${r.total} · ${r.source === "manual" ? "Manual result" : `Server roll [${r.dice.join(", ")}] ${signed(r.modifier)}`}`,
      );
      retry.current = { signature: "", key: "" };
      onRoll();
    } catch (e) {
      setResult(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const allowed = !detail.campaign_code || !!detail.campaign?.manualAllowed;
  return (
    <form onSubmit={roll}>
      <div className="field-grid">
        <Text label="Roll label" value={label} onChange={setLabel} />
        <Text label="Dice formula" value={formula} onChange={setFormula} />
      </div>
      <p>Examples: 1d20+5, 2d6+3. Online dice are generated and recorded by the server.</p>
      <Check label="Enter a manual total" value={manual} disabled={!allowed} onChange={setManual} />
      {!allowed && <p>The DM has disabled manual rolls. Reload the sheet after a policy change.</p>}
      {manual && (
        <Num
          label="Manual roll total"
          value={total}
          min={-100000}
          max={100000}
          onChange={setTotal}
        />
      )}
      <button disabled={disabled || busy || (manual && !allowed)}>
        {busy ? "Recording…" : manual ? "Record manual roll" : "Roll dice"}
      </button>
      {result && <p role="status">{result}</p>}
    </form>
  );
}
function RollLog({
  id = "",
  code = "",
  refresh = 0,
}: {
  id?: string;
  code?: string;
  refresh?: number;
}) {
  const [rolls, setRolls] = useState<Roll[]>([]),
    [more, setMore] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tick, setTick] = useState(0);
  const generation = useRef(0);
  async function load(older = false) {
    const gen = generation.current;
    setBusy(true);
    try {
      const d = await accountRequest<{ rolls: Roll[]; more: boolean }>("sheets/log", {
        id,
        code,
        ...(older && rolls.length ? { before: rolls[rolls.length - 1].seq } : {}),
      });
      if (gen !== generation.current) return;
      setRolls((r) => (older ? [...r, ...d.rolls] : d.rolls));
      setMore(d.more);
      setError("");
    } catch (e) {
      if (gen === generation.current) setError(errorText(e));
    } finally {
      if (gen === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    generation.current++;
    setRolls([]);
    void load();
    return () => {
      generation.current++;
    };
  }, [id, code, refresh, tick]);
  return (
    <section className="sheet-card">
      <div className="character-toolbar">
        <h3>{code ? "Campaign roll log" : "Private roll log"}</h3>
        <button disabled={busy} onClick={() => setTick((n) => n + 1)}>
          Refresh roll log
        </button>
      </div>
      <p>
        {code ? "Visible to current campaign members." : "Visible only to your account."} Results
        are retained; load older rolls to review earlier sessions.
      </p>
      {error && <p role="alert">{error}</p>}
      <ol className="roll-log">
        {rolls.map((r) => (
          <li key={r.id}>
            <strong className="roll-total">{r.total}</strong>
            <div>
              <strong>
                {r.character} · {r.label}
              </strong>
              <p>
                {r.source === "manual"
                  ? "MANUAL RESULT"
                  : `SERVER ROLL · [${r.dice.join(", ")}] ${signed(r.modifier)}`}{" "}
                · {r.formula} · {r.mode}
              </p>
              <small>
                {r.actor} · {new Date(r.at).toLocaleString()}
              </small>
            </div>
          </li>
        ))}
      </ol>
      {!rolls.length && !busy && !error && <p>No rolls yet.</p>}
      {more && (
        <button disabled={busy} onClick={() => void load(true)}>
          Load older rolls
        </button>
      )}
    </section>
  );
}
function DmCampaigns({ campaigns }: { campaigns: Campaign[] }) {
  const [code, setCode] = useState(campaigns[0]?.code || ""),
    [data, setData] = useState<{
      characters: { id: string; name: string }[];
      manualAllowed: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setSelected("");
    accountRequest<NonNullable<typeof data>>("sheets/campaign", { code }, c.signal)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e));
      });
    return () => c.abort();
  }, [code, reload]);
  return (
    <section className="sheet-card">
      <h2>DM character & roll controls</h2>
      <label>
        Campaign
        <select aria-label="DM campaign" value={code} onChange={(e) => setCode(e.target.value)}>
          {campaigns.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <Check
            label="Allow manual rolls in this campaign"
            value={data.manualAllowed}
            disabled={busy}
            onChange={async (allowed) => {
              setBusy(true);
              setData({ ...data, manualAllowed: allowed });
              setError("");
              try {
                await accountRequest("sheets/policy", { code, allowed });
              } catch (e) {
                setData({ ...data, manualAllowed: !allowed });
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          />
          <p>
            Players can enter physical-dice totals when enabled. Every entry is labeled manual. This
            permission is checked for each roll.
          </p>
          <button onClick={() => setReload((n) => n + 1)}>Refresh campaign characters</button>
          <ul>
            {data.characters.map((c) => (
              <li key={c.id}>
                <button onClick={() => setSelected(c.id)}>{c.name} · View sheet</button>
              </li>
            ))}
          </ul>
          {selected && (
            <CharacterEditor
              key={selected}
              id={selected}
              campaigns={campaigns}
              changed={() => setReload((n) => n + 1)}
            />
          )}
          <RollLog key={code} code={code} />
        </>
      )}
    </section>
  );
}
function ReferenceSearch({ onAdd }: { onAdd: (e: OpenEntry) => void }) {
  const [query, setQuery] = useState(""),
    [edition, setEdition] = useState<"srd-2014" | "srd-2024">("srd-2014"),
    [entries, setEntries] = useState<OpenEntry[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <details>
      <summary>Add spells from Open5e</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await searchOpen5e({ data: { kind: "spells", edition, query, page: 1 } });
            setEntries(r.entries);
            setError(r.more ? "More matches available. Narrow your search." : "");
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Text label="Find an Open5e spell" value={query} onChange={setQuery} />
        <select
          aria-label="Open5e rules edition"
          value={edition}
          onChange={(e) => setEdition(e.target.value as typeof edition)}
        >
          <option value="srd-2014">SRD 2014</option>
          <option value="srd-2024">SRD 2024</option>
        </select>
        <button disabled={busy}>Search spells</button>
      </form>
      {error && <p role="status">{error}</p>}
      {entries.map((e) => (
        <div key={e.key} className="sheet-row">
          <strong>{e.name}</strong>
          <p>{e.facts.join(" · ")}</p>
          <button onClick={() => onAdd(e)}>Add {e.name}</button>
          <small>{e.source}</small>
        </div>
      ))}
    </details>
  );
}
