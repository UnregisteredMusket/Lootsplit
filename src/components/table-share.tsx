import {getCloudTable, getServerCloudTable, subscribeCloudTable} from "@/lib/quire/cloud-client";
import { useState, useSyncExternalStore } from "react";
import { API_ORIGIN } from "@/lib/mobile/origin";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { characterControl } from "@/lib/quire/types";
import { useSeat } from "@/lib/quire/seat";
import { copyText } from "@/lib/quire/table";
import { Button, Confirm } from "@/components/ui";

export function TableShare() {
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const { purses } = useEconomy();
  const characters = purses.filter(p => p.kind === "character" && characterControl(p) !== "npc");
  async function copyPlayerLink(id: string) {
    const current = getCloudTable();
    if (!current.joined || current.role !== "dm") throw Error("Start a session before inviting players.");
    if (!current.lastSync) throw Error("Wait for the current session to finish loading before copying its invitation.");
    const origin = import.meta.env.VITE_MOBILE === "true" ? API_ORIGIN : window.location.origin;
    const url = new URL("/share", origin);
    url.searchParams.set("join", current.code);
    url.searchParams.set("session", current.sessionId);
    url.searchParams.set("character", id);
    await copyText(url.href);
    toast.success("Current session invitation copied.");
  }
  return <div><p>Player invitations work only during the current session. Manage each player's permissions in Players & permissions. Offline play is available only to the campaign's DM.</p>
    {!room.joined ? <p>Start a room to invite players. Existing campaign backups and activity reports remain readable by the DM.</p> : <ul className="mt-4 space-y-3">{characters.map(p => <li key={p.id} className="ledger-card"><p>{p.name}</p><Button variant="secondary" disabled={!room.lastSync} onClick={() => void copyPlayerLink(p.id).catch(e => toast.error(e.message))}>Copy link</Button></li>)}</ul>}
  </div>;
}

export function TableDesk() {
  const seat = useSeat();
  const { takeBill } = useEconomy();
  const [incoming,setIncoming]=useState<File|null>(null);

  async function read(file: File | undefined, _kind: "counter" | "bill") {
    if (!file) return;
    try {
      setIncoming(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That file could not be read.");
    }
  }

  if(getCloudTable().joined)return <p className="text-sm text-muted">Shared modes synchronize player activity directly. Return to Local Mode before importing or exporting player reports.</p>;
  if (seat.role === "player") return <p>Join the DM’s current session to play. Campaign data stays with the DM.</p>;

  return (
    <div>
      <Confirm open={incoming!==null} onOpenChange={open=>{if(!open)setIncoming(null);}} title="Import player activity?" body={incoming ? `${incoming.name}: account, inventory, and stock changes will be checked against the original player copy. Conflicting reports are rejected without applying changes. Export a backup first if you need a recovery copy.` : ""} confirmLabel="Check and import" onConfirm={()=>{const file=incoming;setIncoming(null);if(file)void takeBill(file).catch(e=>toast.error(e instanceof Error?e.message:"Import failed."));}} />
      <p className="text-sm text-muted">
        Import an existing player activity report to recover earlier offline play. Conflicting funds, inventory, and stock changes are rejected. Players must use a current session invitation for future play.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-sm border border-border px-4 text-sm">
          Import player activity
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              void read(event.target.files?.[0], "bill");
              event.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}
