import { CharacterTabs } from "./workspace-tabs";
import "./character-improvements.css";
import { FeatureLink } from "../feature-navigation";
import { ImportCharacterSheet } from "./import-sheet";
import { canEditCharacterField, characterPermissions } from "@/lib/characters/permissions.mjs";
import { usePrefs } from "@/lib/quire/prefs";
import { FantasyIcon } from "@/components/fantasy-icon";
import { LedgerArt } from "@/components/ledger-art";

function CampaignInventoryArt({ item, holdings }: { item: { id?: string; name: string; kind?: string }; holdings: Holding[] }) {
  const holding = holdings.find(holding => holding.id === item.id);
  return holding?.deed ? <LedgerArt kind="property" entry={holding} /> : <FantasyIcon entry={item} size={36} />;
}
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { Heart, Shield, Footprints } from "lucide-react";
import { HpBar } from "@/components/control-panel/readouts";
import { useEffect, useRef, useState, useSyncExternalStore, useId, type FormEvent } from "react";
import { getCampaigns, serverCampaigns, subscribeCampaigns } from "@/lib/quire/campaigns";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { getSeat } from "@/lib/quire/table";
import {
  readPartySheetLinks,
  writePartySheetLink,
  announceSheetChange,
  subscribeSheetChanges,
} from "@/lib/quire/party-sheet-links";
import type { Purse, Holding } from "@/lib/quire/types";
import { Link, useRouterState } from "@tanstack/react-router";
import { z } from "zod";
import { characterRequest as accountRequest } from "@/lib/characters/campaign-client";
import { characterSheet } from "@/lib/characters/campaign-sheet.mjs";
import {
  createCampaignCharacter,
  bindCampaignProfile,
  unbindCampaignProfile,
} from "@/lib/quire/economy";
import { runSharedMutation } from "@/lib/quire/cloud-client";
import {
  abilities,
  skills,
  blankSheet,
  sheetSchema,
  modifier,
  signed,
  rollSpec,
} from "@/lib/characters/model.mjs";
import { searchOpen5e } from "@/lib/quire/open5e-api";
import type { OpenEntry } from "@/lib/quire/open5e";
import { downloadJson } from "@/lib/quire/table";

type Sheet = z.infer<typeof sheetSchema>;
type Ability = keyof Sheet["scores"];
type Row = {
  id: string;
  body: Sheet;
  revision: number;
  campaign_code: string;
  purse_id: string;
};
type Campaign = {
  code: string;
  name: string;
  role: string;
  purses: { id: string; name: string }[];
};
type DeviceCampaign = {
  code: string;
  campaignId: string;
  name: string;
  ownerId: string;
  purses: Purse[];
  holdings: Holding[];
};
type Detail = Row & {
  assignmentRevision?: number;
  editable: boolean;
  assignmentError: string;
  campaign: null | {
    code: string;
    role: string;
    editingAllowed?: boolean;
    permissions?: Purse["permissions"];
    manualAllowed: boolean;
    coins: Sheet["coins"];
    holdings: Holding[];
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
export function CharacterWorkspace({
  campaignCode = "",
  purseId = "",
}: {
  campaignCode?: string;
  purseId?: string;
}) {
  const registry = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const economy = useEconomy();
  const seat = useSeat();
  const activeCode = room.joined ? room.code : campaignCode;
  const requestedId = useRouterState({
    select: (state) => {
      const id = (state.location.search as { id?: unknown }).id;
      return typeof id === "string" && id.length <= 256 ? id : "";
    },
  });
  const selectionContext = `${registry.activeId}:${activeCode}:${purseId}:${seat.role}:${seat.purseIds.join(",")}`;
  const campaignContext = `${registry.activeId}:${activeCode}:${purseId}`;
  const previousCampaignContext = useRef(campaignContext);
  const previousContext = useRef(selectionContext);
  const previousRequest = useRef(requestedId);
  const resolvedSelection = useRef("");
  const listRequest = useRef<AbortController | null>(null);
  const [accountData, setData] = useState<{
      userId?: string;
      characters: Row[];
      campaigns: Campaign[];
    } | null>(null),
    [selected, setSelected] = useState(requestedId),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0),
    [creating, setCreating] = useState(false);
  const campaignRows: Row[] = economy.purses
    .filter((p) => p.kind === "character" && (seat.role === "dm" || seat.purseIds.includes(p.id)))
    .map((p) => ({
      id: `party:${p.id}`,
      body: characterSheet(
        p,
        economy.holdings,
        economy.sheets.find((s) => s.purseId === p.id),
      ),
      revision: p.sheetRevision || 0,
      campaign_code: "",
      purse_id: p.id,
    }));
  const data = economy.ready
    ? {
        userId: accountData?.userId,
        campaigns: accountData?.campaigns || [],
        characters: [
          ...campaignRows,
          ...(accountData?.characters || []).filter(
            (r) => !economy.purses.some((p) => p.profileId === r.id),
          ),
        ],
      }
    : accountData;
  const dirtyRef = useRef(false);
  const campaignRowsRef = useRef(campaignRows);
  campaignRowsRef.current = campaignRows;
  const campaignIds = campaignRows.map((row) => row.id).join("|");
  useEffect(() => {
    if (!economy.ready) return;
    const c = new AbortController();
    listRequest.current = c;
    const contextChanged = previousContext.current !== selectionContext;
    const campaignChanged = previousCampaignContext.current !== campaignContext;
    previousCampaignContext.current = campaignContext;
    const requestChanged = previousRequest.current !== requestedId;
    previousContext.current = selectionContext;
    previousRequest.current = requestedId;
    const localRows = campaignRowsRef.current;
    const localDefault = purseId
      ? localRows.find((row) => row.purse_id === purseId)?.id || ""
      : localRows[0]?.id || "";
    if (contextChanged)
      setSelected(localRows.some((row) => row.id === requestedId) ? requestedId : localDefault);
    else if (requestChanged) setSelected(requestedId || localDefault);
    else setSelected((v) => v || requestedId || localDefault);
    const select = (d: { userId?: string; characters: Row[] }) => {
      if (c.signal.aborted) return;
      const rows = campaignRowsRef.current;
      const firstSelection = !resolvedSelection.current;
      const restoreSelection = resolvedSelection.current !== selectionContext;
      resolvedSelection.current = selectionContext;
      let remembered = "";
      if (restoreSelection && !requestedId && !dirtyRef.current) {
        try {
          remembered =
            sessionStorage.getItem(
              `quire.character.selection:${d.userId || "guest"}:${selectionContext}`,
            ) || "";
        } catch {
          /* Storage can be unavailable in private browsing. */
        }
      }
      const local = readPartySheetLinks(d.userId || "", registry.activeId).find(
        (link) => link.purseId === purseId,
      );
      const linked =
        rows.find((r) => r.purse_id === purseId)?.id ||
        (activeCode
          ? d.characters.find((r) => r.campaign_code === activeCode && r.purse_id === purseId)?.id
          : d.characters.find((r) => r.id === local?.sheetId && !r.campaign_code)?.id);
      setSelected((v) => {
        if (c.signal.aborted) return v;
        if (
          (firstSelection || !campaignChanged) &&
          requestedId &&
          (firstSelection || requestChanged || contextChanged || v === requestedId) &&
          (rows.some((r) => r.id === requestedId) ||
            d.characters.some((r) => r.id === requestedId) ||
            requestedId.startsWith("campaign:"))
        )
          return requestedId;
        if (
          remembered &&
          (rows.some((r) => r.id === remembered) || d.characters.some((r) => r.id === remembered))
        )
          return remembered;
        if (
          v &&
          (rows.some((r) => r.id === v) ||
            d.characters.some((r) => r.id === v) ||
            v.startsWith("campaign:"))
        )
          return v;
        return purseId
          ? linked || ""
          : rows[0]?.id ||
              d.characters.find((r) => activeCode && r.campaign_code === activeCode)?.id ||
              d.characters[0]?.id ||
              "";
      });
    };
    setLoading(true);
    accountRequest<{ userId?: string; characters: Row[]; campaigns: Campaign[] }>(
      "sheets",
      undefined,
      c.signal,
    )
      .then((d) => {
        if (c.signal.aborted) return;
        setData(d);
        setError("");
        select(d);
      })
      .catch((e) => {
        if (c.signal.aborted) return;
        const empty = { characters: [], campaigns: [] };
        setData(empty);
        select(empty);
        setError(/sign in|member|account|authenticated/i.test(errorText(e)) ? "" : errorText(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [
    reload,
    activeCode,
    purseId,
    registry.activeId,
    selectionContext,
    campaignContext,
    requestedId,
    economy.ready,
    campaignIds,
  ]);
  const deviceCampaign: DeviceCampaign | undefined =
    !room.joined && economy.ready && data?.userId
      ? {
          code: `device:${registry.activeId}`,
          campaignId: registry.activeId,
          name: registry.campaigns.find((c) => c.id === registry.activeId)?.name || "Campaign",
          ownerId: data.userId,
          purses: economy.purses.filter(
            (p) => p.kind === "character" && (seat.role === "dm" || seat.purseIds.includes(p.id)),
          ),
          holdings: economy.holdings,
        }
      : undefined;
  function chooseCharacter(id: string) {
    resolvedSelection.current = selectionContext;
    setSelected(id);
    try {
      sessionStorage.setItem(
        `quire.character.selection:${data?.userId || "guest"}:${selectionContext}`,
        id,
      );
    } catch {
      /* Selection still works when storage is unavailable. */
    }
  }
  async function create(sheet = blankSheet(), standalone = false) {
    if (dirtyRef.current && !window.confirm("Discard unsaved changes to open a new character?"))
      return;
    setCreating(true);
    try {
      let id: string;
      if (!standalone && seat.role === "dm") {
        let created = "";
        const work = async () => {
          created = await createCampaignCharacter(sheet);
        };
        if (room.joined) await runSharedMutation(work);
        else await work();
        await economy.reload();
        id = `party:${created}`;
      } else id = (await accountRequest<{ id: string }>("sheets/save", { sheet })).id;
      // A list started before this save cannot resolve the newly created ID.
      // Cancel it before selecting; queued selectors also check the abort signal.
      listRequest.current?.abort();
      chooseCharacter(id);
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
          <p>
            Play from your phone or computer. Campaign characters share their sheet, funds and
            inventory.
          </p>
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
          <ImportCharacterSheet
            label="Import a new character"
            disabled={creating || (!data.userId && seat.role !== "dm")}
            onImport={(sheet) => create(sheet)}
          />
          <details className="character-library-controls">
            <summary>My characters · select, create or import</summary>
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
                      chooseCharacter(e.target.value);
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
              {data.userId && (
                <button disabled={creating} onClick={() => void create(blankSheet(), true)}>
                  Create account-only character
                </button>
              )}
              <button disabled={loading} onClick={() => setReload((n) => n + 1)}>
                Refresh character list
              </button>
            </div>
          </details>
          {selected && (
            <CharacterEditor
              key={`${selectionContext}:${selected}`}
              id={selected}
              campaigns={data.campaigns}
              deviceCampaign={deviceCampaign}
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
  deviceCampaign,
}: {
  id: string;
  campaigns: Campaign[];
  changed: () => void;
  onDirty?: (dirty: boolean) => void;
  deviceCampaign?: DeviceCampaign;
}) {
  const currentSeat = useSeat();
  const playPrefix = useId(), editPrefix = useId();
  const playTabs = { tabId: (key: string) => `${playPrefix}-tab-${key}`, panelId: `${playPrefix}-panel` };
  const editTabs = { tabId: (key: string) => `${editPrefix}-tab-${key}`, panelId: `${editPrefix}-panel` };
  const [headerHeight, setHeaderHeight] = useState(80);
  useEffect(() => {
    const header = document.querySelector(".loot-shell header");
    if (!header) {
      setHeaderHeight(0);
      return;
    }
    const measure = () => setHeaderHeight(header.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const campaignEconomy = useEconomy();
  const activeCampaignId = useSyncExternalStore(
    subscribeCampaigns,
    getCampaigns,
    serverCampaigns,
  ).activeId;
  const loadedCampaign = useRef(activeCampaignId);
  const [playView, setPlayView] = useState(true),
    [playTab, setPlayTab] = useState("actions");
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
  // Only context identity changes reload the sheet; ledger refreshes must preserve drafts.
  const deviceCampaignRef = useRef(deviceCampaign);
  deviceCampaignRef.current = deviceCampaign;
  useEffect(() => {
    const currentDevice = deviceCampaignRef.current;
    const c = new AbortController();
    setDetail(null);
    setSheet(null);
    setError("");
    accountRequest<Detail>("sheets/detail", { id }, c.signal)
      .then((d) => {
        if (c.signal.aborted) return;
        loadedCampaign.current = activeCampaignId;
        setDetail(d);
        setSheet(d.body);
        const local =
          currentDevice &&
          readPartySheetLinks(currentDevice.ownerId, currentDevice.campaignId).find(
            (link) =>
              link.sheetId === id && currentDevice.purses.some((p) => p.id === link.purseId),
          );
        setCode(d.campaign_code || (local ? currentDevice!.code : ""));
        setPurse(d.purse_id || local?.purseId || "");
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e));
      });
    return () => c.abort();
  }, [id, reload, deviceCampaign?.code, deviceCampaign?.ownerId, activeCampaignId]);
  const dirty = !!sheet && JSON.stringify(sheet) !== JSON.stringify(detail?.body);
  useEffect(() => {
    onDirty?.(dirty);
    return () => onDirty?.(false);
  }, [dirty, onDirty]);
  useDraftGuard(dirty, "character");
  const liveRoom = getCloudTable();
  const livePurse = campaignEconomy.purses.find(
    (p) =>
      `party:${p.id}` === id ||
      p.profileId === id ||
      (liveRoom.joined && `campaign:${liveRoom.code}:${p.id}` === id),
  );
  const [remoteRefresh, setRemoteRefresh] = useState(0);
  useEffect(() => {
    // A saved account sheet can be open without joining that room on this device.
    // Refresh its authorized server projection, but never replace an unsaved draft.
    const refresh = () => {
      if (document.visibilityState !== "hidden") setRemoteRefresh((n) => n + 1);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const unsubscribe = subscribeSheetChanges(refresh);
    const timer = !livePurse ? window.setInterval(refresh, 10000) : undefined;
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [id, !!livePurse]);
  const liveSignature = livePurse
    ? JSON.stringify([
        livePurse,
        campaignEconomy.holdings.filter((h) => h.purseId === livePurse.id),
      ])
    : "";
  useEffect(() => {
    if (dirty || busy) return;
    const c = new AbortController();
    void accountRequest<Detail>("sheets/detail", { id }, c.signal)
      .then((d) => {
        if (!c.signal.aborted) {
          setDetail(d);
          setSheet(d.body);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e));
      });
    return () => c.abort();
  }, [liveSignature, remoteRefresh, dirty, busy, id]);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!sheet || !detail) return;
    setBusy(true);
    setError("");
    try {
      if (id.startsWith("party:") && loadedCampaign.current !== getCampaigns().activeId)
        throw Error("Reopen the character in the current campaign before saving.");
      const parsed = sheetSchema.parse(sheet);
      const outcome = await accountRequest<{ status?: "committed" | "pending" }>("sheets/save", {
        id,
        sheet: parsed,
        revision: detail.revision,
        before: detail.body,
      });
      const saved = await accountRequest<Detail>("sheets/detail", { id });
      setNotice(
        outcome.status === "pending"
          ? "Character changes saved in your pending turn. Submit the turn to share them."
          : id.startsWith("party:")
            ? "Character saved to this campaign."
            : "Character saved to your account.",
      );
      setDetail(saved);
      setSheet(saved.body);
      announceSheetChange();
      changed();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const importKey = useRef(crypto.randomUUID());
  async function assign() {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      if (deviceCampaign && code === deviceCampaign.code) {
        if (getCloudTable().joined || getCampaigns().activeId !== deviceCampaign.campaignId)
          throw new Error("Reopen the current campaign before linking this sheet.");
        const own = await accountRequest<{ userId: string; characters: Row[] }>("sheets");
        const current = own.characters.find((row) => row.id === id);
        if (own.userId !== deviceCampaign.ownerId || !current)
          throw new Error("Sign in to the sheet’s account before linking it.");
        if (current.campaign_code)
          throw new Error(
            "Choose Standalone character and save before linking a sheet assigned to an online campaign.",
          );
        const activeSeat = getSeat();
        const controlled = deviceCampaign.purses.filter(
          (p) => activeSeat.role === "dm" || activeSeat.purseIds.includes(p.id),
        );
        await bindCampaignProfile(purse, id, current.body);
        writePartySheetLink(
          own.userId,
          deviceCampaign.campaignId,
          id,
          purse,
          controlled.map((p) => p.id),
        );
        announceSheetChange();
        setNotice(
          "Character joined to this campaign. Party and Funds & inventory now use this character sheet. Existing campaign money and items were preserved.",
        );
        setReload((n) => n + 1);
        changed();
        return;
      }
      const result = await accountRequest<{ pending?: boolean }>("sheets/assign", {
        requestKey: importKey.current,
        id,
        code,
        purseId: purse,
        revision: detail.assignmentRevision ?? detail.revision,
      });
      importKey.current = crypto.randomUUID();
      if (result.pending) {
        setNotice(
          "Import submitted for DM review. Campaign stats, money and items remain unchanged until approval.",
        );
        return;
      }
      if (deviceCampaign) {
        await unbindCampaignProfile(id);
        writePartySheetLink(deviceCampaign.ownerId, deviceCampaign.campaignId, id, "", []);
      }
      announceSheetChange();
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
  const canPlay = detail.editable && !detail.assignmentError;
  const canEdit = (field: string) =>
    canPlay &&
    (!detail.campaign ||
      detail.campaign.role === "dm" ||
      canEditCharacterField(livePurse || detail.campaign, field));
  const editable = Object.keys(characterPermissions).some(canEdit);
  const deviceLink =
    deviceCampaign && !detail.campaign_code && editable
      ? readPartySheetLinks(deviceCampaign.ownerId, deviceCampaign.campaignId).find(
          (link) => link.sheetId === id,
        )
      : undefined;
  const devicePurse = deviceCampaign?.purses.find((p) => p.id === deviceLink?.purseId);
  const campaignLedger =
    detail.campaign ||
    (devicePurse
      ? {
          coins: devicePurse.coins,
          holdings: deviceCampaign!.holdings.filter((h) => h.purseId === devicePurse.id),
        }
      : null);
  const canManageInventory = canEdit("equipment");
  const canManageCurrency = canEdit("coins");
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
          disabled={!canEdit(group)}
          value={row.rank}
          onChange={(e) =>
            set(group, {
              ...sheet[group],
              [group === "saves" ? a : name]: {
                ...row,
                rank: number(e.target.value),
              },
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
          disabled={!canEdit(group)}
          value={row.extra}
          onChange={(e) =>
            set(group, {
              ...sheet[group],
              [group === "saves" ? a : name]: {
                ...row,
                extra: number(e.target.value),
              },
            })
          }
        />
      </div>
    );
  };
  return (
    <article className="play-sheet">
      <div className="character-title">
        <img src={sheet.portrait || "/art/portrait-default.webp"} alt="Character portrait" />
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
      <div className="play-mode-switch">
        <button aria-pressed={playView} onClick={() => setPlayView(true)}>
          Play sheet
        </button>
        <button aria-pressed={!playView} onClick={() => setPlayView(false)}>
          Edit sheet
        </button>
      </div>
      <ImportCharacterSheet
        label="Import into this character"
        disabled={!editable || busy || dirty}
        onImport={(imported, fields) => {
          const next = { ...sheet };
          for (const key of Object.keys(imported) as (keyof Sheet)[]) {
            if (key === "version" || !canEdit(key)) continue;
            if (!fields || fields.includes(key)) (next as any)[key] = imported[key];
            else {
              const parts = fields
                .filter((field) => field.startsWith(key + "."))
                .map((field) => field.slice(key.length + 1));
              if (parts.length)
                (next as any)[key] = {
                  ...(sheet as any)[key],
                  ...Object.fromEntries(parts.map((part) => [part, (imported as any)[key][part]])),
                };
            }
          }
          // Existing canonical item IDs are retained; imported items are new drafts.
          if (canEdit("equipment") && (!fields || fields.includes("equipment")))
            next.equipment = imported.equipment.map((item) => ({ ...item, id: undefined }));
          setSheet(next);
          setPlayView(false);
          setNotice(
            "Imported draft ready. Review each tab, then Save character. Restricted fields were preserved.",
          );
        }}
      />
      {canPlay && !editable && (
        <p role="status">
          Character editing is locked by the DM. Rolls, health, resources, equipped items and
          consumption remain available.
        </p>
      )}
      <div className="character-savebar" style={{ top: headerHeight + 8 }}>
        <strong role="status">
          {dirty
            ? "Unsaved changes — save before rolling"
            : editable
              ? "Saved character"
              : canPlay
                ? "Saved character"
                : "DM read-only view"}
        </strong>
        {canPlay && (
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
      {playView && (
        <section className="play-surface">
          <div className="play-vitals">
            <button
              onClick={() => {
                setPlayView(false);
                setTab("combat");
              }}
            >
              <Heart />
              <span>
                HP
                <strong>
                  {sheet.hp} / {sheet.maxHp}
                </strong>
              </span>
              <HpBar hp={sheet.hp} max={sheet.maxHp} />
            </button>
            <button
              onClick={() => {
                setPlayView(false);
                setTab("combat");
              }}
            >
              <Shield />
              <span>
                AC<strong>{sheet.ac}</strong>
              </span>
            </button>
            <button
              onClick={() => {
                setPlayView(false);
                setTab("details");
              }}
            >
              <Footprints />
              <span>
                Speed<strong>{sheet.speed}</strong>
              </span>
            </button>
          </div>
          {sheet.conditions && <p className="condition-pill">{sheet.conditions}</p>}
          <CharacterTabs
            options={[
              ["actions", "Actions"],
              ["spells", "Spells"],
              ["skills", "Skills"],
            ]}
            value={playTab}
            onChange={setPlayTab}
            label="Play sections"
            ids={playTabs}
          />
          <button
            type="button"
            onClick={() => {
              setPlayView(false);
              setTab("details");
            }}
          >
            Details
          </button>
          <div
            role="tabpanel"
            id={playTabs.panelId}
            aria-labelledby={playTabs.tabId(playTab)}
            tabIndex={0}
          >
            {playTab === "actions" && (
              <div className="play-actions">
                {rollButton(
                  `Initiative ${signed(bonusFor("dex", 0, sheet.initiative))}`,
                  "initiative",
                )}
                {sheet.attacks.map((a, i) => (
                  <div key={i} className="play-action-row">
                    <FantasyIcon entry={{ ...a, kind: "items" }} size={36} />
                    <div>
                      <h3>{a.name}</h3>
                      <p>
                        {signed(a.bonus)} to hit · {a.damage}
                      </p>
                      {a.notes && <small>{a.notes}</small>}
                      <div className="play-action-rolls">
                        {rollButton(`Roll ${a.name} attack`, "attack", String(i))}
                        {rollButton(`Roll ${a.name} damage`, "damage", String(i))}
                      </div>
                    </div>
                  </div>
                ))}
                {!sheet.attacks.length && <p>Add your attacks in Edit sheet → Combat.</p>}
              </div>
            )}
            {playTab === "spells" && (
              <div>
                {sheet.spells.map((spell, i) => (
                  <div className="play-action-row" key={i}>
                    <FantasyIcon entry={{ ...spell, kind: "spells" }} size={36} />
                    <div>
                      <h3>{spell.name}</h3>
                      <p>
                        Level {spell.level} · {spell.prepared ? "Prepared" : "Not prepared"}
                      </p>
                      <details>
                        <summary>Spell description</summary>
                        <p>{spell.description}</p>
                      </details>
                      {spell.formula && rollButton(`Roll ${spell.name}`, "spell", String(i))}
                    </div>
                  </div>
                ))}
                {!sheet.spells.length && <p>Add or import spells in Edit sheet → Spells.</p>}
              </div>
            )}
            {playTab === "skills" && (
              <div className="play-skills">
                {Object.entries(skills).map(([name, ability]) => {
                  const rank = sheet.skills[name] || { rank: 0, extra: 0 };
                  return (
                    <div key={name}>
                      {rollButton(
                        `${name} ${signed(bonusFor(ability as Ability, rank.rank, rank.extra))}`,
                        "skill",
                        name,
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="panel-heading mt-5">
            <h3>Resources</h3>
            <button
              onClick={() => {
                setPlayView(false);
                setTab("combat");
              }}
            >
              Manage
            </button>
          </div>
          {sheet.resources.map((r, i) => (
            <div className="play-resource" key={i}>
              <div>
                <strong>{r.name}</strong>
                <small>
                  {r.current} of {r.max} remaining
                </small>
              </div>
              <button
                disabled={!canPlay || busy || r.current <= 0}
                onClick={() =>
                  set(
                    "resources",
                    sheet.resources.map((x, j) =>
                      i === j ? { ...x, current: Math.max(0, x.current - 1) } : x,
                    ),
                  )
                }
              >
                Use
              </button>
            </div>
          ))}
          <button
            className="slot-summary"
            onClick={() => {
              setPlayView(false);
              setTab("spells");
            }}
          >
            Spell slots{" "}
            <span>{sheet.slots.reduce((n, x) => n + x.max - x.used, 0)} remaining · Manage →</span>
          </button>
          <a className="gold-link play-dice-link" href="#dice">
            <FantasyIcon ui="Dice" size={25} />
            Roll dice / manual result
          </a>
        </section>
      )}
      <fieldset disabled={busy} className="sheet-edit-fields">
        <div hidden={playView}>
          <CharacterTabs
            options={[
              ["combat", "Combat"],
              ["abilities", "Abilities & skills"],
              ["spells", "Spells"],
              ["gear", "Inventory & currency"],
              ["details", "Character details"],
            ]}
            value={tab}
            onChange={setTab}
            label="Character sheet sections"
            ids={editTabs}
          />
          <div
            role="tabpanel"
            id={editTabs.panelId}
            aria-labelledby={editTabs.tabId(tab)}
            tabIndex={0}
          >
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
                          disabled={k === "hp" || k === "tempHp" ? !canPlay : !canEdit(k)}
                          onChange={(v) => set(k, v)}
                        />
                      ))}
                    </div>
                    <HealthActions sheet={sheet} change={setSheet} disabled={!canPlay} />
                    <Text
                      label="Conditions"
                      value={sheet.conditions}
                      disabled={!canPlay}
                      onChange={(v) => set("conditions", v)}
                    />
                    <div className="field-grid">
                      <Num
                        label="Death save successes"
                        value={sheet.deathSuccesses}
                        max={3}
                        disabled={!canPlay}
                        onChange={(v) => set("deathSuccesses", v)}
                      />
                      <Num
                        label="Death save failures"
                        value={sheet.deathFailures}
                        max={3}
                        disabled={!canPlay}
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
                      disabled={!canPlay}
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
                      disabled={!canEdit("initiative")}
                      onChange={(v) => set("initiative", v)}
                    />
                    {sheet.attacks.map((a, i) => (
                      <div className="sheet-row" key={i}>
                        <Text
                          label={`Attack ${i + 1} name`}
                          value={a.name}
                          disabled={!canEdit("attacks")}
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
                            disabled={!canEdit("attacks")}
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
                            disabled={!canEdit("attacks")}
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
                          disabled={!canEdit("attacks")}
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
                          {canEdit("attacks") && (
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
                    {canEdit("attacks") && (
                      <button
                        onClick={() =>
                          set("attacks", [
                            ...sheet.attacks,
                            {
                              name: "New attack",
                              bonus: 0,
                              damage: "1d6",
                              notes: "",
                            },
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
                    disabled={!canEdit("hitDice")}
                    onChange={(v) => set("hitDice", v)}
                  />
                  {sheet.resources.map((r, i) => (
                    <div className="resource-row" key={i}>
                      <Text
                        label={`Resource ${i + 1} name`}
                        value={r.name}
                        disabled={!canEdit("resources")}
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
                        disabled={!canPlay}
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
                        disabled={!canEdit("resources")}
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
                          disabled={!canEdit("resources")}
                          value={r.recovery}
                          onChange={(e) =>
                            set(
                              "resources",
                              sheet.resources.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      recovery: e.target.value as "short" | "long" | "manual",
                                    }
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
                        disabled={!canPlay || r.current === 0}
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
                      {canEdit("resources") && (
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
                  {canEdit("resources") && (
                    <>
                      <button
                        onClick={() =>
                          set("resources", [
                            ...sheet.resources,
                            {
                              name: "New resource",
                              current: 1,
                              max: 1,
                              recovery: "long",
                            },
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
                              window.confirm(
                                "Restore HP, spell slots, and short/long-rest resources?",
                              )
                            )
                              setSheet({
                                ...sheet,
                                hp: sheet.maxHp,
                                deathSuccesses: 0,
                                deathFailures: 0,
                                slots: sheet.slots.map((s) => ({
                                  ...s,
                                  used: 0,
                                })),
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
                        Hit dice, conditions and custom rules are managed manually. Save after
                        resting.
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
                        disabled={!canEdit("scores")}
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
                    {Object.entries(skills).map(([name, a]) =>
                      trained(name, "skills", a as Ability),
                    )}
                    <p>
                      Passive Perception:{" "}
                      {10 +
                        bonusFor(
                          "wis",
                          sheet.skills.Perception?.rank,
                          sheet.skills.Perception?.extra,
                        )}
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
                    disabled={!canEdit("spellAbility")}
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
                    disabled={!canEdit("spellAttackExtra")}
                    onChange={(v) => set("spellAttackExtra", v)}
                  />
                  <Num
                    label="Spell DC extra bonus"
                    value={sheet.spellDcExtra}
                    min={-100}
                    disabled={!canEdit("spellDcExtra")}
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
                      disabled={!canEdit("slots")}
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
                      disabled={!canPlay}
                      onChange={(v) =>
                        set(
                          "slots",
                          sheet.slots.map((x, j) => (j === i ? { ...x, used: v } : x)),
                        )
                      }
                    />
                    <button
                      disabled={!canPlay || slot.used >= slot.max}
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
                {canEdit("slots") && sheet.slots.length < 9 && (
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
                      <FantasyIcon entry={{ ...s, kind: "spells" }} className="fantasy-inline" />
                      {s.name} · {s.level === 0 ? "Cantrip" : `Level ${s.level}`}{" "}
                      {s.prepared ? "· Prepared" : ""}
                    </summary>
                    <Text
                      label={`Spell ${i + 1} name`}
                      value={s.name}
                      disabled={!canEdit("spells")}
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
                      disabled={!canEdit("spells")}
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
                      disabled={!canEdit("spells")}
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
                      disabled={!canEdit("spells")}
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
                      disabled={!canEdit("spells")}
                      onChange={(v) =>
                        set(
                          "spells",
                          sheet.spells.map((x, j) => (j === i ? { ...x, description: v } : x)),
                        )
                      }
                    />
                    <p className="character-source">{s.source}</p>
                    {s.formula && rollButton(`Roll ${s.name}`, "spell", String(i))}
                    {canEdit("spells") && (
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
                {canEdit("spells") && (
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
                {campaignLedger ? (
                  <>
                    <p>
                      {devicePurse ? "Device campaign ledger." : "Live campaign ledger."} Use Party
                      or Market to move money and items.
                    </p>
                    <div className="sheet-vitals">
                      {Object.entries(campaignLedger.coins).map(([k, v]) => (
                        <strong key={k}>
                          {v} {k}
                        </strong>
                      ))}
                    </div>
                    <ul>
                      {campaignLedger.holdings.map((h) => (
                        <li key={h.id}>
                          {h.deed ? <LedgerArt kind="property" entry={h} /> : <FantasyIcon entry={h} size={28} className="fantasy-inline" />}
                          {h.name} × {h.quantity}
                        </li>
                      ))}
                    </ul>
                    <Link to="/party" search={{ action: "", section: "funds" }}>
                      Open party inventory
                    </Link>
                    <p>
                      {devicePurse
                        ? "This device campaign keeps its existing balances and inventory; linking a sheet does not transfer anything."
                        : "Funds & inventory and this sheet share the same items and balances. Live changes appear automatically when no edits are pending."}
                    </p>
                  </>
                ) : null}
                {(!campaignLedger || canManageCurrency) && (
                  <>
                    <p>Character currency. Campaign changes update Funds & inventory when saved.</p>
                    <div className="field-grid">
                      {(Object.keys(sheet.coins) as (keyof Sheet["coins"])[]).map((k) => (
                        <Num
                          key={k}
                          label={k.toUpperCase()}
                          value={sheet.coins[k]}
                          disabled={!canManageCurrency}
                          onChange={(v) => set("coins", { ...sheet.coins, [k]: v })}
                        />
                      ))}
                    </div>
                  </>
                )}
                <h4>Equipment & loadout</h4>
                <p>
                  Campaign equipment is the same inventory shown in Funds & inventory. Players can
                  equip or consume existing gear; adding and editing items requires the DM’s
                  inventory permission.
                </p>
                {sheet.equipment.map((item, i) => (
                  <div className="sheet-row" key={i}>
                    <CampaignInventoryArt item={item} holdings={campaignLedger?.holdings ?? []} />
                    <Text
                      label={`Item ${i + 1} name`}
                      value={item.name}
                      disabled={!canManageInventory}
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
                        disabled={!canPlay}
                        onChange={(v) =>
                          set(
                            "equipment",
                            sheet.equipment.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    quantity: canManageInventory ? v : Math.min(x.quantity, v),
                                  }
                                : x,
                            ),
                          )
                        }
                      />
                      <Num
                        label={`${item.name} unit weight`}
                        value={item.weight}
                        step="any"
                        disabled={!canEdit("equipment")}
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
                      disabled={!canPlay}
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
                      disabled={!canEdit("equipment")}
                      onChange={(v) =>
                        set(
                          "equipment",
                          sheet.equipment.map((x, j) => (j === i ? { ...x, notes: v } : x)),
                        )
                      }
                    />
                    {canManageInventory && (
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
                {canManageInventory && (
                  <button
                    onClick={() =>
                      set("equipment", [
                        ...sheet.equipment,
                        {
                          name: "New item",
                          quantity: 1,
                          weight: 0,
                          equipped: false,
                          notes: "",
                        },
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
                      disabled={!canEdit(k)}
                      onChange={(v) => set(k, v)}
                    />
                  ))}
                  <Num
                    label="Character level"
                    value={sheet.level}
                    min={1}
                    max={20}
                    disabled={!canEdit("level")}
                    onChange={(v) => set("level", v)}
                  />
                  <Num
                    label="Proficiency bonus"
                    value={sheet.proficiency}
                    max={20}
                    disabled={!canEdit("proficiency")}
                    onChange={(v) => set("proficiency", v)}
                  />
                  <label>
                    Rules edition
                    <select
                      aria-label="Rules edition"
                      disabled={!canEdit("edition")}
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
                {canEdit("portrait") && (
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
                    disabled={!canEdit(k)}
                    onChange={(v) => set(k, v)}
                  />
                ))}
                {editable && !id.startsWith("party:") && !id.startsWith("campaign:") && (
                  <>
                    <h4>Campaign assignment</h4>
                    {!detail.campaign && currentSeat.role === "dm" && (
                      <button
                        disabled={dirty || busy}
                        onClick={async () => {
                          setBusy(true);
                          setError("");
                          try {
                            const work = async () => {
                              const target = await createCampaignCharacter(sheet);
                              await bindCampaignProfile(target, id, sheet);
                            };
                            if (getCloudTable().joined) await runSharedMutation(work);
                            else await work();
                            announceSheetChange();
                            setReload((n) => n + 1);
                            changed();
                            setNotice(
                              "Character added to the current campaign with its funds and inventory.",
                            );
                          } catch (e) {
                            setError(errorText(e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Add to current campaign
                      </button>
                    )}
                    <p>
                      A character belongs to one campaign at a time. The campaign DM can view the
                      assigned sheet; its rolls are visible to campaign members. Save changes before
                      assigning. Player imports require DM approval; campaign money and items are
                      preserved.
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
                        {!!deviceCampaign?.purses.length && (
                          <option value={deviceCampaign.code}>
                            {deviceCampaign.name} · this device
                          </option>
                        )}
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
                          {(deviceCampaign?.code === code
                            ? deviceCampaign.purses
                            : campaigns.find((c) => c.code === code)?.purses
                          )?.map((p) => (
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
                    <p>
                      {deviceCampaign?.code === code
                        ? "This link is saved for this account and campaign on this device. Your account sheet stays private; online campaign membership and roll sharing are unchanged."
                        : "Missing a campaign? Save its membership from My account first."}
                    </p>
                  </>
                )}
              </section>
            )}
          </div>
        </div>
        <section className="sheet-card" id="dice">
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
  const { prefs } = usePrefs();
  const manual = prefs.rollMode === "manual";
  const allowed = !detail.campaign_code || !!detail.campaign?.manualAllowed;
  const [manualTotal, setManualTotal] = useState("");
  const validTotal =
    manualTotal.trim() !== "" &&
    Number.isSafeInteger(Number(manualTotal)) &&
    Math.abs(Number(manualTotal)) <= 100000;
  const [mode, setMode] = useState("normal"),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState("");
  const retry = useRef({ signature: "", key: "" });
  async function roll() {
    if (manual && (!allowed || !validTotal)) return;
    setBusy(true);
    try {
      const signature = JSON.stringify([
        detail.id,
        detail.revision,
        kind,
        rollKey,
        mode,
        manual,
        manualTotal,
      ]);
      if (retry.current.signature !== signature)
        retry.current = { signature, key: crypto.randomUUID() };
      const r = await accountRequest<Roll>("sheets/roll", {
        id: detail.id,
        revision: detail.revision,
        kind,
        key: rollKey,
        mode,
        manual,
        ...(manual ? { total: Number(manualTotal) } : {}),
        requestKey: retry.current.key,
      });
      setResult(
        r.source === "manual"
          ? `${r.total} · Manual result`
          : `${r.total} · ${r.dice.join(", ")} ${signed(r.modifier)} · ${r.mode}`,
      );
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
      {manual && (
        <label>
          {label} · final total
          <input
            aria-label={`${label} manual total`}
            type="number"
            step="1"
            min="-100000"
            max="100000"
            value={manualTotal}
            disabled={disabled || busy || !allowed}
            onChange={(e) => setManualTotal(e.target.value)}
          />
        </label>
      )}
      {manual && !allowed && <p>The DM has disabled manual rolls in this campaign.</p>}
      <button
        disabled={disabled || busy || (manual && (!allowed || !validTotal))}
        onClick={() => void roll()}
      >
        {manual ? `Record ${label.replace(/^Roll /, "")}` : label}
      </button>
      {d20 && !manual && (
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
  const { prefs, setPrefs } = usePrefs();
  const manual = prefs.rollMode === "manual";
  const setManual = (value: boolean) => setPrefs({ rollMode: value ? "manual" : "virtual" });
  const [formula, setFormula] = useState("1d20"),
    [label, setLabel] = useState("Custom roll"),
    [total, setTotal] = useState(""),
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
      ...(manual ? { total: total.trim() === "" ? undefined : Number(total) } : {}),
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
        `${r.label}: ${r.total} · ${r.source === "manual" ? "Manual result" : `${r.source === "device" ? "Device" : "Server"} roll [${r.dice.join(", ")}] ${signed(r.modifier)}`}`,
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
      <p>
        Examples: 1d20+5, 2d6+3. Changing the roll source also changes your device’s Roll mode
        setting.
      </p>
      <Check label="Enter a manual total" value={manual} disabled={!allowed} onChange={setManual} />
      {!allowed && <p>The DM has disabled manual rolls. Reload the sheet after a policy change.</p>}
      {manual && (
        <label>
          Manual roll total
          <input
            aria-label="Manual roll total"
            type="number"
            step="1"
            min="-100000"
            max="100000"
            required
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
          <span>Final total, including modifiers.</span>
        </label>
      )}
      <button disabled={disabled || busy || (manual && !allowed)}>
        {busy ? "Recording…" : manual ? "Record manual roll" : "Roll dice"}
      </button>
      {result && <p role="status">{result}</p>}
    </form>
  );
}
export function RollLog({
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
        <h3>
          {id.startsWith("party:")
            ? "Character roll log"
            : code
              ? "Campaign roll log"
              : "Private roll log"}
        </h3>
        <button disabled={busy} onClick={() => setTick((n) => n + 1)}>
          Refresh roll log
        </button>
      </div>
      <p>
        {code
          ? "Visible to current campaign members."
          : id.startsWith("party:")
            ? "Saved with this character on this device."
            : "Visible only to your account."}{" "}
        Results are retained; load older rolls to review earlier sessions.
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
      <h2 id="dm-roll-controls">DM character & roll controls</h2>
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
              key={`${code}:${selected}`}
              id={selected}
              campaigns={campaigns}
              changed={() => setReload((n) => n + 1)}
            />
          )}
          <FeatureLink feature="review" campaignCode={code}>
            Review character imports
          </FeatureLink>
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
            const r = await searchOpen5e({
              data: { kind: "spells", edition, query, page: 1 },
            });
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
          <strong>
            <FantasyIcon entry={e} className="fantasy-inline" />
            {e.name}
          </strong>
          <p>{e.facts.join(" · ")}</p>
          <button onClick={() => onAdd(e)}>Add {e.name}</button>
          <small>{e.source}</small>
        </div>
      ))}
    </details>
  );
}
