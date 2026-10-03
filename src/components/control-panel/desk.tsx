import { localEncounterRequest } from "@/lib/encounters/local";
import { encounterRequest } from "@/lib/encounters/client";
import { AppLink } from "@/components/app-link";
import { FantasyIcon } from "@/components/fantasy-icon";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEconomy } from "@/lib/quire/economy-context";
import { getCampaigns, serverCampaigns, subscribeCampaigns } from "@/lib/quire/campaigns";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { formatCopper, toCopper } from "@/lib/quire/money";
import { accountRequest } from "@/lib/account/client";
import { LedgerArt } from "@/components/ledger-art";
import { Guide } from "@/components/guide";
import { Shortcuts } from "./shortcuts";
import { DesktopDeskPanels } from "./desktop-panels";
import { useSheetReadouts, HpBar } from "./readouts";
export function DmDesk() {
  const { ready, purses, sheets, journal, loans } = useEconomy(),
    profiles = useSheetReadouts();
  const campaigns = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns),
    room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const [encounter, setEncounter] = useState<{
      name: string;
      status: string;
      round?: number;
    } | null>(null),
    [accountState, setAccountState] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setEncounter(null);
    setAccountState("");
    const load = room.joined ? accountRequest : localEncounterRequest;
    load<{
      encounters: { id: string; code: string; name: string; status: string }[];
    }>("encounters", undefined, c.signal)
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
      })
      .catch(() => {
        if (!c.signal.aborted) setAccountState("Sign in to view");
      });
    return () => c.abort();
  }, [room.code, room.joined, room.revision, campaigns.activeId]);
  const party = purses.filter((p) => p.kind === "character"),
    session = journal.sessions.find((x) => !x.endedAt),
    fund = purses.filter((p) => p.kind === "party").reduce((sum, p) => sum + toCopper(p.coins), 0),
    pending =
      journal.requests.filter((x) => x.status === "pending").length +
      loans.filter((x) => x.status === "pending").length;
  return (
    <div className="dm-control-panel">
      <div className="desk-readouts">
        <div className="panel-heading">
          <h1>Campaign control</h1>
          <Guide />
        </div>
        <p className="desk-status">
          <span className={room.status === "attention" ? "status-attention" : "status-dot"} />
          {room.joined ? (room.live ? "Live" : "Turn-based") : "Local"} ·{" "}
          {room.joined
            ? room.status === "synced"
              ? "Saved"
              : room.status === "attention"
                ? "Needs attention"
                : room.pending
                  ? "Changes pending"
                  : "Connecting"
            : ready
              ? "Saved on device"
              : "Opening campaign"}
        </p>
        <div className="readout-grid">
          <AppLink href="/?view=overview#journal" className="readout">
            <FantasyIcon ui="Campaign" size={30} />
            <span>
              <small>Current session</small>
              <strong>{session?.name || "No active session"}</strong>
            </span>
          </AppLink>
          <AppLink href="/party?section=funds" className="readout">
            <FantasyIcon ui="Treasury" size={30} />
            <span>
              <small>Party funds</small>
              <strong>{formatCopper(fund)}</strong>
            </span>
          </AppLink>
          <AppLink href="/?view=overview#review" className="readout">
            <FantasyIcon ui="gift" size={30} />
            <span>
              <small>Pending reviews</small>
              <strong>{pending}</strong>
            </span>
          </AppLink>
          <AppLink href="/encounters?resume=1" className="readout">
            <FantasyIcon ui="Encounters" size={30} />
            <span>
              <small>Encounter</small>
              <strong>
                {encounter ? `Round ${encounter.round || 1}` : accountState || "Choose encounter"}
              </strong>
              {encounter && <small>{encounter.name}</small>}
            </span>
          </AppLink>
        </div>
        <section className="party-glance">
          <div className="panel-heading">
            <h2>Party at a glance</h2>
            <Link to="/party">
              View all <ChevronRight size={15} />
            </Link>
          </div>
          <div className="glance-strip">
            {party.map((p) => {
              const live = profiles.find((x) => x.purse_id === p.id),
                old = sheets.find((s) => s.purseId === p.id);
              return (
                <AppLink
                  href={
                    live ? `/characters?id=${encodeURIComponent(live.id)}` : `/party#purse-${p.id}`
                  }
                  key={p.id}
                >
                  <LedgerArt
                    kind="portrait"
                    src={live?.body.portrait || p.portrait}
                    className="round"
                  />
                  <span>{p.name.split(" ")[0]}</span>
                  <small>
                    {live?.body.maxHp
                      ? `${live.body.hp}/${live.body.maxHp}`
                      : old?.hitPoints
                        ? `${old.hitPoints} HP`
                        : "HP —"}
                  </small>
                  {!!live?.body.maxHp && <HpBar hp={live.body.hp} max={live.body.maxHp} />}
                </AppLink>
              );
            })}
          </div>
          {!party.length && <Link to="/party">Add your party’s characters →</Link>}
        </section>
      </div>
      <Shortcuts campaignId={campaigns.activeId} />
      <DesktopDeskPanels />
      <AppLink href="/?view=overview" className="desk-overview">
        Full campaign overview, activity & tools <ChevronRight size={18} />
      </AppLink>
    </div>
  );
}
