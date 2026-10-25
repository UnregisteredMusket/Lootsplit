/**
 * Split the party (mockups approved 2026-10-25: split.html, groups-overview.html, merge.html).
 * The DM's Split the party dialog, the Groups panel on Party → Characters, Edit groups and Merge,
 * the Review Inbox entries for players' move requests, the DM desk glance card and the player's
 * group card. Every write is a shared command (party-groups-command.ts) with its own command ID;
 * the room or the device engine decides, and these screens only explain.
 */
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useEconomy, useCommandId } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { useWorldTable } from "@/lib/quire/use-world-table";
import type { CloudTable } from "@/lib/quire/cloud";
import type { CommandRequest } from "@/lib/quire/commands";
import { applyCommand } from "@/lib/quire/commands";
import { newCommandId } from "@/lib/quire/command-id";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { characterPosition, characterVisible, campaignMinute } from "@/lib/quire/character-position";
import { formatCampaignMinute } from "@/lib/quire/npc-barter";
import { formatCoins } from "@/lib/quire/money";
import { readMarketLocations } from "@/lib/quire/shop-locations";
import { canonicalJson } from "@/lib/quire/canonical-json";
import {
  activeGroups,
  groupInfo,
  groupPlace,
  MAIN_GROUP,
  partyGroupsFingerprint,
  partySplit,
  purseGroup,
  resolveGroup,
} from "@/lib/quire/party-groups";
import {
  awayFromParty,
  freeColours,
  groupColourNames,
  groupSummaries,
  mergeBlock,
  outerPlace,
  placeLabel,
  playerGroupView,
  returnGroupName,
  type GroupColour,
  type GroupSummary,
} from "@/lib/quire/party-groups-ui";
import { groupColours, MAX_PARTY_GROUPS } from "@/lib/quire/world-schema";
import type { Purse } from "@/lib/quire/types";
import { Button, Modal } from "./ui";
import { AppLink } from "./app-link";
import { LocationOptions } from "./market-locations";
import "./party-groups.css";

const DM_SEAT = { id: "dm", token: "", name: "DM", role: "dm" as const, purseIds: [] };
const useTable = () => useWorldTable() as unknown as CloudTable;

/** A group's colour and letter, so colour never carries meaning alone. */
export function GroupBadge({ letter, colour, large = false }: { letter: string; colour: string; large?: boolean }) {
  return (
    <span className={`gbadge g-${colour}${large ? " lg" : ""}`} aria-hidden="true">
      {letter}
    </span>
  );
}
export function GroupChip({ letter, colour, children }: { letter: string; colour: string; children: ReactNode }) {
  return (
    <span className={`gchip g-${colour}`}>
      <GroupBadge letter={letter} colour={colour} />
      <span>{children}</span>
    </span>
  );
}
function Initial({ name }: { name: string }) {
  return (
    <span className="gavatar" aria-hidden="true">
      {name.trim()[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
function useRun() {
  const { commandOutcome, commandBatch } = useEconomy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<{ status: "committed" | "pending" }>, done = "Saved.") => {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      toast.success(mutationNotice(await work(), done));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save. Nothing changed; try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run, commandOutcome, commandBatch };
}
/**
 * Commands that each compare the groups' fingerprint, sent as one atomic batch: each `before`
 * is the fingerprint after the previous command, worked out on a private copy of the DM's table.
 */
function chain(t: CloudTable, steps: ((before: string) => CommandRequest)[]) {
  let table = t;
  return steps.map((step) => {
    const command = { ...step(partyGroupsFingerprint(table)), id: newCommandId() } as CommandRequest & { id: string };
    table = applyCommand(table, DM_SEAT, command as never);
    return command;
  });
}

/* ------------------------------------------------------------------ Split the party dialog */

type DraftGroup = { key: string; name: string; colour: GroupColour; locationId: string; hidden: boolean };
type Step = "groups" | "confirm" | "done";

/** DM: Split the party (or split off another group while split). */
export function SplitPartyButton() {
  const seat = useSeat();
  const t = useTable();
  const [open, setOpen] = useState(false);
  if (seat.role !== "dm") return null;
  const full = activeGroups(t).length >= MAX_PARTY_GROUPS - 1;
  return (
    <>
      <Button variant="secondary" disabled={full} onClick={() => setOpen(true)} id="split-party-button" title={full ? `At most ${MAX_PARTY_GROUPS} groups` : undefined}>
        {partySplit(t) ? "Split off a group" : "Split the party"}
      </Button>
      {open && <SplitPartyDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SplitPartyDialog({ onClose }: { onClose: () => void }) {
  const t = useTable();
  const { busy, error, run, commandOutcome } = useRun();
  const split = partySplit(t);
  const existing = groupSummaries(t, DM_SEAT);
  const market = readMarketLocations(t.journal?.market);
  const mainPlace = groupPlace(t, MAIN_GROUP).locationId;
  const taken = existing.map((g) => g.colour);
  const [step, setStep] = useState<Step>("groups");
  const [mainName, setMainName] = useState(t.journal?.world?.mainGroup?.name ?? "Main group");
  const [mainColour, setMainColour] = useState<GroupColour>((t.journal?.world?.mainGroup?.colour as GroupColour) ?? "green");
  const firstFree = (used: string[]) => freeColours(used)[0] ?? "blue";
  const [groups, setGroups] = useState<DraftGroup[]>(() => [
    { key: newCommandId(), name: "", colour: firstFree(split ? taken : ["green"]), locationId: "", hidden: false },
  ]);
  const members = t.purses.filter((p) => p.kind === "character" && characterPosition(t, p).inParty && !characterPosition(t, p).shipId);
  const away = awayFromParty(t);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const targetOf = (p: Purse) => assign[p.id] ?? resolveGroup(t, purseGroup(t, p.id));
  const usedColours = [...(split ? taken : [mainColour]), ...groups.map((g) => g.colour)];
  const letters = useMemo(() => {
    const used = new Set(["A", ...existing.map((g) => g.letter)]);
    return groups.map(() => {
      const l = "ABCDEF".split("").find((x) => !used.has(x)) ?? "?";
      used.add(l);
      return l;
    });
  }, [groups, existing]);
  const draftInfo = (key: string) => {
    const i = groups.findIndex((g) => g.key === key);
    return { letter: letters[i]!, colour: groups[i]!.colour, name: groups[i]!.name || `Group ${letters[i]}` };
  };
  const choices = [
    ...(split
      ? existing.map((g) => ({ ref: g.ref, letter: g.letter, colour: g.colour, name: g.name }))
      : [{ ref: MAIN_GROUP, letter: "A", colour: mainColour, name: mainName || "Main group" }]),
    ...groups.map((g) => ({ ref: g.key, ...draftInfo(g.key) })),
  ];
  const count = (ref: string) => members.filter((p) => targetOf(p) === ref).length;
  const problems = [
    ...groups.flatMap((g) => {
      const info = draftInfo(g.key);
      return [
        ...(g.name.trim() ? [] : [`Name group ${info.letter}.`]),
        ...(count(g.key) ? [] : [`Choose at least one character for group ${info.letter}.`]),
      ];
    }),
    ...(new Set(usedColours).size !== usedColours.length ? ["Give each group its own colour."] : []),
    ...(!split && !mainName.trim() ? ["Name group A."] : []),
    ...existing.filter((g) => !count(g.ref)).map((g) => `Keep at least one character in ${g.name}.`),
  ];
  const command = (): CommandRequest => ({
    kind: "party-split",
    before: partyGroupsFingerprint(t),
    ...(split ? {} : { main: { name: mainName.trim(), colour: mainColour } }),
    groups: groups.map((g) => ({
      id: `group-${g.key}`,
      name: g.name.trim(),
      colour: g.colour,
      locationId: g.locationId || mainPlace,
      memberIds: members.filter((p) => targetOf(p) === g.key).map((p) => p.id),
      ...(g.hidden ? { hidden: true } : {}),
    })),
  } as CommandRequest);
  const { commandId } = useCommandId(step === "confirm" ? JSON.stringify(command()) : "");
  const [receipt, setReceipt] = useState<{ id: string; at: string; lines: { name: string; letter: string; colour: string; where: string; who: string }[] } | null>(null);
  const shopsAt = (locationId: string | null) =>
    (t.shops ?? []).filter((s) => !!s.locationId && !!locationId && placeHas(t, locationId, s.locationId)).length;
  const save = () =>
    run(async () => {
      const result = await commandOutcome({ ...command(), id: commandId });
      setReceipt({
        id: commandId,
        at: formatCampaignMinute(campaignMinute(t)),
        lines: choices.map((c) => {
          const g = groups.find((x) => x.key === c.ref);
          const placeId = g ? g.locationId || mainPlace : groupPlace(t, c.ref).locationId;
          const who = members.filter((p) => targetOf(p) === c.ref);
          const shown = who.filter((p) => characterVisible(t, p)).map((p) => p.name);
          const hidden = who.length - shown.length;
          return {
            name: c.name,
            letter: c.letter,
            colour: c.colour,
            where: `${g && g.locationId && g.locationId !== mainPlace ? "moved to" : "stays at"} ${placeLabel(t, placeId) || "no particular place"}`,
            who: `${shown.join(", ")}${hidden ? ` (+${hidden} hidden, DM only)` : ""}`,
          };
        }),
      });
      setStep("done");
      return result;
    }, "The party is split.");
  const steps: [Step, string][] = [
    ["groups", "Groups"],
    ["confirm", "Confirm"],
    ["done", "Done"],
  ];
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={step === "done" ? "The party is split" : step === "confirm" ? `Split the party into ${choices.length} groups?` : split ? "Split off a group" : "Split the party"}>
      <div className="party-split-dialog">
        <ol className="gsteps" aria-label="Steps">
          {steps.map(([k, label], i) => (
            <li key={k} aria-current={step === k ? "step" : undefined} className={steps.findIndex(([s]) => s === step) > i ? "done" : ""}>
              <b>{i + 1}</b>
              {label}
            </li>
          ))}
        </ol>
        {step === "groups" && (
          <>
            <p className="gnote">
              Everyone stays in the party: shared balances, the treasure pool, fairness and coin splits are unchanged. Each group gets its own place, shops,
              services and NPCs nearby.
            </p>
            {!split && (
              <GroupEditor letter="A" colour={mainColour} name={mainName} onName={setMainName} colours={groupColours.map((c) => ({ c, disabled: groups.some((g) => g.colour === c) }))} onColour={setMainColour}>
                <p className="gwhere">Stays here: {placeLabel(t, mainPlace) || "no particular place"}. Keeps the party's place, marker and any planned journey.</p>
              </GroupEditor>
            )}
            {groups.map((g, i) => (
              <GroupEditor
                key={g.key}
                letter={letters[i]!}
                colour={g.colour}
                name={g.name}
                onName={(name) => setGroups((all) => all.map((x) => (x.key === g.key ? { ...x, name } : x)))}
                colours={groupColours.map((c) => ({ c, disabled: c !== g.colour && usedColours.includes(c) }))}
                onColour={(colour) => setGroups((all) => all.map((x) => (x.key === g.key ? { ...x, colour } : x)))}
                onRemove={groups.length > 1 ? () => setGroups((all) => all.filter((x) => x.key !== g.key)) : undefined}
              >
                <label className="gfield">
                  Where group {letters[i]} is
                  <select value={g.locationId} onChange={(e) => setGroups((all) => all.map((x) => (x.key === g.key ? { ...x, locationId: e.target.value } : x)))}>
                    <option value="">Stays here: {placeLabel(t, mainPlace) || "no particular place"}</option>
                    <LocationOptions market={market} />
                  </select>
                  <small>
                    A different place moves the group at once: no time passes and nothing is charged, like Move party here. To travel with time and
                    costs, keep them here and plan a journey for the group.
                  </small>
                </label>
              </GroupEditor>
            ))}
            {existing.length + groups.length < MAX_PARTY_GROUPS && (
              <button
                type="button"
                className="glink"
                onClick={() => setGroups((all) => [...all, { key: newCommandId(), name: "", colour: firstFree(usedColours), locationId: "", hidden: false }])}
              >
                + Add another group (up to {MAX_PARTY_GROUPS})
              </button>
            )}
            <h3 className="gsub">Who goes where</h3>
            <ul className="gassign">
              {members.map((p) => {
                const s = characterPosition(t, p);
                return (
                  <li key={p.id}>
                    <span className="gwho">
                      <Initial name={p.name} />
                      <span>
                        {p.name}
                        {p.control === "npc" && (
                          <span className="gtag">{s.visible ? "Companion NPC" : "Hidden · DM only"}</span>
                        )}
                      </span>
                    </span>
                    <span className="gseg" role="group" aria-label={`Group for ${p.name}`}>
                      {choices.map((c) => (
                        <button
                          type="button"
                          key={c.ref}
                          className={`g-${c.colour}`}
                          aria-pressed={targetOf(p) === c.ref}
                          aria-label={`${c.name} (group ${c.letter})`}
                          onClick={() => setAssign((a) => ({ ...a, [p.id]: c.ref }))}
                        >
                          <GroupBadge letter={c.letter} colour={c.colour} />
                          <span className="glong">{c.name}</span>
                        </button>
                      ))}
                    </span>
                  </li>
                );
              })}
              {away.map((p) => (
                <li key={p.id} className="is-disabled">
                  <span className="gwho">
                    <Initial name={p.name} />
                    <span>
                      {p.name}
                      <small>{characterPosition(t, p).downtime ? `Downtime: ${characterPosition(t, p).downtime!.name}` : characterPosition(t, p).shipId ? "Aboard a ship" : "Has their own position"}</small>
                    </span>
                  </span>
                  <small>Not in the split.{returnGroupName(t, p) ? " Returns to the party's place when downtime ends." : ""}</small>
                </li>
              ))}
            </ul>
            <p className="gnote">Players can't split the party themselves. Once it's split, a group's own players can ask to move their group; you approve it in Review Inbox.</p>
            {problems.length > 0 && (
              <ul className="gproblems" aria-live="polite">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <div className="gactions">
              <Button disabled={problems.length > 0} onClick={() => setStep("confirm")}>
                Review split…
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
        {step === "confirm" && (
          <>
            <div className="gsummary-grid">
              {choices.map((c) => {
                const g = groups.find((x) => x.key === c.ref);
                const placeId = g ? g.locationId || mainPlace : groupPlace(t, c.ref).locationId;
                const who = members.filter((p) => targetOf(p) === c.ref);
                return (
                  <section key={c.ref} className={`gsummary g-${c.colour}`}>
                    <h3>
                      <GroupBadge letter={c.letter} colour={c.colour} /> {c.name}
                    </h3>
                    <dl className="gkv">
                      <dt>Where</dt>
                      <dd>
                        {placeLabel(t, placeId) || "No particular place"}
                        {g ? (g.locationId && g.locationId !== mainPlace ? " (moved at once, no time passes)" : " (stays)") : ""}
                      </dd>
                      <dt>Members</dt>
                      <dd>
                        {who.map((p, i) => (
                          <span key={p.id}>
                            {i ? ", " : ""}
                            {p.name}
                            {!characterVisible(t, p) ? <span className="gtag">DM only</span> : null}
                          </span>
                        ))}
                      </dd>
                      <dt>Shops there</dt>
                      <dd>{shopsAt(placeId) || 0}</dd>
                    </dl>
                    {g && (
                      <label className="gcheck">
                        <input type="checkbox" checked={g.hidden} onChange={(e) => setGroups((all) => all.map((x) => (x.key === g.key ? { ...x, hidden: e.target.checked } : x)))} /> Hide {c.name}'s place from
                        other groups' players (they see "Elsewhere")
                      </label>
                    )}
                  </section>
                );
              })}
            </div>
            <div className="gsame-diff">
              <div>
                <h4>Changes</h4>
                <ul>
                  <li>One map marker per group.</li>
                  <li>Shops, services and NPCs nearby follow each character's group.</li>
                  <li>Journeys move one group.</li>
                </ul>
              </div>
              <div>
                <h4>Stays the same</h4>
                <ul>
                  <li>Everyone is still in the party.</li>
                  <li>Party balances and companion funds stay visible to all members.</li>
                  <li>Everyone can claim from the treasure pool and receives coin splits.</li>
                  <li>Fairness compares all of them, as today.</li>
                  <li>One campaign clock; nothing is charged.</li>
                </ul>
              </div>
            </div>
            {away.filter((p) => characterPosition(t, p).downtime?.returnInParty).map((p) => (
              <p key={p.id} className="gnote">
                {p.name} is on downtime and isn't in any group. When it ends, {p.name} returns to the group whose place it was started from.
              </p>
            ))}
            {error && <p role="alert" className="gerror">{error}</p>}
            <div className="gactions">
              <Button disabled={busy} onClick={() => void save()}>
                Split the party
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setStep("groups")}>
                Back
              </Button>
            </div>
          </>
        )}
        {step === "done" && receipt && (
          <>
            <p className="gnote">
              {receipt.at} · saved once ({receipt.id.slice(0, 8)}) · nothing charged, no time passed
            </p>
            <ul className="greceipt">
              {receipt.lines.map((l) => (
                <li key={l.name}>
                  <GroupChip letter={l.letter} colour={l.colour}>
                    {l.name}
                  </GroupChip>{" "}
                  {l.where}
                  <small>{l.who}</small>
                </li>
              ))}
            </ul>
            <p className="gnote">Journal: the split is kept in campaign history. Merging adds its own entry.</p>
            <div className="gactions">
              <Button
                onClick={() => {
                  onClose();
                  setTimeout(() => document.getElementById("party-groups")?.scrollIntoView({ block: "start" }), 50);
                }}
              >
                See groups
              </Button>
              <AppLink className="settings-link" href="/maps">
                Open map
              </AppLink>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
function placeHas(t: CloudTable, here: string, shopLocation: string) {
  const market = readMarketLocations(t.journal?.market);
  const path: string[] = [];
  let id: string | null | undefined = here;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    path.push(id);
    id = market.locations.find((l) => l.id === id)?.parentId;
  }
  return path.includes(shopLocation);
}

function GroupEditor({
  letter,
  colour,
  name,
  onName,
  colours,
  onColour,
  onRemove,
  children,
}: {
  letter: string;
  colour: GroupColour;
  name: string;
  onName: (name: string) => void;
  colours: { c: GroupColour; disabled: boolean }[];
  onColour: (c: GroupColour) => void;
  onRemove?: () => void;
  children?: ReactNode;
}) {
  return (
    <section className={`geditor g-${colour}`} aria-label={`Group ${letter}`}>
      <div className="grow">
        <GroupBadge letter={letter} colour={colour} large />
        <label className="gfield gname-field">
          Group {letter} name
          <input value={name} maxLength={60} onChange={(e) => onName(e.target.value)} placeholder={letter === "A" ? "Harbour watch" : "Ironhold riders"} />
        </label>
        {onRemove && (
          <button type="button" className="glink" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      <fieldset className="gswatches">
        <legend>Colour</legend>
        {colours.map(({ c, disabled }) => (
          <label key={c} className={`gswatch g-${c}`} title={disabled ? `${groupColourNames[c]} (used by another group)` : groupColourNames[c]}>
            <input type="radio" name={`colour-${letter}`} checked={colour === c} disabled={disabled} aria-label={disabled ? `${groupColourNames[c]}, used by another group` : groupColourNames[c]} onChange={() => onColour(c)} />
            <span />
          </label>
        ))}
      </fieldset>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ DM Groups panel */

/** Party → Characters: the groups while the party is split (DM). */
export function PartyGroupsPanel({ onPlacement }: { onPlacement?: (purseId: string) => void }) {
  const seat = useSeat();
  const t = useTable();
  const [edit, setEdit] = useState(false);
  const [merge, setMerge] = useState<string[] | null>(null);
  if (seat.role !== "dm" || !partySplit(t)) return null;
  const groups = groupSummaries(t, DM_SEAT);
  const away = awayFromParty(t);
  const pending = (t.journal?.world?.groupRequests ?? []).filter((r) => r.status === "pending");
  return (
    <section className="gpanel" id="party-groups" aria-labelledby="party-groups-title">
      <div className="gpanel-head">
        <h2 id="party-groups-title">Groups · the party is split</h2>
        <div className="gactions">
          <Button variant="secondary" onClick={() => setEdit(true)}>
            Edit groups…
          </Button>
          <Button variant="secondary" onClick={() => setMerge(groups.map((g) => g.ref))}>
            Merge…
          </Button>
        </div>
      </div>
      <p className="gnote">{formatCampaignMinute(campaignMinute(t))} · one campaign clock for every group. Session Time and downtime pass for everyone.</p>
      {pending.map((r) => (
        <GroupRequestReview key={r.id} requestId={r.id} />
      ))}
      <div className="gcards">
        {groups.map((g) => (
          <GroupCard key={g.ref} group={g} groups={groups} onMerge={(refs) => setMerge(refs)} />
        ))}
      </div>
      {away.length > 0 && (
        <div className="gaway">
          <h3>Away from the party (unchanged)</h3>
          <ul className="gmembers">
            {away.map((p) => {
              const s = characterPosition(t, p);
              const back = returnGroupName(t, p);
              return (
                <li key={p.id}>
                  <Initial name={p.name} />
                  <span className="gwho-text">
                    {p.name}
                    <small>
                      {s.downtime ? `Downtime: ${s.downtime.name}` : s.shipId ? "Aboard a ship" : `Own position${s.locationId ? `: ${placeLabel(t, s.locationId)}` : ""}`}
                      {back ? ` · returns to ${back}` : ""}
                    </small>
                  </span>
                  {onPlacement && (
                    <Button variant="ghost" onClick={() => onPlacement(p.id)}>
                      Placement
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="gnote">Leaving the party works exactly as before, from each character's placement. Moving someone between groups is Edit groups…, a different action.</p>
        </div>
      )}
      {edit && <EditGroupsDialog onClose={() => setEdit(false)} />}
      {merge && <MergeDialog initial={merge} onClose={() => setMerge(null)} />}
    </section>
  );
}

function GroupCard({ group: g, groups, onMerge }: { group: GroupSummary; groups: GroupSummary[]; onMerge: (refs: string[]) => void }) {
  const t = useTable();
  const { busy, error, run, commandOutcome } = useRun();
  const [moving, setMoving] = useState(false);
  const [to, setTo] = useState("");
  const { commandId, renew } = useCommandId(`${g.ref}|${to}`);
  const market = readMarketLocations(t.journal?.market);
  const partner = groups.find((o) => o.ref !== g.ref && !mergeBlock(t, [g.ref, o.ref]));
  const blocked = partner ? "" : mergeBlock(t, [g.ref, ...groups.filter((o) => o.ref !== g.ref).map((o) => o.ref).slice(0, 1)]);
  const move = () =>
    run(async () => {
      const place = groupPlace(t, g.ref);
      const result = await commandOutcome({
        id: commandId,
        kind: "party-location",
        ...(g.ref === MAIN_GROUP ? {} : { groupId: g.ref }),
        before: place.locationId,
        ...(place.position ? { beforePosition: canonicalJson(place.position) } : {}),
        locationId: to || null,
      } as CommandRequest);
      renew();
      setMoving(false);
      return result;
    }, `${g.name} moved.`);
  const hide = (hidden: boolean) =>
    run(
      () =>
        commandOutcome({
          id: newCommandId(),
          kind: "party-group-edit",
          before: partyGroupsFingerprint(t),
          groupId: g.ref,
          name: g.name,
          colour: g.colour,
          hidden,
        } as CommandRequest),
      hidden ? `${g.name}'s place is hidden from other groups' players.` : `${g.name}'s place is shown to the party.`,
    );
  return (
    <article className={`gcard g-${g.colour}`} aria-label={`${g.name}, group ${g.letter}`}>
      <header className="ghead">
        <GroupBadge letter={g.letter} colour={g.colour} large />
        <div>
          <h3>{g.name}</h3>
          <p className="gwhere">{g.where}</p>
        </div>
      </header>
      <p className="gstatus">
        {g.travelling ? "On the road" : g.locationId ? `${g.shops} ${g.shops === 1 ? "shop" : "shops"} here` : "No particular place"}
        {g.hidden ? " · hidden from other groups' players" : ""}
      </p>
      <ul className="gmembers">
        {g.members.map((p) => (
          <li key={p.id}>
            <Initial name={p.name} />
            <span className="gwho-text">
              {p.name}
              {p.control === "npc" && <span className="gtag">{characterVisible(t, p) ? "Companion" : "Hidden · DM only"}</span>}
            </span>
            <span className="gamt">{formatCoins(p.coins)}</span>
          </li>
        ))}
      </ul>
      <div className="gactions">
        <Button variant="secondary" disabled={busy} onClick={() => setMoving((m) => !m)} aria-expanded={moving}>
          Move…
        </Button>
        <AppLink className="settings-link" href="/maps">
          Map
        </AppLink>
        <Button variant="secondary" disabled={!partner} onClick={() => partner && onMerge([g.ref, partner.ref])}>
          Merge
        </Button>
      </div>
      {!partner && blocked && <small className="gnote">{blocked}</small>}
      {moving && (
        <div className="gmove">
          <label className="gfield">
            Move {g.name} to
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">No particular place</option>
              <LocationOptions market={market} />
            </select>
            <small>Moves the group at once: no time passes and nothing is charged. Far places go by journey.</small>
          </label>
          <Button disabled={busy || (to || null) === g.locationId} onClick={() => void move()}>
            Move group here
          </Button>
        </div>
      )}
      {g.ref !== MAIN_GROUP && (
        <label className="gcheck">
          <input type="checkbox" checked={g.hidden} disabled={busy} onChange={(e) => void hide(e.target.checked)} /> Hide this group's place from other groups' players
        </label>
      )}
      {error && <p role="alert" className="gerror">{error}</p>}
    </article>
  );
}

function EditGroupsDialog({ onClose }: { onClose: () => void }) {
  const t = useTable();
  const { busy, error, run, commandBatch } = useRun();
  const groups = groupSummaries(t, DM_SEAT);
  const [labels, setLabels] = useState(() => Object.fromEntries(groups.map((g) => [g.ref, { name: g.name, colour: g.colour as GroupColour, hidden: g.hidden }])));
  const members = t.purses.filter((p) => p.kind === "character" && characterPosition(t, p).inParty);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const current = (p: Purse) => resolveGroup(t, purseGroup(t, p.id));
  const [batchId] = useState(newCommandId);
  const colours = Object.values(labels).map((l) => l.colour);
  const save = () =>
    run(async () => {
      const steps: ((before: string) => CommandRequest)[] = [];
      for (const g of groups) {
        const l = labels[g.ref]!;
        if (l.name.trim() !== g.name || l.colour !== g.colour || l.hidden !== g.hidden)
          steps.push((before) => ({ kind: "party-group-edit", before, groupId: g.ref, name: l.name.trim(), colour: l.colour, hidden: g.ref === MAIN_GROUP ? false : l.hidden }) as CommandRequest);
      }
      for (const p of members)
        if (assign[p.id] && assign[p.id] !== current(p))
          steps.push((before) => ({ kind: "party-group-assign", before, purseId: p.id, groupId: assign[p.id]! }) as CommandRequest);
      if (!steps.length) {
        onClose();
        return { status: "committed" as const };
      }
      const result = await commandBatch(batchId, chain(t, steps));
      onClose();
      return result;
    }, "Groups saved.");
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Edit groups">
      <div className="party-split-dialog">
        {groups.map((g) => {
          const l = labels[g.ref]!;
          return (
            <GroupEditor
              key={g.ref}
              letter={g.letter}
              colour={l.colour}
              name={l.name}
              onName={(name) => setLabels((all) => ({ ...all, [g.ref]: { ...l, name } }))}
              colours={groupColours.map((c) => ({ c, disabled: c !== l.colour && colours.includes(c) }))}
              onColour={(colour) => setLabels((all) => ({ ...all, [g.ref]: { ...l, colour } }))}
            >
              {g.ref !== MAIN_GROUP && (
                <label className="gcheck">
                  <input type="checkbox" checked={l.hidden} onChange={(e) => setLabels((all) => ({ ...all, [g.ref]: { ...l, hidden: e.target.checked } }))} /> Hide this group's place from
                  other groups' players
                </label>
              )}
            </GroupEditor>
          );
        })}
        <h3 className="gsub">Who is in which group</h3>
        <ul className="gassign">
          {members.map((p) => (
            <li key={p.id}>
              <span className="gwho">
                <Initial name={p.name} />
                <span>{p.name}</span>
              </span>
              <span className="gseg" role="group" aria-label={`Group for ${p.name}`}>
                {groups.map((g) => (
                  <button
                    type="button"
                    key={g.ref}
                    className={`g-${labels[g.ref]!.colour}`}
                    aria-pressed={(assign[p.id] ?? current(p)) === g.ref}
                    aria-label={`${labels[g.ref]!.name} (group ${g.letter})`}
                    onClick={() => setAssign((a) => ({ ...a, [p.id]: g.ref }))}
                  >
                    <GroupBadge letter={g.letter} colour={labels[g.ref]!.colour} />
                    <span className="glong">{labels[g.ref]!.name}</span>
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="gnote">Moving a character between groups is not leaving the party; that stays in each character's placement.</p>
        {error && <p role="alert" className="gerror">{error}</p>}
        <div className="gactions">
          <Button disabled={busy || new Set(colours).size !== colours.length || Object.values(labels).some((l) => !l.name.trim())} onClick={() => void save()}>
            Save groups
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function MergeDialog({ initial, onClose }: { initial: string[]; onClose: () => void }) {
  const t = useTable();
  const { busy, error, run, commandOutcome } = useRun();
  const groups = groupSummaries(t, DM_SEAT);
  const [chosen, setChosen] = useState<string[]>(initial.length >= 2 && !mergeBlock(t, initial) ? initial : initial.slice(0, 2));
  const blocked = mergeBlock(t, chosen);
  const places = [...new Set(chosen.map((r) => groupPlace(t, r).locationId))];
  const [into, setInto] = useState<string | null>(() => outerPlace(t, chosen));
  const target = places.includes(into) ? into : (outerPlace(t, chosen) ?? null);
  const whole = chosen.length === groups.length;
  const { commandId } = useCommandId(`${chosen.join(",")}|${target}`);
  const save = () =>
    run(async () => {
      const result = await commandOutcome({ id: commandId, kind: "party-merge", before: partyGroupsFingerprint(t), groupIds: chosen, intoLocationId: target } as CommandRequest);
      onClose();
      return result;
    }, whole ? "The party regrouped." : "Groups merged.");
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Merge groups">
      <div className="party-split-dialog">
        <fieldset className="gfieldset">
          <legend>Groups to merge</legend>
          {groups.map((g) => (
            <label key={g.ref} className="gcheck">
              <input type="checkbox" checked={chosen.includes(g.ref)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, g.ref] : c.filter((x) => x !== g.ref)))} />
              <GroupBadge letter={g.letter} colour={g.colour} /> {g.name}
              <small>
                {g.members.map((p) => p.name).join(", ")} · {g.where}
              </small>
            </label>
          ))}
        </fieldset>
        {!blocked && places.length > 1 && (
          <label className="gfield">
            Merged group is at
            <select value={target ?? ""} onChange={(e) => setInto(e.target.value || null)}>
              {places.map((p) => (
                <option key={p ?? ""} value={p ?? ""}>
                  {placeLabel(t, p) || "No particular place"}
                </option>
              ))}
            </select>
          </label>
        )}
        {blocked ? (
          <p role="status" className="gwait">
            {blocked}
          </p>
        ) : (
          <>
            <h3 className="gsub">After merging</h3>
            <ul className="gnote-list">
              <li>{whole ? <><b>The party is whole again</b> at {placeLabel(t, target) || "no particular place"}. One marker, one Here sheet.</> : <>The merged group is at {placeLabel(t, target) || "no particular place"}.</>}</li>
              <li>Each group's journeys stay in history.</li>
              <li>Nothing is charged; no time passes; balances, the pool and fairness don't change.</li>
            </ul>
          </>
        )}
        {error && <p role="alert" className="gerror">{error}</p>}
        <div className="gactions">
          <Button disabled={busy || !!blocked} onClick={() => void save()}>
            {whole ? "Merge · regroup the party" : "Merge groups"}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Move requests */

function GroupRequestReview({ requestId }: { requestId: string }) {
  const t = useTable();
  const { busy, error, run, commandOutcome } = useRun();
  const r = t.journal?.world?.groupRequests?.find((x) => x.id === requestId);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [share, setShare] = useState(true);
  if (!r || r.status !== "pending") return null;
  const info = groupInfo(t, r.groupId);
  const who = t.purses.find((p) => p.id === r.purseId)?.name ?? "A player";
  const decide = (approve: boolean) =>
    run(
      () =>
        commandOutcome({
          id: `${r.id}-review`,
          kind: "party-group-request-review",
          requestId: r.id,
          approve,
          ...(approve ? {} : { reason: { text: reason.trim(), showToPlayer: share } }),
        } as CommandRequest),
      approve ? `${info.name} moved.` : "Request denied.",
    );
  return (
    <div className={`grequest g-${info.colour}`} role="group" aria-label={`${who} asks to move ${info.name}`}>
      <p>
        <GroupBadge letter={info.letter} colour={info.colour} /> <b>{who}</b> asks to move <b>{info.name}</b> to {placeLabel(t, r.locationId) || "a place"}.
      </p>
      {r.message && <blockquote>“{r.message}”</blockquote>}
      {denying && (
        <div className="gmove">
          <label className="gfield">
            Reason (optional)
            <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label className="gcheck">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Show the reason to the player
          </label>
        </div>
      )}
      <div className="gactions">
        <Button disabled={busy} onClick={() => void decide(true)}>
          Approve move
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => (denying ? void decide(false) : setDenying(true))}>
          {denying ? "Deny request" : "Deny…"}
        </Button>
      </div>
      {error && <p role="alert" className="gerror">{error}</p>}
    </div>
  );
}

/** Review Inbox: players' group move requests (the DM decides; players see their own). */
export function GroupRequestInbox() {
  const t = useTable();
  const seat = useSeat();
  const { busy, error, run, commandOutcome } = useRun();
  const requests = (t.journal?.world?.groupRequests ?? []).filter((r) => (seat.role === "dm" ? r.status === "pending" : seat.purseIds.includes(r.purseId)));
  if (!requests.length) return null;
  return (
    <section className="ginbox" aria-label="Group move requests">
      <h3>Group moves</h3>
      {seat.role === "dm"
        ? requests.map((r) => <GroupRequestReview key={r.id} requestId={r.id} />)
        : requests.slice(-5).map((r) => {
            const info = groupInfo(t, r.groupId);
            return (
              <p key={r.id} className="grequest-line">
                <GroupBadge letter={info.letter} colour={info.colour} /> Move {info.name} to {placeLabel(t, r.locationId) || "a place"} ·{" "}
                {r.status === "pending" ? "waiting for the DM" : r.status}
                {r.reason?.text ? ` · “${r.reason.text}”` : ""}
                {r.status === "pending" && (
                  <Button variant="ghost" disabled={busy} onClick={() => void run(() => commandOutcome({ id: `${r.id}-withdraw`, kind: "party-group-request-withdraw", requestId: r.id } as CommandRequest), "Request withdrawn.")}>
                    Withdraw
                  </Button>
                )}
              </p>
            );
          })}
      {error && <p role="alert" className="gerror">{error}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ Glances and player card */

/** DM desk: one line of group chips while split. */
export function DeskGroupsGlance() {
  const t = useTable();
  const seat = useSeat();
  if (seat.role !== "dm" || !partySplit(t)) return null;
  const groups = groupSummaries(t, DM_SEAT);
  const away = awayFromParty(t).length;
  return (
    <section className="gglance" aria-label="Party groups">
      <div className="gglance-head">
        <h2>Party</h2>
        <span>
          {groups.reduce((n, g) => n + g.members.length, 0)} characters · {groups.length} groups
        </span>
      </div>
      <p className="gchips">
        {groups.map((g) => (
          <GroupChip key={g.ref} letter={g.letter} colour={g.colour}>
            {g.name} · {g.where} · {g.members.length}
          </GroupChip>
        ))}
        {away > 0 && <span className="gchip g-none"><span className="gbadge" aria-hidden="true">–</span><span>Away · {away}</span></span>}
      </p>
      <AppLink className="settings-link" href="/party?section=characters">
        See groups
      </AppLink>
    </section>
  );
}

/** Player: which group they're with, where the others are, and asking to move their group. */
export function PlayerGroupCard() {
  const t = useTable();
  const seat = useSeat();
  const { busy, error, run, commandOutcome } = useRun();
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const view = playerGroupView(t, seat);
  const mine = view.mine[0];
  const actor = mine && seat.purseIds.find((id) => {
    const p = t.purses.find((x) => x.id === id);
    return !!p && purseGroup(t, id) !== undefined && resolveGroup(t, purseGroup(t, id)) === mine.ref;
  });
  const { commandId, renew } = useCommandId(`${mine?.ref}|${to}|${message}`);
  if (seat.role === "dm" || !partySplit(t) || !mine) return null;
  const waiting = (t.journal?.world?.groupRequests ?? []).find((r) => r.groupId === mine.ref && r.status === "pending");
  const market = readMarketLocations(t.journal?.market);
  const ask = () =>
    run(async () => {
      const result = await commandOutcome({
        id: commandId,
        kind: "party-group-request",
        requestId: commandId,
        groupId: mine.ref,
        purseId: actor!,
        locationId: to,
        ...(message.trim() ? { message: message.trim() } : {}),
      } as CommandRequest);
      renew();
      setTo("");
      setMessage("");
      return result;
    }, "Sent to the DM.");
  return (
    <section className="gplayer" aria-label="Your group">
      {view.mine.map((g) => (
        <div key={g.ref} className={`gyou g-${g.colour}`}>
          <GroupBadge letter={g.letter} colour={g.colour} large />
          <span>
            <b>You're with {g.name}</b>
            <small>
              {g.where}
              {g.members.filter((p) => !seat.purseIds.includes(p.id)).length
                ? ` · with ${g.members
                    .filter((p) => !seat.purseIds.includes(p.id))
                    .map((p) => p.name)
                    .join(", ")}`
                : ""}
            </small>
          </span>
        </div>
      ))}
      {view.others.map((g) => (
        <div key={g.ref} className={`gother g-${g.colour}`}>
          <GroupBadge letter={g.letter} colour={g.colour} />
          <span>
            <b>{g.name}</b> · {g.where}
            {g.members.length ? ` · ${g.members.map((p) => p.name).join(", ")}` : ""}
          </span>
        </div>
      ))}
      <details className="gask">
        <summary>Move your group</summary>
        <p className="gnote">Ask the DM. Nothing moves until the DM approves.</p>
        {waiting ? (
          <p className="grequest-line">
            Request sent · waiting: move to {placeLabel(t, waiting.locationId) || "a place"}.
            {seat.purseIds.includes(waiting.purseId) && (
              <Button variant="ghost" disabled={busy} onClick={() => void run(() => commandOutcome({ id: `${waiting.id}-withdraw`, kind: "party-group-request-withdraw", requestId: waiting.id } as CommandRequest), "Request withdrawn.")}>
                Withdraw
              </Button>
            )}
          </p>
        ) : (
          <>
            <label className="gfield">
              Where to
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Choose a place</option>
                <LocationOptions market={market} />
              </select>
            </label>
            <label className="gfield">
              Message to the DM (optional)
              <input value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} />
            </label>
            <Button disabled={busy || !to || !actor || to === mine.locationId} onClick={() => void ask()}>
              Ask the DM
            </Button>
          </>
        )}
        <p className="gnote">Far places go by journey: ask the DM to plan one for {mine.name}.</p>
      </details>
      <GroupRequestInbox />
      {error && <p role="alert" className="gerror">{error}</p>}
    </section>
  );
}

/** A small group chip for a character (Party balances, lists); nothing when the party is whole. */
export function CharacterGroupChip({ purseId }: { purseId: string }) {
  const t = useTable();
  if (!partySplit(t)) return null;
  const g = purseGroup(t, purseId);
  if (!g) return null;
  const info = groupInfo(t, resolveGroup(t, g));
  return (
    <span className={`g-${info.colour}`} title={info.name}>
      <GroupBadge letter={info.letter} colour={info.colour} />
      <span className="sr-only">{info.name}</span>
    </span>
  );
}
