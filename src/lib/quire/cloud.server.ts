import {
  characterVisible,
  canReadCharacter,
  companionFundsReadable,
  inParty,
  seatInParty,
} from "./character-position.ts";
import {
  readRoom,
  readRoomAccess,
  readCombatView,
  createRoom,
  updateRoom,
  keepStoredBody,
  roomImageSources,
  lookupReceipts,
  recentAcknowledged,
  roomReadVersion,
  type RoomReceipt,
} from "./room-store.server.ts";
import { VIEW_VERSION_KEY } from "./view-sections.server.ts";
import { syncTimer } from "./sync-timing.server.ts";
import { retryRoomWrite } from "./room-write-retry.ts";
import {
  claimSeat,
  readCloudTableForImport,
  setRoomLive,
  skipTurn,
  type CloudRoom,
  type CloudSeat,
  type CloudTable,
} from "./cloud.ts";
import { archiveSession, projectRecord } from "./session-records.ts";
import { npcController } from "./world.ts";
import { canReadNote } from "./chat-visibility.ts";
import { roomCampaignName } from "./campaign-name.ts";
import { characterControl, type Purse } from "./types.ts";
import type { BillFile } from "./table.ts";
import { characterSheet } from "../characters/campaign-sheet.mjs";
import { makeCampaignRoll } from "../characters/campaign-roll.mjs";
import { manualCharacterRolls, database } from "./room-store.server.ts";
import { referenceAccess, referenceSection } from "./reference-access.ts";
import { isProbeRoomCode } from "../../../cloudflare/probe-namespace.mjs";
import { SUBMIT_LIMIT_MESSAGE, takeSubmitAllowance } from "./room-submit-limit.ts";
import {
  FOOTPRINT_PROTOCOL,
  IMAGE_REFERENCE_PROTOCOL,
  PARTY_GROUPS_PROTOCOL,
  ROOM_IMAGE_SOURCES_KEY,
  groupCommandText,
  refuseOldClientGroupActions,
  upgradeFootprintCommands,
} from "./tabletop-protocol.ts";

/**
 * Server-only options. Client server functions pass a single `data` argument, so a browser can never
 * supply these: only the owner monitor's multiplayer probe (cloudflare/multiplayer-probe.mjs) does.
 */
export type ProbeAccess = { monitorProbe: true; code: string };
/** Probe rooms answer exactly like a missing room to every caller except the probe itself. */
function refuseProbeRoom(room: CloudRoom, probe?: ProbeAccess) {
  if ((room.monitorProbe || isProbeRoomCode(room.code)) && !(probe?.monitorProbe && probe.code === room.code))
    throw new Error("No table uses that code.");
}

async function activeEncounter(code: string): Promise<boolean> {
  const db = database();
  return !!(
    db &&
    (await db
      .prepare("SELECT 1 AS active FROM dm_encounters WHERE code=? AND status='active' LIMIT 1")
      .bind(code)
      .first())
  );
}
/** Only a boolean leaves the private encounter store; names, enemies and drafts stay private. */
export async function assertReferenceLookup(input: { code: string; token: string }, kind: string) {
  const room = await must(input.code);
  const seat = room.seats.find((s) => s.token === input.token);
  if (!seat) throw Error("This browser is not seated at that table.");
  const access = referenceAccess(
    seat.role,
    room.table.journal?.referenceAccess,
    seat.role === "dm" ? false : await activeEncounter(room.code),
    referenceSection(kind),
  );
  if (!access.allowed) throw Error(access.reason);
}

/** A roll prepared from a room revision that changed before the roll was saved; nothing was saved. */
class RollRaced extends Error {}
/**
 * A character roll. The roll is saved only if the campaign is still at the revision it was rolled
 * from (seat, character and policy unchanged); if a chat line or another action lands in between,
 * the roll is prepared again from the new revision, up to three times (load audit F10, 2026-10-28).
 */
export async function characterRoll(input: Parameters<typeof characterRollOnce>[0]) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await characterRollOnce(input);
    } catch (error) {
      if (!(error instanceof RollRaced) || attempt === 2) {
        if (error instanceof RollRaced) throw Error("Campaign changed. Reload and retry.");
        throw error;
      }
    }
  }
}
async function characterRollOnce(input: {
  code: string;
  token: string;
  purseId: string;
  log?: boolean;
  before?: number;
  [key: string]: unknown;
}) {
  const room = await must(input.code);
  const seat = room.seats.find((s) => s.token === input.token);
  const p = room.table.purses.find((p) => p.id === input.purseId && p.kind === "character");
  if (
    !seat ||
    !p ||
    !canReadCharacter(room.table, p, seat) ||
    (seat.role !== "dm" && !seat.purseIds.includes(p.id))
  )
    throw Error("You do not control this character.");
  if (input.policy) return { manualAllowed: await manualCharacterRolls(room.code) };
  if (room.viewOnly && seat.role === "player" && !input.log)
    throw Error("The session has ended. This room is view-only until the DM resumes play.");
  const db = database();
  if (db) {
    if (input.log) {
      const rows = await db
        .prepare(
          "SELECT seq,body,created_at FROM play_rolls WHERE code=? AND (character_id=? OR character_id=? OR character_id=?) AND seq<? ORDER BY seq DESC LIMIT 51",
        )
        .bind(
          room.code,
          `party:${p.id}`,
          p.profileId || "",
          `campaign:${room.code}:${p.id}`,
          input.before || Number.MAX_SAFE_INTEGER,
        )
        .all();
      return {
        rolls: rows.results
          .slice(0, 50)
          .map((r) => ({ ...JSON.parse(r.body), seq: r.seq, at: r.created_at })),
        more: rows.results.length > 50,
      };
    }
    const receipt = `${room.code}:${p.id}:${input.requestKey}`;
    const prior = await db
      .prepare("SELECT body FROM play_rolls WHERE id=?")
      .bind(receipt)
      .first<{ body: string }>();
    if (prior) return JSON.parse(prior.body);
    if ((p.sheetRevision || 0) !== input.revision)
      throw Error("Reload your character before rolling.");
    const roll = {
      ...makeCampaignRoll(
        characterSheet(
          p,
          room.table.holdings,
          room.table.sheets.find((s) => s.purseId === p.id),
        ),
        input,
        seat.name,
        p.id,
        "server",
        await manualCharacterRolls(room.code),
      ),
      id: receipt,
    };
    await db
      .prepare(
        "INSERT INTO play_rolls(id,user_id,character_id,code,request_key,body,created_at) SELECT ?,NULL,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND revision=?) AND (?=0 OR EXISTS(SELECT 1 FROM play_policies WHERE code=? AND manual_allowed=1)) ON CONFLICT(id) DO NOTHING",
      )
      .bind(
        receipt,
        `party:${p.id}`,
        room.code,
        String(input.requestKey),
        JSON.stringify(roll),
        Date.now(),
        room.code,
        room.revision,
        input.manual ? 1 : 0,
        room.code,
      )
      .run();
    const saved = await db
      .prepare("SELECT body FROM play_rolls WHERE id=?")
      .bind(receipt)
      .first<{ body: string }>();
    if (!saved) throw new RollRaced();
    return JSON.parse(saved.body);
  }
  const rolls = p.rolls || [];
  if (input.log) {
    const filtered = rolls
      .filter((r) => r.seq < (input.before || Infinity))
      .slice()
      .reverse();
    return { rolls: filtered.slice(0, 50), more: filtered.length > 50 };
  }
  const prior = rolls.find((r) => r.id === input.requestKey);
  if (prior) return prior;
  if ((p.sheetRevision || 0) !== input.revision)
    throw Error("Reload your character before rolling.");
  const roll = {
    ...makeCampaignRoll(
      characterSheet(
        p,
        room.table.holdings,
        room.table.sheets.find((s) => s.purseId === p.id),
      ),
      input,
      seat.name,
      p.id,
      "server",
      false,
    ),
    seq: rolls.length + 1,
    at: Date.now(),
  };
  p.rolls = [...rolls, roll];
  const base = room.revision;
  room.revision++;
  await updateRoom(room, base);
  return roll;
}

export async function openRoom(input: {
  name: string;
  table: CloudTable;
  userId?: string;
  campaignName?: unknown;
}, probe?: ProbeAccess): Promise<{ code: string; token: string; seatId: string; revision: number; userId?: string }> {
  const table = readCloudTableForImport(input.table);
  if (!table)
    throw new Error(
      "This campaign has invalid saved data. Keep a recovery export and repair unreadable archives before sharing a new room.",
    );
  if (table.purses.length === 0) throw new Error("The table has no characters to share.");
  if (probe && (!isProbeRoomCode(probe.code) || input.userId))
    throw new Error("A monitor probe room needs a probe code and no account.");
  const code = probe ? probe.code : await freshCode();
  const seat: CloudSeat = {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    name: input.name.trim() || "Dungeon master",
    role: "dm",
    userId: input.userId,
    purseIds: [],
  };
  const { hostedCampaignLimit } = await import("../../../cloudflare/hosted-campaigns.mjs");
  const campaignName = roomCampaignName(input.campaignName);
  await createRoom({
    ...(campaignName ? { campaignName } : {}),
    ownerId: input.userId,
    sessionId: input.userId ? crypto.randomUUID() : undefined,
    code,
    revision: 1,
    turn: 0,
    live: false,
    seats: [seat],
    table,
    seen: { gifts: [], sales: [] },
    ...(probe ? { monitorProbe: true } : {}),
  }, input.userId ? { hostLimit: { userId: input.userId, limit: hostedCampaignLimit(), path: "open" } } : {});
  return { code, token: seat.token, seatId: seat.id, revision: 1, userId: seat.userId };
}

export async function previewRoom(
  code: string,
  sessionId?: string,
  userId?: string,
): Promise<{ characters: { id: string; name: string }[]; campaignName?: string }> {
  const room = await must(code);
  refuseProbeRoom(room);
  // The same refusals as joinRoom, before anything about the room is shown.
  if (room.testMode) throw Error("Test rooms are private to the owner.");
  requireInvitationSession(room, sessionId);
  const blocked = userId ? room.blockedUsers?.[userId] : undefined;
  if (blocked === "banned") throw Error("You are banned from this campaign.");
  return {
    // The campaign's name is not private: the join card reads "Joining <name>". A kicked
    // account (which needs a fresh invitation to rejoin) is not told the current name.
    ...(room.campaignName && !blocked ? { campaignName: room.campaignName } : {}),
    characters: room.table.purses
      .filter(
        (purse) =>
          purse.kind === "character" &&
          characterControl(purse) === "player" &&
          characterVisible(room.table, purse) &&
          !room.seats.some(
            (seat) => seat.purseIds.includes(purse.id) && (!userId || seat.userId !== userId),
          ),
      )
      .map((purse) => ({ id: purse.id, name: purse.name })),
  };
}

export async function joinRoom(input: {
  code: string;
  purseId: string;
  name: string;
  invitation?: string;
  userId?: string;
  sessionId?: string;
}, probe?: ProbeAccess): Promise<{
  token: string;
  seatId: string;
  revision: number;
  purseIds: string[];
  shopIds: string[];
  userId?: string;
}> {
  return retryRoomWrite(async () => {
    const room = await must(input.code);
    refuseProbeRoom(room, probe);
    if (room.testMode) throw Error("Test rooms are private to the owner.");
    requireInvitationSession(room, input.sessionId);
    const existing =
      input.userId && room.seats.find((s) => s.userId === input.userId && s.role === "player");
    if (existing)
      return {
        token: existing.token,
        seatId: existing.id,
        revision: room.revision,
        purseIds: existing.purseIds,
        shopIds: projectRecord(room.table, existing).shops.map((s) => s.id),
        userId: existing.userId,
      };
    const blocked = input.userId && room.blockedUsers?.[input.userId];
    if (blocked === "banned") throw Error("You are banned from this campaign.");
    const restriction = room.departed?.find(
      (s) => s.purseIds.includes(input.purseId) && (s.status === "kicked" || s.status === "banned"),
    );
    if (restriction?.status === "banned")
      throw Error("This character is blocked from joining. Ask the DM.");
    if (
      (blocked === "kicked" || restriction) &&
      (!input.invitation || room.invitations?.[input.purseId] !== input.invitation)
    )
      throw Error("A fresh invitation from the DM is required.");
    const previous =
      input.userId &&
      room.departed?.find((s) => s.userId === input.userId && s.status === "dismissed");
    const claimed = claimSeat(room, input.purseId, input.name);
    claimed.seat.userId = input.userId;
    if (previous) claimed.seat.id = previous.id;
    if (input.invitation && room.invitations?.[input.purseId] !== input.invitation)
      throw Error("This invitation has expired.");
    if (input.userId && claimed.room.blockedUsers) delete claimed.room.blockedUsers[input.userId];
    if (claimed.room.invitations) delete claimed.room.invitations[input.purseId];
    const next = { ...claimed.room, revision: claimed.room.revision + 1 };
    await updateRoom(next, room.revision);
    return {
      token: claimed.seat.token,
      seatId: claimed.seat.id,
      revision: next.revision,
      purseIds: claimed.seat.purseIds,
      shopIds: projectRecord(claimed.room.table, claimed.seat).shops.map((shop) => shop.id),
      userId: claimed.seat.userId,
    };
  });
}

export async function roomState(input: {
  code: string;
  token: string;
  tabletopProtocol?: number;
}): Promise<RoomView> {
  const timer = syncTimer("full-read");
  try {
    // Protocol 4 clients load map artwork by reference: this read-only view skips those rasters.
    const room = await timer.measure("hydrate", () =>
      must(input.code, { mapImageReferences: wantsImageReferences(input.tabletopProtocol) }),
    );
    const seat = room.seats.find((item) => item.token === input.token);
    if (!seat) throw new Error("This browser is not seated at that table.");
    const result = await timer.measure("projection", () => view(room, seat));
    timer.finish("full");
    return result;
  } catch (error) {
    timer.finish("failed");
    throw error;
  }
}
export type RoomPollInput = {
  tabletopProtocol?: number;
  /** Protocol 11: section hashes this client holds (view-sections.ts). */
  viewSections?: string[];
  code: string;
  token: string;
  knownRevision?: number;
  knownSeatId?: string;
};
export type RoomUnchanged = {
  unchanged: true;
  protocol: "lootsplit.room.unchanged.v1";
  code: string;
  seatId: string;
  userId?: string;
  sessionId?: string;
  revision: number;
  encounterActive: boolean;
};
export async function pollRoom(input: RoomPollInput): Promise<RoomView | RoomUnchanged> {
  const timer = syncTimer("poll");
  try {
    const access = await timer.measure("access", () => readRoomAccess(input.code));
    if (!access) throw Error("No table uses that code.");
    if (access.closed) throw Error("This room is closed.");
    const seat = access.seats.find((s) => s.token === input.token);
    if (!seat) throw Error("This browser is not seated at that table.");
    if (
      Number.isSafeInteger(input.knownRevision) &&
      input.knownRevision === access.revision &&
      input.knownSeatId === seat.id
    ) {
      const encounterActive = await timer.measure("encounter", () => activeEncounter(access.code));
      timer.finish("unchanged");
      return {
        unchanged: true,
        protocol: "lootsplit.room.unchanged.v1",
        code: access.code,
        seatId: seat.id,
        userId: seat.userId,
        sessionId: access.sessionId,
        revision: access.revision,
        encounterActive,
      };
    }
    // Initial/changed reads retain the complete legacy projection and migration behavior.
    const result = await roomState(input);
    timer.finish("full");
    return result;
  } catch (error) {
    timer.finish("failed");
    throw error;
  }
}

export async function publishTurn(_input: {
  code: string;
  token: string;
  baseRevision?: number;
  table?: CloudTable;
  bill?: BillFile;
}): Promise<RoomView> {
  throw new Error(
    "This client uses an older sharing protocol. Reload Lootsplitter before submitting changes.",
  );
}

export async function choosePace(input: {
  code: string;
  token: string;
  live: boolean;
}): Promise<RoomView> {
  return retryRoomWrite(async () => {
    const room = await must(input.code);
    if (Object.values(room.drafts ?? {}).some((c) => c.length))
      throw new Error("Submit or discard all pending turns before changing modes.");
    const paced = setRoomLive(room, input.token, input.live);
    const next = {
      ...paced,
      viewOnly: false,
      revision:
        room.viewOnly && paced.revision === room.revision ? room.revision + 1 : paced.revision,
    };
    await updateRoom(next, room.revision);
    const seat = next.seats.find((item) => item.token === input.token);
    if (!seat) throw new Error("This browser is not seated at that table.");
    return view(next, seat, room);
  });
}

/**
 * The DM names the shared campaign (players see it in the header, join card and tab title).
 * Only the DM seat may set it; an unchanged name writes nothing.
 */
export async function nameRoom(input: {
  code: string;
  token: string;
  campaignName: unknown;
}): Promise<RoomView> {
  return retryRoomWrite(async () => {
    const room = await must(input.code);
    const seat = room.seats.find((item) => item.token === input.token);
    if (!seat) throw new Error("This browser is not seated at that table.");
    if (seat.role !== "dm") throw new Error("Only the DM can name the campaign.");
    const campaignName = roomCampaignName(input.campaignName);
    if ((room.campaignName ?? undefined) === campaignName) return view(room, seat);
    const next: CloudRoom = { ...room, revision: room.revision + 1 };
    if (campaignName) next.campaignName = campaignName;
    else delete next.campaignName;
    await updateRoom(next, room.revision);
    return view(next, seat, room);
  });
}

export async function closeRoom(input: {
  code: string;
  token: string;
  keepOnline?: boolean;
}): Promise<void> {
  return retryRoomWrite(async () => {
    const room = await must(input.code);
    const seat = room.seats.find((item) => item.token === input.token);
    if (!seat || seat.role !== "dm")
      throw new Error("Only the dungeon master can return to Local Mode.");
    if (Object.values(room.drafts ?? {}).some((c) => c.length))
      throw new Error("Submit or discard pending turns before closing the campaign.");
    const keepOnline = input.keepOnline === true;
    if (room.viewOnly && keepOnline) return;
    const next = structuredClone(room);
    const active = next.table.journal?.sessions.find((s) => !s.endedAt);
    if (active) {
      active.endedAt = Date.now();
      active.endLedgerIds = next.table.ledger.map((l) => l.id);
    }
    if (!room.viewOnly || active)
      archiveSession(
        next.table,
        active?.id || crypto.randomUUID(),
        active?.name || (keepOnline ? "Session ended" : "Room closed"),
      );
    for (const report of next.table.journal?.reports || [])
      if (!report.seatIds) report.seatIds = room.seats.map((s) => s.id);
    next.closed = !keepOnline;
    next.viewOnly = keepOnline;
    next.revision++;
    for (const p of next.table.purses) {
      p.editingAllowed = false;
      delete p.editBaseline;
    }
    await updateRoom(next, room.revision);
  });
}

export async function passTurn(input: { code: string; token: string }): Promise<RoomView> {
  // The DM skips the participant whose turn it was when they pressed Skip. A retry after a
  // conflict must not skip a second participant if another write already moved the turn on.
  let skipping: string | undefined;
  return retryRoomWrite(async (attempt) => {
    const room = await must(input.code);
    const current = room.seats[room.turn]?.id;
    if (attempt === 0) skipping = current;
    else if (current !== skipping)
      throw new Error("The turn already moved on. Check whose turn it is before skipping again.");
    if (room.drafts?.[room.seats[room.turn]?.id]?.length)
      throw new Error(
        "This participant has pending changes. Submit or discard them before skipping.",
      );
    const next = skipTurn(room, input.token);
    await updateRoom(next, room.revision);
    const seat = next.seats.find((item) => item.token === input.token);
    if (!seat) throw new Error("This browser is not seated at that table.");
    return view(next, seat, room);
  });
}

export type RoomView = {
  encounterActive?: boolean;
  userId?: string;
  viewOnly?: boolean;
  sessionId?: string;
  code: string;
  revision: number;
  turn: number;
  mine: boolean;
  who: string;
  seatId: string;
  purseIds: string[];
  shopIds: string[];
  seats: {
    id: string;
    name: string;
    role: "dm" | "player";
    pending: number;
    allowParty: boolean;
  }[];
  draft: string;
  acknowledged: string[];
  table: CloudTable;
  live: boolean;
  /** The DM's campaign name; absent when the DM has not named it (shown as "Shared campaign · CODE"). */
  campaignName?: string;
  departed?: Array<{ id: string; name: string; status: string; invitation?: string }>;
  testMode?: boolean;
};

function requireInvitationSession(room: CloudRoom, sessionId?: string) {
  if (room.sessionId && room.sessionId !== sessionId)
    throw Error("This invitation has expired. Ask the DM for the current session link.");
}

async function must(
  code: string,
  options?: import("./room-store.server.ts").ReadRoomOptions,
): Promise<CloudRoom> {
  const room = await readRoom(code.trim().toUpperCase(), options);
  if (!room) throw new Error("No table uses that code.");
  if (room.closed) throw new Error("This room is closed.");
  // Older clients may have staged a delayed copy of a committed action. Such a
  // receipt is never pending work and must not block session/turn transitions.
  const draftKeys = Object.entries(room.drafts ?? {}).flatMap(([seatId, commands]) =>
    commands.map((command) => seatId + ":" + command.id),
  );
  const acknowledged = draftKeys.length
    ? new Set((await lookupReceipts(room, "command", draftKeys)).keys())
    : new Set<string>();
  return keepStoredBody(room, {
    ...room,
    drafts: Object.fromEntries(
      Object.entries(room.drafts ?? {}).map(([seatId, commands]) => [
        seatId,
        commands.filter((command) => !acknowledged.has(seatId + ":" + command.id)),
      ]),
    ),
  });
}

/** The seat's projected campaign table: exactly what `view` sends that seat. */
async function seatTable(room: CloudRoom, seat: CloudSeat) {
  const record = projectRecord({ ...room.table, journal: room.table.journal }, seat, {
    directory: true,
  });
  const journal = record.journal;
  // Map posters come from the owner's account assets, which the room version does not cover.
  let posters = false;
  if (seat.role !== "dm" && room.ownerId) {
    const { projectedMapPoster } = await import("./map-assets.server.ts");
    await Promise.all(
      (journal?.world?.maps ?? []).map(async (map) => {
        if (map.tabletop?.media) {
          posters = true;
          map.image = (await projectedMapPoster(room.ownerId!, map.tabletop.media)) ?? map.image;
        }
      }),
    );
  }
  const table: CloudTable =
    seat.role === "dm"
      ? {
          ...room.table,
          journal,
          notes: room.table.notes.filter((note) => canReadNote(note, seat)),
        }
      : playerTable(room.table, record, seat);
  return { record, table, posters };
}

/** `read` is the room as read from storage when `room` is a derived next state of it. */
async function view(room: CloudRoom, seat: CloudSeat, read: CloudRoom = room): Promise<RoomView> {
  const current = room.seats[room.turn];
  const { record, table, posters } = await seatTable(room, seat);
  const result = withImageSources(read, {
    encounterActive: await activeEncounter(room.code),
    userId: seat.userId,
    code: room.code,
    sessionId: room.sessionId,
    revision: room.revision,
    turn: room.turn,
    viewOnly: room.viewOnly === true,
    mine: room.viewOnly ? seat.role === "dm" : room.live || current?.id === seat.id,
    who: room.live ? "everyone" : (current?.name ?? "Someone"),
    live: room.live === true,
    ...(room.campaignName ? { campaignName: room.campaignName } : {}),
    testMode: room.testMode === true,
    departed:
      seat.role === "dm"
        ? room.departed?.map((s) => ({
            id: s.id,
            name: s.name,
            status: s.status,
            invitation: s.purseIds.map((id) => room.invitations?.[id]).find(Boolean),
          }))
        : undefined,
    seatId: seat.id,
    purseIds: seat.purseIds,
    shopIds: record.shops.map((shop) => shop.id),
    seats: room.seats.map((item) => ({
      id: item.id,
      name: item.name,
      role: item.role,
      pending: room.drafts?.[item.id]?.length ?? 0,
      allowParty: room.table.purses.some((p) => p.kind === "party" && item.purseIds.includes(p.id)),
    })),
    // The seat's latest action IDs (bounded; a device holds at most 100 pending actions).
    acknowledged: await recentAcknowledged(read, seat.id),
    draft: JSON.stringify(room.drafts?.[seat.id] ?? []),
    table,
  });
  // The storage version this view projects (only when it is the room as read, not a derived next
  // state): keys the per-seat projected section cache (view-sections.server.ts). Non-enumerable.
  // A view with map posters is never cached: posters follow the owner's account assets, which
  // the room's revision and write_id do not cover.
  const version = room === read && !posters ? roomReadVersion(room) : null;
  if (version) Object.defineProperty(result, VIEW_VERSION_KEY, { value: version });
  return result;
}

/** Protocol 4 clients receive map images as references (tabletop-protocol.ts). */
function wantsImageReferences(protocol?: number) {
  return typeof protocol === "number" && protocol >= IMAGE_REFERENCE_PROTOCOL;
}
/**
 * Hand the response layer (tabletopResponse) the inline images this read restored from the
 * room's own rows, so protocol 4 responses can send their references instead. Non-enumerable:
 * it never serializes, and older protocols ignore it and receive the full inline envelope.
 */
function withImageSources(room: CloudRoom, value: RoomView): RoomView {
  const sources = roomImageSources(room);
  if (sources.size)
    Object.defineProperty(value, ROOM_IMAGE_SOURCES_KEY, {
      value: new Map([...sources].map(([reference, image]) => [image, reference])),
    });
  return value;
}

/**
 * Seat-authorized read of one shared map image (GET /api/room-image/CODE/HASH). The reference
 * must appear as a current map image in the seat's own projection, the same projection `view`
 * sends, so private or hidden maps, other seats' DM-only data and other campaigns stay
 * unreachable. The raster is read from this room's own rows only (never by hash alone).
 */
export async function authorizedRoomImage(input: {
  code: string;
  token: string;
  reference: string;
}): Promise<{ image: string } | { status: 403 | 404 }> {
  const { ROOM_IMAGE_REFERENCE, readRoomImage } = await import("../../../cloudflare/room-images.mjs");
  if (!ROOM_IMAGE_REFERENCE.test(input.reference)) return { status: 404 };
  const db = database();
  if (!db) return { status: 404 };
  let room: CloudRoom;
  try {
    room = await must(input.code, { mapImageReferences: true });
  } catch {
    return { status: 404 };
  }
  if (room.monitorProbe || isProbeRoomCode(room.code)) return { status: 404 };
  const seat = room.seats.find((s) => s.token === input.token);
  if (!seat) return { status: 403 };
  const { table } = await seatTable(room, seat);
  if (!(table.journal?.world?.maps ?? []).some((map) => map.image === input.reference))
    return { status: 404 };
  const image = await readRoomImage(db, room.code, input.reference);
  return image === null ? { status: 404 } : { image };
}

/**
 * Player projection on top of `projectRecord`. Owner decision (2026-10-22): other visible
 * party players' balances and ledger lines stay readable to party players, as before; a player
 * whose character is not with the party does not receive them. NPC, hidden-NPC,
 * exchange-treasury and non-party balances and ledger lines are never projected, and
 * purses the seat does not control never carry editing permissions. Owner decision (2026-10-22):
 * the DM may share party companion NPC funds with party players (off by default).
 */
function playerTable(table: CloudTable, record: CloudTable, seat: CloudSeat): CloudTable {
  const npcs = table.journal?.world?.npcs ?? [];
  const npcIds = new Set(npcs.map((n) => n.id));
  // A delegated NPC controller acts for that NPC (barter offers), so it keeps that NPC's funds readout.
  const controlled = new Set([
    ...seat.purseIds,
    ...npcs.filter((n) => npcController(n, seat)).map((n) => n.id),
  ]);
  const readableNpcs = new Set((record.journal?.world?.npcs ?? []).map((n) => n.id));
  const treasuries = new Set(
    (table.journal?.tradeEconomy?.exchanges ?? []).map((e) => e.purseId),
  );
  const partyPlayer = (p: Purse) =>
    characterVisible(table, p) &&
    !p.nonParty &&
    !npcIds.has(p.id) &&
    !treasuries.has(p.id) &&
    (p.kind === "party" || characterControl(p) === "player");
  // Party balances and ledger lines are shared only among the party: the viewer needs a visible
  // character travelling with the party (as for companion funds), and the account must be in the
  // party too. A player outside the party receives only their own (and delegated) data.
  const viewerInParty = seatInParty(table, seat);
  const sharedBalance = (p: Purse) => viewerInParty && partyPlayer(p) && inParty(table, p);
  // DM setting "Party can see companion NPC funds": a visible NPC travelling with the party is
  // readable (coins and ledger lines, never permissions) by seats with a visible party character.
  const companion = (p: Purse) => companionFundsReadable(table, p, seat);
  const byId = new Map(table.purses.map((p) => [p.id, p]));
  return {
    ...record,
    ledger: table.ledger.filter((l) => {
      if (controlled.has(l.purseId)) return true;
      const p = byId.get(l.purseId);
      return !!p && (sharedBalance(p) || companion(p));
    }),
    purses: record.purses.map((projected) => {
      const p = byId.get(projected.id)!;
      if (!characterVisible(table, p)) return projected;
      if (seat.purseIds.includes(p.id)) {
        if (canReadCharacter(table, p, seat)) return p;
        const {
          sheet: _sheet,
          sheetRevision: _revision,
          profileId: _profile,
          editBaseline: _baseline,
          rolls: _rolls,
          ...ownPurse
        } = p;
        return ownPurse;
      }
      // Not controlled by this seat: the projected public fields only.
      const portrait =
        projected.portrait ??
        (p.portrait && (partyPlayer(p) || readableNpcs.has(p.id)) ? p.portrait : undefined);
      return {
        ...projected,
        ...(portrait ? { portrait } : {}),
        ...(sharedBalance(p) || companion(p) || controlled.has(p.id) ? { coins: p.coins } : {}),
      };
    }),
  };
}

async function freshCode(): Promise<string> {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = "";
    for (const byte of crypto.getRandomValues(new Uint8Array(8)))
      code += alphabet[byte % alphabet.length];
    if (!(await readRoom(code))) return code;
  }
  throw new Error("Could not open a table. Try again.");
}

// Commands are validated against authoritative state and committed with a revision CAS.
export async function submitCommands(input: {
  /** The client's tabletop protocol; protocol 9 and older apps can't see party groups. */
  tabletopProtocol?: number;
  code: string;
  token: string;
  batchId: string;
  commands: unknown[];
  endTurn?: boolean;
  stage?: boolean;
}): Promise<RoomView> {
  const { commandSchema, applyCommandBatch, compactPatch } = await import("./commands.ts");
  const { commandIdentity, canonicalJson, sameCommand } = await import("./command-identity.ts");
  if (JSON.stringify(input).length > 2_000_000)
    throw new Error("The pending batch is too large. Submit smaller changes.");
  if (
    !input.batchId ||
    input.batchId.length > 150 ||
    !Array.isArray(input.commands) ||
    input.commands.length > 100
  )
    throw new Error("Invalid command batch (maximum 100 actions).");
  const commands = input.commands.map((c) => commandSchema.parse(c));
  // Map image references are a wire form only (tabletop protocol 4). Clients restore the inline
  // image before any command is made; a reference inside a command would be stored as artwork.
  if (commands.some((c) => /\/art\/room-image-[a-f0-9]{64}\.webp/.test(JSON.stringify(c))))
    throw Error(
      "This action refers to shared map artwork that has not finished loading. Wait for the map to load, then retry. Your pending actions are retained.",
    );
  const seasonalPlan = (c: (typeof commands)[number]) =>
    c.kind === "trade-season-plan" || (c.kind === "downtime-plan" && c.advanceSeason);
  if (input.stage && commands.some(seasonalPlan))
    throw Error("Seasonal previews must be prepared directly by the DM authority.");
  if (input.stage && commands.some((c) => c.kind.startsWith("npc-barter-")))
    throw Error("NPC barter is answered by the room directly. Send the offer again.");
  // Treasure-pool claims move nothing and resolutions are rolled by the room: both are sent
  // directly, never staged with a turn.
  if (input.stage && commands.some((c) => c.kind === "loot-claim" || c.kind === "loot-resolve"))
    throw Error("Treasure-pool claims and resolutions are sent to the room directly. Send it again.");
  // Quest commands move nothing and are the DM's alone: sent directly, never staged with a turn.
  if (input.stage && commands.some((c) => c.kind.startsWith("quest-")))
    throw Error("Quest changes are sent to the room directly. Send it again.");
  // Pen & Paper totals follow the campaign's manual-roll policy (play_policies), read on the server.
  const manualRolls = commands.some((c) => c.kind === "loot-resolve" && c.rolls === "manual")
    ? await manualCharacterRolls(input.code)
    : false;
  const { randomTradeRoll } = await import("./trade-economy.ts");
  const seasonalRolls = new Map<string, number>();
  const digest = async (value: string) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const hashes = new Map<string, string>();
  for (const command of commands) {
    const hash = "v2:" + (await digest(commandIdentity(command)));
    if (hashes.has(command.id) && hashes.get(command.id) !== hash)
      throw Error(
        "An action ID contains conflicting changes. Export your pending actions before retrying.",
      );
    hashes.set(command.id, hash);
  }
  const batchHash = "v2:" + (await digest(canonicalJson(commands)));
  // Revision conflicts re-run everything below on a fresh read, after a jittered pause
  // (room-write-retry.ts); receipts keep every action applied once however often it is retried.
  return retryRoomWrite(async () => {
    const room = await must(input.code),
      seat = room.seats.find((s) => s.token === input.token);
    if (!seat)
      throw new Error("This session is no longer assigned. Ask the DM to release your character.");
    if (room.viewOnly && seat.role === "player")
      throw Error("The session has ended. This room is view-only until the DM resumes play.");
    // Split the party: older apps place everyone with the main group, so the server refuses their
    // actions for characters in another group (tabletop protocol 10).
    if ((input.tabletopProtocol ?? 0) < PARTY_GROUPS_PROTOCOL) {
      if (commands.some((c) => groupCommandText(c)))
        throw Error("Update Lootsplitter to split, move or merge the party's groups.");
      refuseOldClientGroupActions(room.table, commands);
    }
    const key = seat.id + ":" + input.batchId;
    // Receipts for this batch, its actions and the seat's staged actions (room-store.server.ts).
    const commandReceipts = await lookupReceipts(room, "command", [
      ...new Set([
        ...commands.map((c) => seat.id + ":" + c.id),
        ...(room.drafts?.[seat.id] ?? []).map((c) => seat.id + ":" + c.id),
      ]),
    ]);
    const batchReceipt = await lookupReceipts(room, "batch", [key]);
    for (const command of commands) {
      const previous = commandReceipts.get(seat.id + ":" + command.id);
      // Unversioned receipts retain their original validated JSON algorithm;
      // only new receipts use canonical semantics and an explicit version.
      if (
        previous &&
        previous !== hashes.get(command.id) &&
        (previous.startsWith("v2:") || previous !== (await digest(JSON.stringify(command))))
      )
        throw Error(
          "An action ID contains conflicting changes. Export your pending actions before retrying.",
        );
      const staged = room.drafts?.[seat.id]?.find((c) => c.id === command.id);
      // A draft staged with the whole journal equals its split form (journal-patch.ts).
      if (staged && !sameCommand(compactPatch(staged), compactPatch(command)))
        throw Error(
          "Another device saved different changes for this action. Export your pending actions before retrying.",
        );
    }
    if (batchReceipt.has(key)) {
      const previous = batchReceipt.get(key);
      if (
        (previous &&
          previous !== batchHash &&
          (previous.startsWith("v2:") || previous !== (await digest(JSON.stringify(commands))))) ||
        commands.some((c) => !commandReceipts.has(seat.id + ":" + c.id))
      )
        throw Error(
          "This batch ID was already used for different actions. Export your pending actions before retrying.",
        );
      return view(room, seat);
    }
    // Chat, treasure-pool claims and quest changes (which move nothing) may be sent outside the seat's turn
    // (owner decision, 2026-10-23).
    // Quest changes (DM only, nothing moves) are not bound to the turn either.
    const messagesOnly =
      commands.length > 0 &&
      commands.every((c) => c.kind === "message" || c.kind === "loot-claim" || c.kind.startsWith("quest-"));
    if (!room.viewOnly && !messagesOnly && !room.live && room.seats[room.turn]?.id !== seat.id)
      throw new Error("It is not your turn. Your pending actions have been preserved.");
    const seen = new Set(commandReceipts.keys());
    // Per-seat flood protection, messages included (room-submit-limit.ts). Message text is
    // counted once: staged or already committed messages do not count again.
    const alreadyStaged = new Set((room.drafts?.[seat.id] ?? []).map((c) => c.id));
    const messageChars = commands.reduce(
      (total, c) =>
        c.kind === "message" && !seen.has(seat.id + ":" + c.id) && !alreadyStaged.has(c.id)
          ? total + c.text.length
          : total,
      0,
    );
    const allowance = takeSubmitAllowance(room.submitAllowance?.[seat.id], Date.now(), messageChars);
    if (!allowance) throw Object.assign(Error(SUBMIT_LIMIT_MESSAGE), { status: 429 });
    const drafts = { ...(room.drafts ?? {}) };
    if (input.stage) {
      // Drafts staged before journal changes were split keep their action IDs in the split form.
      const pending = (drafts[seat.id] ?? []).map((c) => compactPatch(c));
      const known = new Set(pending.map((c) => c.id));
      for (const command of commands)
        if (!seen.has(seat.id + ":" + command.id) && !known.has(command.id)) {
          pending.push(command);
          known.add(command.id);
        }
      if (pending.length > 100)
        throw Error(
          "Another device has pending actions. Submit or resolve the saved turn before adding more.",
        );
      drafts[seat.id] = pending;
    }
    let table = room.table;
    const receipts: RoomReceipt[] = [];
    // Validate the entire merged draft against the authoritative table. Two
    // individually valid device queues may overspend when combined.
    const selected = new Set(seen);
    const unapplied = (input.stage ? drafts[seat.id]! : commands).filter((command) => {
      const key = seat.id + ":" + command.id;
      if (selected.has(key)) return false;
      selected.add(key);
      return true;
    });
    // Footprints (tabletop protocol 12): older apps send footprint tokens in their centre form.
    const applied =
      (input.tabletopProtocol ?? 0) < FOOTPRINT_PROTOCOL ? upgradeFootprintCommands(table, unapplied) : unapplied;
    table = applyCommandBatch(table, seat, applied, (command) => ({
      source: "server",
      manualRolls,
      random: (draw) => {
        const key = command.id + ":" + draw;
        if (!seasonalRolls.has(key)) seasonalRolls.set(key, randomTradeRoll());
        return seasonalRolls.get(key)!;
      },
    }));
    for (const command of unapplied) {
      const key = seat.id + ":" + command.id;
      seen.add(key);
      if (!input.stage) receipts.push({ kind: "command", key, hash: hashes.get(command.id)! });
    }
    if (!input.stage) receipts.push({ kind: "batch", key, hash: batchHash });
    for (const report of table.journal?.reports || [])
      if (!room.table.journal?.reports?.some((r) => r.id === report.id))
        report.seatIds = room.seats.map((s) => s.id);
    if (!input.stage)
      drafts[seat.id] = (drafts[seat.id] ?? []).filter((c) => !seen.has(seat.id + ":" + c.id));
    if (!input.stage && input.endTurn && drafts[seat.id]?.length)
      throw Error(
        "Another device has saved unfinished actions. Refresh and submit the complete turn, or export and resolve those actions before ending it.",
      );
    const next: CloudRoom = {
      ...room,
      table: input.stage ? room.table : table,
      viewOnly:
        !input.stage && seat.role === "dm" && commands.some((c) => c.kind === "session" && !c.end)
          ? false
          : room.viewOnly,
      drafts,
      submitAllowance: {
        ...Object.fromEntries(
          Object.entries(room.submitAllowance ?? {}).filter(([id]) =>
            room.seats.some((s) => s.id === id),
          ),
        ),
        [seat.id]: allowance,
      },
      revision: room.revision + 1,
      turn:
        !input.stage && input.endTurn && !room.live
          ? (room.turn + 1) % room.seats.length
          : room.turn,
    };
    await updateRoom(next, room.revision, { receipts });
    // Only after the successful write (a retried attempt that lost the race never notifies).
    if (!input.stage) {
      const fresh = next.table.notes.filter(
        (note) => !room.table.notes.some((old) => old.id === note.id),
      );
      if (fresh.length) {
        // After the response on a Worker (waitUntil), so a slow push service never holds the
        // sender's submit or tab lock (2026-10-28 load audit, F12); awaited without a context.
        const { afterResponse } = await import("../../../cloudflare/request-context.mjs");
        await afterResponse(async () => {
          try {
            const { pushMessages } = await import("./push.server.ts");
            await pushMessages(next, seat.id, fresh);
          } catch {
            console.warn("Background notification failed; campaign changes remain saved.");
          }
        });
      }
    }
    return view(next, seat, room);
  });
}

/** NPC barter quote for one seat. Players get the public quote only: no valuation or rules. */
export async function npcBarterQuote(input: {
  code: string;
  token: string;
  [key: string]: unknown;
}): Promise<import("./npc-barter.ts").PublicBarterQuote | import("./npc-barter.ts").BarterQuote> {
  const { quoteNpcBarter, publicQuote } = await import("./npc-barter.ts");
  const { barterSideSchema } = await import("./npc-barter-schema.ts");
  const { z } = await import("zod");
  const offer = z
    .object({
      npcId: z.string().min(1).max(150),
      purseId: z.string().min(1).max(150),
      give: barterSideSchema,
      ask: barterSideSchema,
    })
    .parse({ npcId: input.npcId, purseId: input.purseId, give: input.give, ask: input.ask });
  const room = await must(input.code),
    seat = room.seats.find((s) => s.token === input.token);
  if (!seat) throw new Error("This session is no longer assigned.");
  if (seat.role !== "dm" && !seat.purseIds.includes(offer.purseId))
    throw Error("Only this character's player or the DM can see these odds.");
  const quote = quoteNpcBarter(room.table, seat, offer);
  return seat.role === "dm" ? quote : publicQuote(quote);
}

export async function manageRoom(input: {
  code: string;
  token: string;
  action: "release" | "leave" | "kick" | "ban" | "invite" | "permission" | "start" | "discard";
  seatId: string;
  allowParty?: boolean;
}): Promise<RoomView> {
  return retryRoomWrite(async () => {
    const room = await must(input.code),
      caller = room.seats.find((s) => s.token === input.token);
    if (!caller) throw new Error("Session not found.");
    if (input.action !== "discard" && input.action !== "leave" && caller.role !== "dm")
      throw new Error("Only the DM can manage participants.");
    const target =
      room.seats.find((s) => s.id === input.seatId) ||
      (input.action === "invite" ? room.departed?.find((s) => s.id === input.seatId) : undefined);
    if (!target) throw new Error("Participant not found.");
    if (input.action === "leave" && (caller.role !== "player" || target.id !== caller.id))
      throw Error("Only players can leave their own seat. The DM must close the room.");
    if (input.action === "discard" && caller.role !== "dm" && target.id !== caller.id)
      throw new Error("Only your own pending changes can be discarded.");
    const next = structuredClone(room);
    next.revision++;
    if (["release", "leave", "kick", "ban"].includes(input.action)) {
      if (target.role === "dm") throw new Error("The DM cannot be removed.");
      if (next.drafts?.[target.id]?.length)
        throw new Error(
          "This player has pending changes. Export or discard them before releasing the character.",
        );
      const current = room.seats[room.turn]?.id;
      const db = database();
      const member = db
        ? await db
            .prepare("SELECT user_id FROM library_members WHERE code=? AND seat_id=? AND token=?")
            .bind(room.code, target.id, target.token)
            .first<{ user_id: string }>()
        : null;
      // Forget removes a library listing, not the canonical account identity of
      // an assigned seat. Keep campaign restrictions attached to that identity.
      const userId = target.userId || member?.user_id;
      const finalStatus =
        input.action === "release"
          ? "dismissed"
          : input.action === "leave"
            ? "left"
            : input.action === "kick"
              ? "kicked"
              : "banned";
      next.departed = [
        ...(next.departed || []).filter((s) => s.id !== target.id),
        { ...target, status: finalStatus as "left" | "dismissed" | "kicked" | "banned", userId },
      ];
      if (userId && (input.action === "kick" || input.action === "ban"))
        (next.blockedUsers ??= {})[userId] = input.action === "ban" ? "banned" : "kicked";
      const { applyCommand } = await import("./commands.ts");
      for (const p of next.table.purses.filter(
        (p) => target.purseIds.includes(p.id) && p.editingAllowed,
      ))
        next.table = applyCommand(
          next.table,
          caller.role === "dm" ? caller : room.seats.find((s) => s.role === "dm")!,
          { id: crypto.randomUUID(), kind: "character-editing", purseId: p.id, allowed: false },
        );
      if (next.drafts) delete next.drafts[target.id];
      next.seats = next.seats.filter((s) => s.id !== target.id);
      next.turn = Math.max(
        0,
        next.seats.findIndex((s) => s.id === current),
      );
    } else if (input.action === "invite") {
      if (target.role !== "player" || (target as { status?: string }).status === "banned")
        throw Error("Banned participants cannot be invited.");
      for (const id of target.purseIds.filter((id) =>
        room.table.purses.some((p) => p.id === id && p.kind === "character"),
      ))
        (next.invitations ??= {})[id] = crypto.randomUUID();
    } else if (input.action === "permission") {
      if (target.role === "dm") throw new Error("The DM already controls all accounts.");
      if (next.drafts?.[target.id]?.length)
        throw new Error(
          "Submit or discard this player’s pending changes before changing permissions.",
        );
      const parties = new Set(room.table.purses.filter((p) => p.kind === "party").map((p) => p.id));
      next.seats = next.seats.map((s) =>
        s.id === target.id
          ? {
              ...s,
              purseIds: [
                ...s.purseIds.filter((id) => !parties.has(id)),
                ...(input.allowParty ? [...parties] : []),
              ],
            }
          : s,
      );
    } else if (input.action === "start") {
      if (Object.values(room.drafts ?? {}).some((c) => c.length))
        throw new Error("Submit or discard pending changes before changing the turn.");
      next.turn = next.seats.findIndex((s) => s.id === target.id);
    } else {
      if (next.drafts) delete next.drafts[target.id];
    }
    await updateRoom(next, room.revision);
    return view(next, next.seats.find((s) => s.id === caller.id) ?? caller, room);
  });
}

/**
 * The seat's projected combat map and the bound encounter's row, or null when this seat may not
 * see combat on `mapId` (map controls PR 6; audit 2026-10-28 F8). Gates: seated; an active
 * binding on this map; players only while the DM shows combat on this scene. Seats, binding,
 * scene and encounter come from one statement (`readCombatView`), so they are always consistent
 * with each other; map rasters and archived reports are not read.
 */
async function combatView(input: {code:string;token:string;mapId:string}) {
  const code=input.code.trim().toUpperCase(), read=await readCombatView(code);
  if(!read)throw new Error("No table uses that code.");
  const {room,encounter}=read;
  if(room.closed)throw new Error("This room is closed.");
  const seat=room.seats.find(s=>s.token===input.token), binding=room.table.journal?.world?.combat;
  if(!seat)throw Error("This browser is not seated at that table.");
  if(!binding || binding.phase!=="active" || binding.mapId!==input.mapId) return null;
  if(!database() || !encounter)return null;
  if(seat.role!=="dm" && (!binding.showPlayers || room.table.journal?.world?.tabletop?.presentation?.id!==binding.id))return null;
  const projected=projectRecord({ ...room.table, journal: { ...room.table.journal!, reports: [] } },seat),map=projected.journal?.world?.maps.find(m=>m.id===input.mapId);
  if(!map)return null;
  return {seat,map,encounterId:binding.encounterId,row:{status:encounter.status,body:JSON.parse(encounter.body)}};
}
/** The initiative panel for a seat: `projectMapCombatOrder` on the seat's projected map. */
export async function mapCombatOrder(input: {code:string;token:string;mapId:string}) {
  const view=await combatView(input);
  if(!view)return null;
  const {projectMapCombatOrder}=await import("./map-combat.ts");
  return projectMapCombatOrder(view.map,view.encounterId,view.row,view.seat.role==="dm"?[]:view.seat.purseIds);
}
/** Read-only, freshly authorized combat presentation (HUD) for the map being viewed. */
export async function mapCombatPresentation(input: {code:string;token:string;mapId:string}) {
  const view=await combatView(input);
  if(!view)return null;
  const {projectMapCombat}=await import("./map-combat.ts");
  return projectMapCombat(view.map,view.encounterId,view.row);
}
