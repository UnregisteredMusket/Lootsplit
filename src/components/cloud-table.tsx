import { getServerCloudTable } from "@/lib/quire/cloud-client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Copy, Crown, DoorOpen, Radio, Users, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import {
  captureDeviceBackup,
  chooseTableMode,
  endTableTurn,
  getCloudTable,
  joinTable,
  lookupTable,
  resumeTable,
  skipTableTurn,
  subscribeCloudTable,
  manageParticipant,
  leaveTable,
} from "@/lib/quire/cloud-client";
import { useSeat } from "@/lib/quire/seat";
import { copyText } from "@/lib/quire/table";
import { API_ORIGIN } from "@/lib/mobile/origin";
import { getOnline, subscribeOnline } from "@/lib/mobile/online";
import { Button, TextInput, Confirm, Field, Fold } from "@/components/ui";

import { rememberSave } from "@/lib/quire/saves";
import { loadSeatLock } from "@/lib/quire/lock";

type Mode = "local" | "turns" | "live";

export function CloudTable() {
  const seat = useSeat();
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const online = useSyncExternalStore(subscribeOnline, getOnline, () => true);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [characters, setCharacters] = useState<{ id: string; name: string }[]>([]);
  const [purseId, setPurseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [invitation, setInvitation] = useState("");
  const [switchInvite, setSwitchInvite] = useState(false);
  const [hosting, setHosting] = useState(false);
  const [hostMode, setHostMode] = useState<"live" | "turns">("live");
  const [lookedUp, setLookedUp] = useState(false);
  const [nextMode, setNextMode] = useState<Mode | null>(null);
  const [release, setRelease] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const host = cloud.joined && cloud.role === "dm";
  const unavailable = busy || !online;

  useEffect(() => {
    resumeTable();
    const invite = new URLSearchParams(window.location.search).get("join");
    if (invite)
      setInvitation(
        invite
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 12),
      );
    if (invite && !getCloudTable().joined) {
      setCode(
        invite
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 12),
      );
      setJoining(true);
    }
  }, []);

  function dismissInvitation() {
    setInvitation("");
    const url = new URL(window.location.href);
    url.searchParams.delete("join");
    window.history.replaceState(window.history.state, "", url);
  }

  async function prepareInvitation() {
    if ((await loadSeatLock())?.protectSaves)
      throw new Error(
        "Save a password-protected backup in Device backups, then leave or end this room before opening the invitation again.",
      );
    const file = await captureDeviceBackup();
    await rememberSave({
      name: `Before switching from ${cloud.code}`,
      campaignId: localStorage.getItem("quire.campaign.v1") || "main",
      file,
    });
    if (host) await chooseTableMode("local");
    else await leaveTable();
    setCode(invitation);
    setJoining(true);
    setCharacters([]);
    setLookedUp(false);
  }

  function run(work: () => Promise<unknown>, ok?: string) {
    if (busy) return;
    setBusy(true);
    void work()
      .then(() => {
        if (ok) toast.success(ok);
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "The room could not be reached."),
      )
      .finally(() => setBusy(false));
  }

  async function invitePlayers() {
    const origin = import.meta.env.VITE_MOBILE === "true" ? API_ORIGIN : window.location.origin;
    const url = `${origin}/share?join=${encodeURIComponent(cloud.code)}`;
    const text = `Join my Lootsplit room. Code: ${cloud.code}`;
    if (import.meta.env.VITE_MOBILE === "true") {
      const { Share } = await import("@capacitor/share");
      try {
        await Share.share({ title: "Join Lootsplit", text, url });
      } catch (error) {
        if (!/cancel|dismiss/i.test(String(error))) throw error;
      }
    } else if (navigator.share) {
      try {
        await navigator.share({ title: "Join Lootsplit", text, url });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
      }
    } else {
      await copyText(`${text}\n${url}`);
      toast.success("Invitation copied. Send it to your players.");
    }
  }

  const status = !online
    ? "Offline · reconnect to play together"
    : !cloud.joined
      ? "Local campaign · only on this device"
      : cloud.error
        ? "Connection needs attention"
        : cloud.status === "saving"
          ? "Saving changes…"
          : cloud.pending
            ? `${cloud.pending} pending action${cloud.pending === 1 ? "" : "s"}`
            : "Connected · All changes saved";

  return (
    <div className="multiplayer-hub" aria-busy={busy}>
      {invitation && cloud.joined ? (
        <div className="mb-4 rounded-xl border border-border p-4" role="status">
          <p>
            {invitation === cloud.code
              ? `You are already connected to room ${cloud.code}.`
              : `Invitation to ${invitation}. You are currently connected to ${cloud.code}.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={dismissInvitation}>
              Stay in this room
            </Button>
            {invitation !== cloud.code ? (
              <Button
                disabled={unavailable || cloud.pending > 0}
                onClick={() => setSwitchInvite(true)}
              >
                Switch rooms…
              </Button>
            ) : null}
          </div>
          {cloud.pending > 0 ? (
            <p className="mt-2 text-sm text-muted">
              Submit or resolve pending actions before switching.
            </p>
          ) : null}
        </div>
      ) : null}
      <Confirm
        open={switchInvite}
        onOpenChange={setSwitchInvite}
        title="Switch to the invited room?"
        body={
          host
            ? "A device backup will be saved first. This ends your hosted room for everyone and invalidates its code. Then you can choose a character in the invited room."
            : "A device backup will be saved first. You will leave this room; your character becomes available for reassignment. Then you can choose a character in the invited room."
        }
        confirmLabel={host ? "Back up, end room and continue" : "Back up and continue"}
        onConfirm={() => {
          setSwitchInvite(false);
          run(prepareInvitation);
        }}
      />
      <p className="room-status" role="status">
        <span
          className={online && cloud.joined && !cloud.error ? "status-dot connected" : "status-dot"}
        />
        {status}
      </p>
      {!cloud.joined ? (
        <>
          {!joining && !hosting ? (
            <div className="room-welcome ledger-card">
              <span className="room-emblem">
                <Users size={28} />
              </span>
              <h2>Gather your party</h2>
              <p className="text-muted">
                One shared ledger for your adventure. Host a room or enter your dungeon master’s
                code.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {seat.role === "dm" ? (
                  <Button className="min-h-14" disabled={!online} onClick={() => setHosting(true)}>
                    <Crown size={18} />
                    Start a room
                  </Button>
                ) : null}
                <Button
                  className="min-h-14"
                  variant={seat.role === "dm" ? "secondary" : "primary"}
                  disabled={!online}
                  onClick={() => setJoining(true)}
                >
                  <DoorOpen size={18} />
                  Join a room
                </Button>
              </div>
              <p className="mt-4 text-sm text-muted">
                Playing solo? Your local campaign is ready on Home.
              </p>
            </div>
          ) : null}
          {hosting ? (
            <section className="ledger-card">
              <Button variant="ghost" disabled={busy} onClick={() => setHosting(false)}>
                <ArrowLeft size={16} />
                Back
              </Button>
              <h2 className="mt-3 text-3xl">Start a room</h2>
              <p className="mt-2 text-muted">
                Share this device’s current campaign. Players join with their own characters.
              </p>
              <div className="mode-switch mt-5" role="group" aria-label="Session mode">
                <button
                  aria-pressed={hostMode === "live"}
                  onClick={() => setHostMode("live")}
                  disabled={busy}
                >
                  Live
                </button>
                <button
                  aria-pressed={hostMode === "turns"}
                  onClick={() => setHostMode("turns")}
                  disabled={busy}
                >
                  Turn-based
                </button>
              </div>
              <p className="mt-3 text-sm text-muted">
                {hostMode === "live"
                  ? "Everyone can make changes at the same time."
                  : "One person makes changes at a time, then ends their turn."}
              </p>
              <Button
                className="mt-5 w-full min-h-12"
                disabled={unavailable}
                onClick={() =>
                  run(() => chooseTableMode(hostMode), "Room ready. Invite your players.")
                }
              >
                {busy ? "Starting…" : "Create room"}
              </Button>
            </section>
          ) : null}
          {joining ? (
            <section className="ledger-card">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setJoining(false);
                  setCharacters([]);
                  setLookedUp(false);
                }}
              >
                <ArrowLeft size={16} />
                Back
              </Button>
              <h2 className="mt-3 text-3xl">Join your party</h2>
              <p className="mt-2 text-sm text-muted">Enter code → Choose character → Join</p>
              <form
                className="mt-5 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  run(async () => {
                    const found = await lookupTable(code);
                    if (!found || !Array.isArray(found.characters))
                      throw new Error("Could not load this room. Try again.");
                    setCharacters(found.characters);
                    setPurseId(found.characters[0]?.id ?? "");
                    setLookedUp(true);
                  });
                }}
              >
                <Field label="Room code">
                  <TextInput
                    disabled={busy}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    value={code}
                    maxLength={12}
                    onChange={(event) => {
                      setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                      setCharacters([]);
                      setLookedUp(false);
                    }}
                    placeholder="Enter your code"
                  />
                </Field>
                <Button
                  type="submit"
                  className="w-full"
                  variant="secondary"
                  disabled={unavailable || code.length < 4}
                >
                  {busy ? "Please wait…" : "Find characters"}
                </Button>
              </form>
              {lookedUp && characters.length === 0 ? (
                <p className="mt-4 text-muted" role="status">
                  No characters are available. Ask the host to add a character or release one
                  already assigned.
                </p>
              ) : null}
              {characters.length > 0 ? (
                <form
                  className="mt-5 space-y-4 border-t border-lead/25 pt-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(async () => {
                      await joinTable(code, purseId, name, new URLSearchParams(location.search).get("invitation") || undefined);
                      setJoining(false);
                    }, "You joined the room.");
                  }}
                >
                  <Field label="Your name">
                    <TextInput
                      disabled={busy}
                      value={name}
                      maxLength={80}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="What should the party call you?"
                    />
                  </Field>
                  <Field label="Choose your character">
                    <select
                      disabled={busy}
                      value={purseId}
                      onChange={(event) => setPurseId(event.target.value)}
                      className="min-h-12 w-full rounded-sm border border-border bg-subtle px-3 text-base text-fg"
                    >
                      {characters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <p className="text-sm text-muted">
                    Your local campaign is backed up automatically in Device backups before joining.
                    DM-protected saves keep their existing restrictions.
                  </p>
                  <Button
                    type="submit"
                    className="w-full min-h-12"
                    disabled={unavailable || !purseId || !name.trim()}
                  >
                    {busy ? "Joining…" : "Join room"}
                  </Button>
                </form>
              ) : null}
            </section>
          ) : null}
        </>
      ) : (
        <>
          <section className="ledger-card room-card">
            <p className="eyebrow">Your shared campaign</p>
            <h2>{host ? "Your party’s room" : "Adventure together"}</h2>
            <p className="text-muted">{host ? "You are the host" : "You joined as a player"}</p>
            <p className="mt-5 text-xs tracking-widest uppercase text-muted">Room code</p>
            <p className="room-code" aria-label={`Room code ${cloud.code}`}>
              {cloud.code}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button
                disabled={busy}
                onClick={() => run(() => copyText(cloud.code), "Room code copied.")}
              >
                <Copy size={17} />
                Copy code
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => run(invitePlayers)}>
                <Users size={17} />
                Share join link
              </Button>
            </div>
          </section>
          <div className="mode-switch mt-5" role="group" aria-label="Session mode">
            <button
              aria-pressed={cloud.live}
              disabled={!host || unavailable}
              onClick={() => {
                if (!cloud.live) setNextMode("live");
              }}
            >
              <Radio size={16} />
              Live
            </button>
            <button
              aria-pressed={!cloud.live}
              disabled={!host || unavailable}
              onClick={() => {
                if (cloud.live) setNextMode("turns");
              }}
            >
              Turn-based
            </button>
          </div>
          <p className="mt-3 text-center text-sm text-muted">
            {cloud.live
              ? "Everyone can make changes."
              : cloud.mine
                ? "Your turn. Submit your changes when you’re done."
                : `Waiting for ${cloud.who}.`}
            {!host ? " The host controls the mode." : ""}
          </p>
          {!cloud.live ? (
            <div className="mt-3">
              {cloud.mine ? (
                <Button
                  className="w-full"
                  disabled={unavailable}
                  onClick={() => run(() => endTableTurn(), "Turn ended.")}
                >
                  Submit changes & end turn
                </Button>
              ) : host ? (
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={unavailable}
                  onClick={() => run(() => skipTableTurn(), "Turn skipped.")}
                >
                  Skip this turn
                </Button>
              ) : null}
            </div>
          ) : null}
          <section className="mt-6" aria-label="Room players">
            <h2 className="mb-3 text-2xl text-lead">Joined participants ({cloud.seats.length})</h2>
            <p className="mb-3 text-sm text-muted">
              Joined participants may be offline. Your connection status appears above.
            </p>
            <ul className="player-roster">
              {cloud.seats.map((item) => (
                <li key={item.id}>
                  <span className="member-avatar">
                    {item.name.slice(0, 1).toUpperCase() || "D"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium">
                      {item.name || "Dungeon master"}
                      {item.id === cloud.seatId ? " (you)" : ""}
                    </span>
                    <span className="text-sm text-muted">
                      {item.role === "dm" ? "Host" : "Player"}
                      {item.pending ? ` · ${item.pending} pending` : ""}
                    </span>
                  </span>
                  {item.role === "dm" ? (
                    <Crown size={18} className="text-lead" aria-label="Host" />
                  ) : (
                    <Users size={17} className="text-muted" />
                  )}
                </li>
              ))}
            </ul>
          </section>
          {host ? (
            <Fold title="Room settings" hint="Player permissions and turn order.">
              <p className="mb-3 text-sm text-muted">
                Manage who can spend party funds or release a character so someone can join again.
              </p>
              {cloud.departed.map(item => <div key={item.id} className="border-b py-3">
                <p>{item.name} · {item.status}</p>
                {item.status === "kicked" && <Button disabled={unavailable} variant="secondary" onClick={() => run(() => manageParticipant("invite", item.id))}>Create fresh invitation</Button>}
                {item.invitation && <Button variant="secondary" onClick={() => { const url = new URL("/share", location.origin); url.searchParams.set("join", cloud.code); url.searchParams.set("invitation", item.invitation!); void navigator.clipboard.writeText(url.href).then(() => toast.success("Fresh invitation copied"), () => window.prompt("Copy fresh invitation", url.href)); }}>Copy fresh invitation</Button>}
              </div>)}
              {cloud.seats.map((item) => (
                <div key={item.id} className="border-b border-border py-3 last:border-0">
                  <p className="font-medium">{item.name || "Dungeon master"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!cloud.live ? (
                      <Button
                        variant="secondary"
                        disabled={unavailable}
                        onClick={() => run(() => manageParticipant("start", item.id))}
                      >
                        Make current turn
                      </Button>
                    ) : null}
                    {item.role === "player" ? (
                      <>
                        <label className="flex min-h-11 items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={item.allowParty}
                            disabled={unavailable}
                            onChange={(e) =>
                              run(() => manageParticipant("permission", item.id, e.target.checked))
                            }
                          />
                          Allow party fund
                        </label>
                        <Button
                          variant="ghost"
                          disabled={unavailable}
                          onClick={() => setRelease(item.id)}
                        >
                          Dismiss player
                        </Button>
                        <Button variant="ghost" disabled={unavailable} onClick={() => { if (window.confirm("Kick this player? Rejoining requires a fresh invitation. Pending turns must be resolved first.")) run(() => manageParticipant("kick", item.id)); }}>Kick</Button>
                        <Button variant="ghost" disabled={unavailable} onClick={() => { if (window.confirm("Ban this player from this campaign? Campaign access and reports will be blocked.")) run(() => manageParticipant("ban", item.id)); }}>Ban</Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </Fold>
          ) : null}
          <Button
            className="mt-5 w-full text-negative"
            variant="ghost"
            disabled={busy}
            onClick={() => (host ? setNextMode("local") : setLeaving(true))}
          >
            <DoorOpen size={17} />
            {host ? "End session" : "Leave room"}
          </Button>
        </>
      )}
      <Confirm
        open={nextMode !== null}
        onOpenChange={(open) => {
          if (!open) setNextMode(null);
        }}
        title={nextMode === "local" ? "End this session?" : "Change session mode?"}
        body={
          nextMode === "local"
            ? "This archives the session and closes the room for everyone. Player access is cleared; authorized reports remain in My account. Pending changes must be resolved first."
            : "Players must submit or discard pending changes before the mode can change."
        }
        confirmLabel={nextMode === "local" ? "End session" : "Change mode"}
        onConfirm={() => {
          const mode = nextMode;
          setNextMode(null);
          if (mode) run(() => chooseTableMode(mode));
        }}
      />
      <Confirm
        open={release !== null}
        onOpenChange={(open) => {
          if (!open) setRelease(null);
        }}
        title="Release this character?"
        body="Their old connection will stop working. They can join again with the room code. Pending actions must be resolved first."
        confirmLabel="Release character"
        onConfirm={() => {
          const id = release;
          setRelease(null);
          if (id) run(() => manageParticipant("release", id));
        }}
      />
      <Confirm
        open={leaving}
        onOpenChange={setLeaving}
        title="Leave this room?"
        body="Resolve pending changes first. Leaving releases your character and clears campaign access from this device. Authorized reports remain in My account."
        confirmLabel="Leave room"
        onConfirm={() => {
          setLeaving(false);
          run(async () => { await leaveTable(); }, "You left the room.");
        }}
      />
    </div>
  );
}
