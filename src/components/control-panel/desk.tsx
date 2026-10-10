import { inParty } from "@/lib/quire/character-position";
import { localEncounterRequest } from "@/lib/encounters/local";
import { encounterRequest } from "@/lib/encounters/client";
import { FeatureCards } from "../feature-navigation";
import { AppLink } from "@/components/app-link";
import { FantasyIcon } from "@/components/fantasy-icon";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { useEconomy } from "@/lib/quire/economy-context";
import { getCampaigns, serverCampaigns, subscribeCampaigns } from "@/lib/quire/campaigns";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { formatCopper, toCopper } from "@/lib/quire/money";
import { sessionSummary } from "@/lib/quire/journal";
import { accountRequest } from "@/lib/account/client";
import { LedgerArt } from "@/components/ledger-art";
import { Guide } from "@/components/guide";
import { Fold } from "@/components/ui";
import { Shortcuts } from "./shortcuts";
import { HomeBoard } from "../home-board";
import { useSheetReadouts, HpBar } from "./readouts";
import { InformationStrip } from "./information-strip";
import type { Purse } from "@/lib/quire/types";
import { roomStatusLabels } from "@/lib/quire/room-state";
import { getOnline, subscribeOnline } from "@/lib/mobile/online";
type Roll = NonNullable<Purse["rolls"]>[number];

export function DmDesk() {
  const campaigns = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  return <DmDeskContents key={`${campaigns.activeId}:${room.joined ? room.code : "device"}`} />;
}

function DmDeskContents() {
  const { ready, purses, sheets, journal, loans, ledger, holdings } = useEconomy(),
    profiles = useSheetReadouts();
  const campaigns = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns),
    room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const online = useSyncExternalStore(subscribeOnline, getOnline, () => true);
  const status = roomStatusLabels(room, { online, ready });
  const savedShortcuts = new URLSearchParams(search).get("customize") === "1";
  const [encounter, setEncounter] = useState<{
      name: string;
      status: string;
      round?: number;
    } | null>(null),
    [encounterState, setEncounterState] = useState("");
  const [imports, setImports] = useState<number | null>(null),
    [importError, setImportError] = useState(false),
    [sharedRolls, setSharedRolls] = useState<Roll[]>([]),
    [rollState, setRollState] = useState(""),
    [refresh, setRefresh] = useState(0);
  const contextKey = `${campaigns.activeId}:${room.joined ? room.code : "device"}`;
  useEffect(() => {
    const c = new AbortController();
    setEncounter(null);
    setEncounterState("Loading encounter…");
    const load = room.joined ? accountRequest : localEncounterRequest;
    load<{ encounters: { id: string; code: string; name: string; status: string }[] }>(
      "encounters",
      undefined,
      c.signal,
    )
      .then(async (d) => {
        const rows = d.encounters.filter(
          (x) => x.code === (room.joined ? room.code : "device") && x.status !== "awarded",
        );
        const x = rows.find((x) => x.status === "active") || rows[0];
        if (x) {
          const detail = await encounterRequest<{ body: { round: number } }>(
            "encounters/detail",
            { id: x.id },
            c.signal,
          );
          if (!c.signal.aborted) setEncounter({ ...x, round: detail.body.round });
        }
        if (!c.signal.aborted) setEncounterState("");
      })
      .catch(() => {
        if (!c.signal.aborted) setEncounterState("Encounter unavailable");
      });
    return () => c.abort();
  }, [contextKey, room.revision, room.joined, room.code]);
  useEffect(() => {
    const c = new AbortController();
    setImports(null);
    setImportError(false);
    setSharedRolls([]);
    setRollState(room.joined ? "Loading campaign rolls…" : "");
    if (room.joined) {
      void accountRequest<{ requests: { status: string }[] }>(
        "sheets/imports",
        { code: room.code },
        c.signal,
      )
        .then((r) => {
          if (!c.signal.aborted)
            setImports(r.requests.filter((x) => x.status === "pending").length);
        })
        .catch(() => {
          if (!c.signal.aborted) setImportError(true);
        });
      void accountRequest<{ rolls: Roll[] }>("sheets/log", { code: room.code }, c.signal)
        .then((r) => {
          if (!c.signal.aborted) {
            setSharedRolls(r.rolls);
            setRollState("");
          }
        })
        .catch(() => {
          if (!c.signal.aborted)
            setRollState("Campaign rolls unavailable. Refresh or open the full log.");
        });
    }
    return () => c.abort();
  }, [contextKey, room.revision, room.joined, room.code, refresh]);
  const party = purses.filter((p) => p.kind === "character" && inParty({ purses, journal }, p)),
    session = journal.sessions.find((x) => !x.endedAt),
    fund = purses.filter((p) => p.kind === "party").reduce((sum, p) => sum + toCopper(p.coins), 0),
    pending =
      journal.requests.filter((x) => x.status === "pending").length +
      loans.filter((x) => x.status === "pending").length,
    totals = session ? sessionSummary(ledger, session) : null,
    allCoins = purses
      .filter((p) => inParty({ purses, journal }, p))
      .reduce((sum, p) => sum + toCopper(p.coins), 0),
    goods = holdings
      .filter((h) => purses.some((p) => p.id === h.purseId && inParty({ purses, journal }, p)))
      .reduce((sum, h) => sum + h.unitCopper * h.quantity, 0),
    rolls = (room.joined ? sharedRolls : purses.flatMap((p) => p.rolls || []))
      .slice()
      .sort((a, b) => b.at - a.at)
      .slice(0, 4),
    recent = [
      ...ledger.map((x) => ({ ...x, type: "Transaction" })),
      ...journal.events.map((x) => ({ ...x, type: "Campaign" })),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, 4),
    scale = totals ? Math.max(1, totals.received, totals.spent) : 1;
  return (
    <div className="dm-control-panel swipe-dm-desk">
      <div className="desk-readouts">
        <div className="panel-heading">
          <h1>Campaign control</h1>
          <Guide />
        </div>
        <div className="desk-connection-row">
          <p className="desk-status">
            <span className={room.status === "attention" ? "status-attention" : "status-dot"} />
            {[status.mode, status.room, status.play, status.turn, status.save]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <AppLink href="/share?tab=room" className="multiplayer-settings">
            <Users size={18} />
            Multiplayer settings
          </AppLink>
        </div>
        <div className="readout-grid desk-pinned-readouts">
          <AppLink href="/encounters?resume=1" className="readout">
            <FantasyIcon ui="Encounters" size={30} />
            <span>
              <small>{encounter?.status === "active" ? "Active encounter" : "Encounter"}</small>
              <strong>
                {encounter
                  ? encounter.status === "active"
                    ? `Round ${encounter.round || 1}`
                    : "Ready to play"
                  : encounterState || "Choose encounter"}
              </strong>
              {encounter && <small>{encounter.name}</small>}
            </span>
          </AppLink>
          <AppLink href="/features/review?from=%2F" className="readout">
            <FantasyIcon ui="gift" size={30} />
            <span>
              <small>Pending reviews</small>
              <strong>{imports === null ? `${pending} financial` : pending + imports}</strong>
              <small>
                {pending} financial
                {room.joined
                  ? imports !== null
                    ? ` · ${imports} imports`
                    : importError
                      ? " · Imports unavailable"
                      : " · Imports loading…"
                  : " · Imports online"}
              </small>
            </span>
          </AppLink>
        </div>
      </div>
      <InformationStrip
        resetKey={contextKey}
        panels={[
          {
            name: "Session",
            content: (
              <>
                <h2>Current session</h2>
                <AppLink href="/?view=home#sessions" className="readout session-readout">
                  <FantasyIcon ui="Campaign" size={30} />
                  <span>
                    <small>Recorded play session</small>
                    <strong>{session?.name || "No active session"}</strong>
                  </span>
                </AppLink>
                <p>
                  {party.length} party {party.length === 1 ? "character" : "characters"} · Campaign
                  day {journal.finance?.day ?? 0}
                </p>
                <p>{encounter?.name || "Choose an encounter when you are ready."}</p>
                <AppLink className="information-action" href="/?view=home#sessions">
                  Open session controls →
                </AppLink>
              </>
            ),
          },
          {
            name: "Party",
            content: (
              <>
                <h2>Party at a glance</h2>
                <small>
                  Showing {Math.min(4, party.length)} of {party.length} characters
                </small>
                <div className="information-party">
                  {party.slice(0, 4).map((p) => {
                    const live = profiles.find((x) => x.purse_id === p.id),
                      old = sheets.find((s) => s.purseId === p.id);
                    return (
                      <AppLink
                        key={p.id}
                        href={
                          live
                            ? `/characters?id=${encodeURIComponent(live.id)}`
                            : `/party#purse-${p.id}`
                        }
                      >
                        <LedgerArt
                          kind="portrait"
                          src={live?.body.portrait || p.portrait}
                          className="round"
                        />
                        <span>
                          <strong>{p.name}</strong>
                          {!!live?.body.maxHp && <HpBar hp={live.body.hp} max={live.body.maxHp} />}
                        </span>
                        <small>
                          {live?.body.maxHp
                            ? `${live.body.hp}/${live.body.maxHp} HP`
                            : old?.hitPoints
                              ? `${old.hitPoints} HP`
                              : "HP —"}
                          {!!live?.body.ac && <span>AC {live.body.ac}</span>}
                        </small>
                      </AppLink>
                    );
                  })}
                </div>
                {!party.length && <p>No characters yet. Add your party to see their readouts.</p>}
                <AppLink href="/party" className="information-action">
                  View all characters →
                </AppLink>
              </>
            ),
          },
          {
            name: "Funds",
            content: (
              <>
                <h2>Party funds</h2>
                <strong className="information-value">{formatCopper(fund)}</strong>
                <small>Shared party purses</small>
                {totals ? (
                  <>
                    <p>Current session · all campaign accounts</p>
                    <div className="information-bars">
                      {[
                        ["Received", totals.received],
                        ["Spent", totals.spent],
                      ].map(([label, amount]) => (
                        <div key={label} className="information-bar">
                          <span>{label}</span>
                          <span className="information-bar-track" aria-hidden="true">
                            <span
                              className={label === "Spent" ? "outgoing" : ""}
                              style={{ width: `${(Number(amount) / scale) * 100}%` }}
                            />
                          </span>
                          <strong>{formatCopper(Number(amount))}</strong>
                        </div>
                      ))}
                    </div>
                    <small>Account transfers excluded from received and spent.</small>
                  </>
                ) : (
                  <p>Start a play session to chart received and spent coins.</p>
                )}
                <dl className="information-totals">
                  <div>
                    <dt>All account coins</dt>
                    <dd>{formatCopper(allCoins)}</dd>
                  </div>
                  <div>
                    <dt>Goods & property value</dt>
                    <dd>{formatCopper(goods)}</dd>
                  </div>
                </dl>
                <AppLink href="/party?section=funds" className="information-action">
                  Open funds & inventory →
                </AppLink>
              </>
            ),
          },
          {
            name: "Activity",
            content: (
              <>
                <h2>Activity log</h2>
                <small>
                  Latest {recent.length} of {ledger.length + journal.events.length} recorded events
                </small>
                <ol className="information-log">
                  {recent.map((line) => (
                    <li key={`${line.type}-${line.id}`}>
                      <time dateTime={new Date(line.at).toISOString()}>
                        {new Date(line.at).toLocaleString()} · {line.type}
                      </time>
                      <span>{line.summary}</span>
                      {"copper" in line && (
                        <strong>
                          {line.copper < 0 ? "−" : line.copper > 0 ? "+" : ""}
                          {formatCopper(Math.abs(line.copper))}
                        </strong>
                      )}
                    </li>
                  ))}
                </ol>
                {!recent.length && <p>No recorded activity yet.</p>}
                <AppLink href="/features/reports?from=%2F" className="information-action">
                  Open full activity & reports →
                </AppLink>
              </>
            ),
          },
          {
            name: "Rolls",
            content: (
              <>
                <div className="panel-heading">
                  <h2>Roll log</h2>
                  {room.joined && <button onClick={() => setRefresh((n) => n + 1)}>Refresh</button>}
                </div>
                <p>
                  {room.joined ? "Shared campaign results" : "Character rolls saved on this device"}
                </p>
                {rollState && <p role="status">{rollState}</p>}
                <ol className="information-rolls">
                  {rolls.map((roll) => (
                    <li key={`${roll.characterId}-${roll.id}`}>
                      <strong>{roll.total}</strong>
                      <span>
                        {roll.character} · {roll.label}
                        <small>
                          {roll.source === "manual" ? "Manual result" : "App roll"} · {roll.formula}
                        </small>
                      </span>
                    </li>
                  ))}
                </ol>
                {!rolls.length && !rollState && <p>No rolls recorded yet.</p>}
                <AppLink
                  href={room.joined ? "/share?tab=rolls" : "/characters#dice"}
                  className="information-action"
                >
                  Open dice & full roll history →
                </AppLink>
              </>
            ),
          },
        ]}
      />
      <FeatureCards grouped />
      <section className="dm-campaign-details" aria-label="Detailed campaign controls">
        <HomeBoard embedded />
      </section>
      {savedShortcuts && (
        <Fold anchorId="saved-shortcuts" title="Saved shortcut settings" defaultOpen>
          <p>
            Your saved shortcuts remain available here. The main Desk uses information panels and
            grouped tools.
          </p>
          <Shortcuts campaignId={campaigns.activeId} />
        </Fold>
      )}
    </div>
  );
}
