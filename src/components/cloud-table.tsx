import { activeCampaignId } from "../lib/quire/campaign-context.ts";
import { getServerCloudTable } from "@/lib/quire/cloud-client";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Copy, Crown, DoorOpen, Radio, Users, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import {
  accountRequest,
  HOSTING_LIMIT_HELP,
  hostingLabel,
  type AccountLibrary,
} from "@/lib/account/client";
import { linkCurrentCampaign } from "@/lib/account/transfers";
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
  endSessionKeepOnline,
  leaveViewableRoom,
} from "@/lib/quire/cloud-client";
import { useSeat } from "@/lib/quire/seat";
import { copyText } from "@/lib/quire/table";
import { invitationUrl } from "@/lib/quire/invitation-url";
import { PlayerCharacterImport } from "./player-character-import";
import { getOnline, subscribeOnline } from "@/lib/mobile/online";
import { Button, TextInput, Confirm, Field, Fold } from "@/components/ui";

import { rememberSave } from "@/lib/quire/saves";
import { loadSeatLock } from "@/lib/quire/lock";
import { roomStatusLabels } from "@/lib/quire/room-state";
import { offerJoinTips, recalledJoinName, rememberJoinName } from "@/lib/quire/join-memory";
import { roomCampaignName, sharedCampaignFallback } from "@/lib/quire/campaign-name";
import { useCampaignDisplayName } from "@/lib/quire/use-campaign-name";
import { isEphemeralCampaign } from "@/lib/quire/guest-storage";
import { requestConfirm, requestPrompt } from "@/lib/quire/confirm-store";

type Mode = "local" | "turns" | "live";

const validCode = (value: string) => /^[A-Z0-9]{4,12}(\.[a-f0-9-]{36})?$/i.test(value);

export function CloudTable() {
  const router = useRouter();
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const params = new URLSearchParams(search);
  const invitation = (params.get("join") || "").trim().toUpperCase();
  const invitedCharacter = params.get("character") || "";
  const invitationToken = params.get("invitation") || "";
  const invitationSession = params.get("session") || "";
  const seat = useSeat();
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const online = useSyncExternalStore(subscribeOnline, getOnline, () => true);
  const [code, setCode] = useState("");
  // "Your name" is remembered on this device between joins (a per-viewer convenience).
  const [name, setName] = useState("");
  useEffect(() => setName((current) => current || recalledJoinName()), []);
  const [characters, setCharacters] = useState<{ id: string; name: string }[]>([]);
  // The DM's campaign name from the lookup (not private): "Joining The Wayfarers".
  const [joinCampaign, setJoinCampaign] = useState("");
  const [nameError, setNameError] = useState("");
  const [codeError, setCodeError] = useState("");
  const nameFieldId = useId();
  const codeFieldId = useId();
  const [purseId, setPurseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [switchInvite, setSwitchInvite] = useState(false);
  const [hosting, setHosting] = useState(false);
  const [hostAccount, setHostAccount] = useState<AccountLibrary | null>(null);
  const [checkingAccount, setCheckingAccount] = useState(false);
  const [accountCheckError, setAccountCheckError] = useState("");
  const [separateRoom, setSeparateRoom] = useState(false);
  const [accountSaveError, setAccountSaveError] = useState("");
  const [hostMode, setHostMode] = useState<"live" | "turns">("live");
  const [lookedUp, setLookedUp] = useState(false);
  const [nextMode, setNextMode] = useState<Mode | null>(null);
  const [release, setRelease] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [keepOnline, setKeepOnline] = useState(false);
  const host = cloud.joined && cloud.role === "dm";
  const campaignName = useCampaignDisplayName();
  // Restored credentials arrive before the authoritative session mode/invitation.
  const unavailable = busy || !online || (cloud.joined && cloud.lastSync === 0);
  const savedRooms = hostAccount?.members.filter((m) => !m.archived && m.role) || [];
  // Convenience only: the server refuses every hosting path at the limit.
  const atHostLimit = hostAccount?.hosting?.atLimit === true;

  async function prepareHosting() {
    setHosting(true);
    setCheckingAccount(true);
    setHostAccount(null);
    setAccountCheckError("");
    setSeparateRoom(false);
    try {
      const session = await accountRequest<{ user: unknown } | null>("auth/get-session");
      if (session?.user) setHostAccount(await accountRequest<AccountLibrary>("library"));
    } catch {
      setAccountCheckError(
        "Your saved campaigns could not be checked. You can retry or deliberately create a separate room.",
      );
    } finally {
      setCheckingAccount(false);
    }
  }

  async function saveCreatedMembership() {
    try {
      await linkCurrentCampaign();
      setAccountSaveError("");
      toast.success("Room saved to My account. Resume this campaign on your other devices.");
    } catch {
      // Room creation already succeeded. Retry only the idempotent account link,
      // never creation: a second room would split subsequent campaign changes.
      setAccountSaveError(
        "Room saved to your account, but its display name could not be updated. Retry the account save to finish naming it.",
      );
    }
  }

  useEffect(() => {
    resumeTable();
  }, []);

  useEffect(() => {
    setCharacters([]);
    setLookedUp(false);
    setPurseId("");
    setSwitchInvite(false);
    if (invitation && !getCloudTable().joined) {
      setCode(invitation);
      setJoining(true);
      setHosting(false);
    }
  }, [invitation, invitedCharacter, invitationToken, invitationSession, cloud.joined]);

  async function findCharacters(target: string) {
    const requestedSearch = window.location.search;
    const found = await lookupTable(target, target === invitation ? invitationSession : undefined);
    if (window.location.search !== requestedSearch) return;
    if (!found || !Array.isArray(found.characters))
      throw new Error("Could not load this room. Try again.");
    const preferred = target === invitation ? invitedCharacter : "";
    if (preferred && !found.characters.some((c) => c.id === preferred))
      throw new Error("The invited character is unavailable. Ask the DM to release it or send a new invitation.");
    setCharacters(found.characters);
    setJoinCampaign(
      roomCampaignName(found.campaignName) ?? sharedCampaignFallback(target.split(".")[0]!.toUpperCase()),
    );
    setPurseId(preferred || found.characters[0]?.id || "");
    setLookedUp(true);
  }

  // A join link looks up its characters at once (plan Q15): no extra "Find characters" tap.
  const autoLookup = joining && !!invitation && code === invitation && !lookedUp && !cloud.joined && online;
  const [looked, setLooked] = useState("");
  useEffect(() => {
    const key = `${invitation}|${invitationSession}|${invitedCharacter}`;
    if (!autoLookup || looked === key || busy) return;
    setLooked(key);
    run(() => findCharacters(invitation));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per invitation link
  }, [autoLookup, busy, invitation, invitationSession, invitedCharacter]);

  function dismissInvitation() {
    const next = router.options.parseSearch!(window.location.search);
    for (const key of ["join", "invitation", "character", "session"]) delete next[key];
    return router.navigate({ to: "/share", search: next as never, replace: true });
  }

  async function prepareInvitation() {
    const requestedSearch = window.location.search;
    // Validate the target before backing up or leaving an existing session.
    const found = await lookupTable(invitation, invitationSession);
    if (invitedCharacter && !found.characters.some((c) => c.id === invitedCharacter))
      throw new Error("The invited character is unavailable. Ask the DM to release it or send a new invitation.");
    if ((await loadSeatLock())?.protectSaves)
      throw new Error(
        "Save a password-protected backup in Device backups, then leave or end this room before opening the invitation again.",
      );
    if (host) {
    const file = await captureDeviceBackup();
    await rememberSave({
      name: `Before switching from ${cloud.code}`,
      campaignId: activeCampaignId(),
      file,
    });
    }
    if (window.location.search !== requestedSearch)
      throw new Error("The invitation changed. Review the current link before switching rooms.");
    if (host) await chooseTableMode("local");
    else await leaveTable();
    if (window.location.search !== requestedSearch) return;
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
    const url = invitationUrl({ origin: window.location.origin, native: import.meta.env.VITE_MOBILE === "true", code: cloud.code, session: cloud.sessionId });
    const text = `Join my Lootsplitter room. Code: ${cloud.code}${cloud.sessionId ? "." + cloud.sessionId : ""}`;
    if (import.meta.env.VITE_MOBILE === "true") {
      const { Share } = await import("@capacitor/share");
      try {
        await Share.share({ title: "Join Lootsplitter", text, url });
      } catch (error) {
        if (!/cancel|dismiss/i.test(String(error))) throw error;
      }
    } else if (navigator.share) {
      try {
        await navigator.share({ title: "Join Lootsplitter", text, url });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
      }
    } else {
      await copyText(`${text}\n${url}`);
      toast.success("Invitation copied. Send it to your players.");
    }
  }

  const labels = roomStatusLabels(cloud, { online, ephemeral: isEphemeralCampaign() });
  const status = [labels.mode, labels.room, labels.play, labels.turn, labels.save].filter(Boolean).join(" · ");

  return (
    <div className="multiplayer-hub" aria-busy={busy}>
      {cloud.joined && cloud.viewOnly && (
        <div role="status" className="mb-4 rounded-xl border border-border p-4">
          <p>Session ended · Room remains online for viewing sheets and campaign information.</p>
          {host && <p className="mt-2 text-sm text-muted">DM preparation remains available. Resume play when players should act again.</p>}
          {host && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                disabled={unavailable}
                onClick={() =>
                  run(() => chooseTableMode(cloud.live ? "live" : "turns"), "Play resumed.")
                }
              >
                Resume play
              </Button>
              <Button
                variant="secondary"
                disabled={unavailable}
                onClick={() =>
                  run(() => leaveViewableRoom(), "Room left online. Resume it from My account.")
                }
              >
                Leave room online
              </Button>
            </div>
          )}
        </div>
      )}
      {invitation && cloud.joined && invitation === cloud.code ? (
        <div className="mb-4 rounded-xl border border-border p-4" role="status">
          <p>You are already connected to room {cloud.code}.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={dismissInvitation}>
              Stay in this room
            </Button>
          </div>
        </div>
      ) : null}
      <AlertDialog.Root open={!!invitation && cloud.joined && invitation !== cloud.code && !switchInvite}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="modal-overlay fixed inset-0 z-40" />
          <AlertDialog.Content className="modal-pop rounded-xl border border-border bg-elevated p-4 text-fg">
            <AlertDialog.Title className="font-display text-2xl">Invitation to a different room</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted">
              This link is for room {invitation}. This device is still in room {cloud.code}; you have not joined the invited room.
              {cloud.pending > 0 ? " Stay here to submit or resolve pending actions before switching." : " Choose which room to use."}
            </AlertDialog.Description>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => void dismissInvitation()}>Stay in this room</Button>
              <Button disabled={unavailable || cloud.pending > 0} onClick={() => setSwitchInvite(true)}>Switch rooms…</Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
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
      {cloud.joined && accountSaveError && (
        <div className="ledger-card" role="alert">
          <p>{accountSaveError}</p>
          <Button disabled={unavailable} onClick={() => run(saveCreatedMembership)}>
            Retry account save
          </Button>
        </div>
      )}
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
                  <Button
                    className="min-h-14"
                    disabled={unavailable}
                    onClick={() => run(prepareHosting)}
                  >
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
                Local DM play uses the owned campaign saved on this device and can continue without a connection. Shared Live and Turn-based rooms need Internet access, including passing a shared-room turn.
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
                Create a new shared room from this device’s current campaign. To continue a campaign
                from another device, resume it from My account.
              </p>
              <Link to="/account" className="settings-link">
                Resume a saved campaign
              </Link>
              {checkingAccount && <p role="status">Checking your saved campaigns…</p>}
              {!checkingAccount && !hostAccount && (
                <p>Create an account or sign in to proceed as a Dungeon Master in your own campaign.{" "}
                  <Link to="/account">Sign in</Link></p>
              )}
              {hostAccount?.hosting && (
                <div className="mt-3" role={atHostLimit ? "alert" : undefined}>
                  <p className="text-sm font-semibold">{hostingLabel(hostAccount.hosting)}</p>
                  {atHostLimit ? (
                    <p className="text-sm">
                      You can host up to {hostAccount.hosting.limit} online campaigns.{" "}
                      {HOSTING_LIMIT_HELP}
                    </p>
                  ) : null}
                </div>
              )}
              {savedRooms.length > 0 && (
                <div className="mt-3 rounded-xl border border-lead/30 p-3">
                  <h3>You already have saved campaigns</h3>
                  <ul>
                    {savedRooms.map((m) => (
                      <li key={m.code}>
                        {m.name} · {m.code}
                      </li>
                    ))}
                  </ul>
                  <p>
                    Creating another room makes a separate copy. Portraits, loot and later changes
                    will not sync between those rooms.
                  </p>
                </div>
              )}
              {accountCheckError && (
                <div role="alert">
                  <p>{accountCheckError}</p>
                  <Button
                    disabled={unavailable}
                    variant="secondary"
                    onClick={() => run(prepareHosting)}
                  >
                    Retry account check
                  </Button>
                </div>
              )}
              {(savedRooms.length > 0 || accountCheckError) && (
                <label className="mt-3 flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={separateRoom}
                    disabled={unavailable}
                    onChange={(e) => setSeparateRoom(e.target.checked)}
                  />
                  Create a separate room from this device’s copy
                </label>
              )}
              {!host && <PlayerCharacterImport key={cloud.code} code={cloud.code} />}
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
                  : "Online turns: each person uses their own device. One person makes changes at a time, then submits them and ends their turn. A connection is required."}
              </p>
              <Button
                className="mt-5 w-full min-h-12"
                disabled={
                  unavailable ||
                  checkingAccount || !hostAccount || atHostLimit ||
                  (!!(savedRooms.length || accountCheckError) && !separateRoom)
                }
                onClick={() =>
                  run(async () => {
                    await chooseTableMode(hostMode);
                    if (hostAccount) await saveCreatedMembership();
                    else
                      toast.success(
                        "Room ready. Invite your players. Save its membership in My account to resume on another device.",
                      );
                    setHosting(false);
                  })
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
                  void dismissInvitation();
                }}
              >
                <ArrowLeft size={16} />
                Back
              </Button>
              <h2 className="mt-3 text-3xl">
                {lookedUp && joinCampaign ? `Joining ${joinCampaign}` : "Join your party"}
              </h2>
              <p className="mt-2 text-sm text-muted">
                {lookedUp && characters.length
                  ? "Choose your character, then join."
                  : invitation && busy
                    ? "Finding the characters in this room…"
                    : "Enter code → Choose character → Join"}
              </p>
              {characters.length > 0 ? (
                <form
                  className="mt-5 space-y-4"
                  noValidate
                  aria-label="Join room"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!name.trim()) {
                      setNameError("Enter the name the party should call you.");
                      document.getElementById(nameFieldId)?.focus();
                      return;
                    }
                    if (!purseId) return;
                    const character = characters.find((c) => c.id === purseId)?.name || "your character";
                    run(async () => {
                      const requestedSearch = window.location.search;
                      await joinTable(code, purseId, name.trim(), code === invitation ? invitationToken || undefined : undefined, code === invitation ? invitationSession : undefined);
                      rememberJoinName(name.trim());
                      setJoining(false);
                      // Land on Home with a short tip strip (plan P3, Q16); the Room tab stays one tap away.
                      offerJoinTips();
                      toast.success(`You're playing ${character}`);
                      if (window.location.search === requestedSearch)
                        await router.navigate({ to: "/", search: { view: "home" }, replace: true });
                    });
                  }}
                >
                  <Field label="Choose your character">
                    <select
                      aria-label="Choose your character"
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
                  <Field label="Your name">
                    <TextInput
                      id={nameFieldId}
                      disabled={busy}
                      value={name}
                      maxLength={80}
                      autoComplete="nickname"
                      aria-invalid={nameError ? true : undefined}
                      aria-describedby={nameError ? `${nameFieldId}-error` : undefined}
                      onChange={(event) => {
                        setName(event.target.value);
                        if (event.target.value.trim()) setNameError("");
                      }}
                      placeholder="What should the party call you?"
                    />
                  </Field>
                  {nameError ? (
                    <p id={`${nameFieldId}-error`} className="field-error text-sm text-negative" role="alert">
                      {nameError}
                    </p>
                  ) : null}
                  <Button
                    type="submit"
                    className="w-full min-h-12"
                    disabled={unavailable || !purseId}
                  >
                    {busy ? "Joining…" : "Join room"}
                  </Button>
                  <p className="text-sm text-muted">
                    Guest campaign data stays in memory. Refreshing can reconnect while the room stays open. Ending play can leave viewing access; closing the room revokes access. An existing DM device campaign is preserved separately.
                  </p>
                </form>
              ) : null}
              {lookedUp && characters.length === 0 ? (
                <p className="mt-4 text-muted" role="status">
                  No characters are available. Ask the host to add a character or release one
                  already assigned.
                </p>
              ) : null}
              <form
                className={characters.length > 0 ? "join-code-row mt-5 space-y-3 border-t border-lead/25 pt-5" : "mt-5 space-y-3"}
                noValidate
                aria-label="Room code"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!validCode(code)) {
                    setCodeError(
                      code.trim()
                        ? "Room codes have 4 to 12 letters and numbers, as the DM sent them."
                        : "Enter the room code from your DM.",
                    );
                    document.getElementById(codeFieldId)?.focus();
                    return;
                  }
                  run(() => findCharacters(code));
                }}
              >
                <Field label="Room code">
                  <TextInput
                    id={codeFieldId}
                    disabled={busy}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    value={code}
                    maxLength={64}
                    aria-invalid={codeError ? true : undefined}
                    aria-describedby={codeError ? `${codeFieldId}-error` : undefined}
                    onChange={(event) => {
                      setCode(event.target.value.replace(/[^a-zA-Z0-9.-]/g, ""));
                      setCharacters([]);
                      setLookedUp(false);
                      setCodeError("");
                    }}
                    placeholder="Enter your code"
                  />
                </Field>
                {codeError ? (
                  <p id={`${codeFieldId}-error`} className="field-error text-sm text-negative" role="alert">
                    {codeError}
                  </p>
                ) : null}
                <Button type="submit" className="w-full" variant="secondary" disabled={unavailable}>
                  {busy && !characters.length ? "Please wait…" : "Find characters"}
                </Button>
              </form>
            </section>
          ) : null}
        </>
      ) : (
        <>
          <section className="ledger-card room-card">
            <p className="eyebrow">Your shared campaign</p>
            <h2>{host ? "Your party’s room" : "Adventure together"}</h2>
            <p className="font-display text-xl" data-campaign-name>
              {campaignName}
            </p>
            <p className="text-muted">{host ? "You are the host" : "You joined as a player"}</p>
            <p className="mt-5 text-xs tracking-widest uppercase text-muted">Campaign ID</p>
            <p className="room-code" aria-label={`Campaign ID ${cloud.code}`}>
              {cloud.code}
            </p>
            <p className="mb-3 text-sm text-muted">
              {host
                ? "Use Copy session code or Share join link to invite players. The campaign ID alone does not grant access."
                : "Your DM invites players to this room. Share the link only with someone your DM expects; the campaign ID alone does not grant access."}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button
                disabled={unavailable}
                onClick={() => run(() => copyText(cloud.sessionId ? `${cloud.code}.${cloud.sessionId}` : cloud.code), "Room code copied.")}
              >
                <Copy size={17} />
                Copy session code
              </Button>
              <Button variant="secondary" disabled={unavailable} onClick={() => run(invitePlayers)}>
                <Users size={17} />
                Share join link
              </Button>
            </div>
          </section>
          {!host && <PlayerCharacterImport key={cloud.code} code={cloud.code} />}
          {host ? (
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
          ) : (
            // Players read the mode; only the DM changes it (owner decision 3, plan P3).
            <p className="room-mode-readout mt-5 text-center" data-room-mode>
              <Radio size={16} aria-hidden className="mr-1 inline" />
              The DM runs this room in {cloud.live ? "Live" : "Turn-based"} mode.
            </p>
          )}
          <p className="mt-3 text-center text-sm text-muted">
            {cloud.viewOnly
              ? "Session ended. Players can view their sheets and campaign information."
              : cloud.live
              ? "Everyone can make changes."
              : cloud.mine
                ? "Your turn. Submit your changes when you’re done."
                : `Waiting for ${cloud.who}.`}
          </p>
          {!cloud.live ? (
            <div className="mt-3">
              {host && cloud.viewOnly && <p className="mb-2 text-sm text-muted">Existing turn controls still advance turns during DM preparation; they do not resume player play.</p>}
              {cloud.mine ? (
                <Button
                  className="w-full"
                  disabled={unavailable}
                  onClick={() => run(() => endTableTurn(), "Turn ended.")}
                >
                  {cloud.viewOnly ? "Submit preparation & end turn" : "Submit changes & end turn"}
                </Button>
              ) : host ? (
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={unavailable}
                  onClick={() => run(() => skipTableTurn(), "Turn skipped.")}
                >
                  {cloud.viewOnly ? "Skip turn during preparation" : "Skip this turn"}
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
              {cloud.departed.map((item) => (
                <div key={item.id} className="border-b py-3">
                <p>{item.name} · {item.status}</p>
                {item.status === "kicked" && (
                    <Button disabled={unavailable} variant="secondary" onClick={() => run(() => manageParticipant("invite", item.id))}>Create fresh invitation</Button>
                  )}
                {item.invitation && (
                    <Button variant="secondary" onClick={() => { const url = invitationUrl({ origin: window.location.origin, native: import.meta.env.VITE_MOBILE === "true", code: cloud.code, session: cloud.sessionId, invitation: item.invitation! }); void navigator.clipboard.writeText(url).then(() => toast.success("Fresh invitation copied"), () => void requestPrompt({ title: "Copy fresh invitation", label: "Invitation link", body: "Copying was blocked. Select the link and copy it yourself.", defaultValue: url, confirmLabel: "Done" })); }}>Copy fresh invitation</Button>
                  )}
              </div>
              ))}
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
                        <Button variant="ghost" disabled={unavailable} onClick={async () => { if (await requestConfirm({ title: `Kick ${item.name || "this player"}?`, body: "Rejoining requires a fresh invitation. Pending turns must be resolved first.", tone: "danger", confirmLabel: "Kick player" })) run(() => manageParticipant("kick", item.id)); }}>Kick</Button>
                        <Button variant="ghost" disabled={unavailable} onClick={async () => { if (await requestConfirm({ title: `Ban ${item.name || "this player"} from this campaign?`, body: "Campaign access and reports will be blocked.", tone: "danger", confirmLabel: "Ban player" })) run(() => manageParticipant("ban", item.id)); }}>Ban</Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </Fold>
          ) : null}
          {host && !cloud.viewOnly && (
            <Button
              className="mt-5 w-full"
              disabled={unavailable}
              onClick={() => setKeepOnline(true)}
            >
              End play & keep room online
            </Button>
          )}
          <Button
            className="mt-5 w-full text-negative"
            variant="ghost"
            disabled={busy}
            onClick={() => (host ? setNextMode("local") : setLeaving(true))}
          >
            <DoorOpen size={17} />
            {host ? "Close room & revoke access" : "Leave room"}
          </Button>
        </>
      )}
      <Confirm
        open={keepOnline}
        onOpenChange={setKeepOnline}
        title="End play and keep room online?"
        body="Archive this session and keep player sheets and campaign information available to view. Player changes and rolls pause until you resume play. Resolve pending turns first. You can then leave the room online and return from My account."
        confirmLabel="End play & keep room online"
        onConfirm={() => {
          setKeepOnline(false);
          run(() => endSessionKeepOnline(), "Session ended. Room remains online.");
        }}
      />
      <Confirm
        open={nextMode !== null}
        onOpenChange={(open) => {
          if (!open) setNextMode(null);
        }}
        title={nextMode === "local" ? "Close room and revoke player access?" : cloud.viewOnly ? "Resume play in the selected mode?" : "Change session mode?"}
        body={
          nextMode === "local"
            ? "This archives the session and closes the room for everyone. Player access is cleared; authorized reports remain in My account. Pending changes must be resolved first."
            : cloud.viewOnly
              ? "This resumes player gameplay in the selected mode. Existing sheets, records and room memberships remain."
              : "Players must submit or discard pending changes before the mode can change."
        }
        confirmLabel={nextMode === "local" ? "Close room & revoke access" : cloud.viewOnly ? "Resume play" : "Change mode"}
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
        body="Their old connection will stop working. They can join again with a current session invitation. Pending actions must be resolved first."
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
