import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { toast } from "sonner";
import type { CloudTable } from "@/lib/quire/cloud";
import type { CommandRequest } from "@/lib/quire/commands";
import { useEconomy } from "@/lib/quire/economy-context";
import type { ZoneRequest } from "@/lib/quire/world-schema";
import { zoneName } from "@/lib/quire/zones";

type Seat = { role: string; purseIds: string[] };
const nameOf = (t: Pick<CloudTable, "purses">, id: string) => t.purses.find((p) => p.id === id)?.name ?? "A character";
const mapName = (t: Pick<CloudTable, "journal">, id: string) => t.journal?.world?.maps.find((m) => m.id === id)?.name ?? "another map";
function left(deadline: number, now: number) {
  const s = Math.max(0, Math.round((deadline - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function Tally({ r }: { r: ZoneRequest }) {
  const t = r.tally ?? { yes: 0, no: 0, waiting: 0 };
  const total = t.yes + t.no + t.waiting;
  return (
    <span className="map-zone-tally" aria-label={`${t.yes} yes, ${t.no} no, ${t.waiting} waiting`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < t.yes ? "y" : i < t.yes + t.no ? "n" : undefined} aria-hidden="true" />
      ))}{" "}
      {t.yes} yes · {t.no} no · {t.waiting} waiting
    </span>
  );
}

/**
 * Split requests on the map (map tokens PR 7A; mockup zones frame 2): the mover's "Asking the
 * party…" or "Waiting for the session to end" card with Withdraw, and a voter's "Mira wants to
 * leave Testville" card with Let Mira go / Keep together. Votes settle at their deadline from
 * whichever client is open (the server checks the time); a decided request becomes a toast.
 */
export function MapZoneRequests({ table, seat }: { table: Pick<CloudTable, "journal" | "purses">; seat: Seat }) {
  const { commandOutcome } = useEconomy();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState("");
  const requests = (table.journal?.world?.zoneRequests ?? []).filter((r) => r.status === "open");
  const mine = requests.filter((r) => seat.purseIds.includes(r.purseId));
  const ballots = requests.filter((r) => r.mode === "vote" && !seat.purseIds.includes(r.purseId) && r.tally?.mine !== undefined);
  const deadlines = [...mine, ...ballots].map((r) => r.deadline).filter((d): d is number => d !== undefined);
  useEffect(() => {
    if (!deadlines.length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadlines.length]);
  // At the deadline, settle the vote (lazily; the server refuses an early settle).
  const settled = useRef(new Set<string>());
  useEffect(() => {
    for (const r of [...mine, ...ballots]) {
      if (r.deadline === undefined || now < r.deadline + 500 || settled.current.has(r.id)) continue;
      settled.current.add(r.id);
      void commandOutcome({ kind: "zone-request-resolve", requestId: r.id, action: "settle" }).catch(() => undefined);
    }
  });
  // A decided request of this seat's becomes a toast once.
  const seen = useRef<Map<string, string>>(new Map());
  const own = (table.journal?.world?.zoneRequests ?? []).filter((r) => seat.purseIds.includes(r.purseId));
  useEffect(() => {
    for (const r of own) {
      const before = seen.current.get(r.id);
      seen.current.set(r.id, r.status);
      if (before !== "open" || r.status === "open") continue;
      const who = nameOf(table, r.purseId),
        from = zoneName(table, r.fromZone);
      if (r.status === "applied")
        toast.warning(`You left ${from}. You're now separate from the party.`, { description: `${who} is in ${mapName(table, r.toMapId)}. Come back to ${from} to rejoin.`, duration: 12000 });
      else if (r.reason && r.status !== "withdrawn") toast.info(r.reason);
    }
  });
  if (seat.role === "dm" || (!mine.length && !ballots.length)) return null;
  const send = async (input: CommandRequest, key: string) => {
    setBusy(key);
    try {
      await commandOutcome(input);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="map-zone-cards" aria-label="Party-split requests">
      {mine.map((r) => {
        const who = nameOf(table, r.purseId),
          to = mapName(table, r.toMapId),
          from = zoneName(table, r.fromZone);
        const session = table.journal?.sessions.find((s) => s.id === r.sessionId);
        return r.mode === "vote" ? (
          <section key={r.id} className="map-zone-card map-glass" role="status" aria-label="Asking the party">
            <h3>Asking the party…</h3>
            <p>
              Going to <b>{to}</b> would split {who} off. Your DM set this to a party vote ({r.majority === "unanimous" ? "unanimous" : "majority"}).
            </p>
            <Tally r={r} />
            <div className="map-zone-row">
              <button type="button" className="map-zone-ghost" disabled={!!busy} onClick={() => void send({ kind: "zone-request-withdraw", requestId: r.id }, r.id)}>
                Withdraw
              </button>
              {r.deadline !== undefined && (
                <span className="map-zone-timer">
                  <Clock size={14} aria-hidden="true" /> {left(r.deadline, now)} left
                </span>
              )}
            </div>
            <small>Your token stays in {from} until the vote passes. A tie keeps the party together.</small>
          </section>
        ) : (
          <section key={r.id} className="map-zone-card map-glass" role="status" aria-label="Waiting for the session to end">
            <h3>Waiting for the session to end</h3>
            <p>
              {who} will go to <b>{to}</b> when the DM ends the session, if it still makes sense then. The DM may also decide sooner.
            </p>
            <div className="map-zone-row">
              <span className="map-zone-chip">
                <Clock size={14} aria-hidden="true" /> Queued{session ? ` · ${session.name}` : ""}
              </span>
              <button type="button" className="map-zone-ghost" disabled={!!busy} onClick={() => void send({ kind: "zone-request-withdraw", requestId: r.id }, r.id)}>
                Withdraw
              </button>
            </div>
            <small>If the party moves first, the DM sees whether this request still applies.</small>
          </section>
        );
      })}
      {ballots.map((r) => {
        const who = nameOf(table, r.purseId),
          to = mapName(table, r.toMapId),
          from = zoneName(table, r.fromZone),
          vote = r.tally?.mine ?? null;
        return (
          <section key={r.id} className="map-zone-card map-glass" role="alertdialog" aria-label="Party vote">
            <h3>
              {who} wants to leave {from}
            </h3>
            <p>
              If the vote passes, {who} goes to {to} and is no longer with the party. You can merge again when you meet up.
            </p>
            <Tally r={r} />
            <div className="map-zone-row">
              <button type="button" className="map-zone-primary" aria-pressed={vote === "yes"} disabled={!!busy} onClick={() => void send({ kind: "zone-vote", requestId: r.id, vote: "yes" }, r.id)}>
                Let {who} go
              </button>
              <button type="button" className="map-zone-ghost" aria-pressed={vote === "no"} disabled={!!busy} onClick={() => void send({ kind: "zone-vote", requestId: r.id, vote: "no" }, r.id)}>
                Keep together
              </button>
              {r.deadline !== undefined && (
                <span className="map-zone-timer">
                  <Clock size={14} aria-hidden="true" /> {left(r.deadline, now)}
                </span>
              )}
            </div>
            <small>The DM can approve or reject at any time. You can change your vote until it closes.</small>
          </section>
        );
      })}
    </div>
  );
}
