import { readRoom, createRoom, updateRoom } from "./room-store.server.ts";
import {
  claimSeat,
  readCloudTable,
  setRoomLive,
  skipTurn,
  type CloudRoom,
  type CloudSeat,
  type CloudTable,
} from "./cloud.ts";
import { archiveSession, projectRecord } from "./session-records.ts";
import { canReadNote } from "./chat-visibility.ts";
import { characterControl } from "./types.ts";
import type { BillFile } from "./table.ts";
import { characterSheet } from "../characters/campaign-sheet.mjs";
import { makeCampaignRoll } from "../characters/campaign-roll.mjs";
import { manualCharacterRolls, database } from "./room-store.server.ts";

export async function characterRoll(input: {
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
  if (!seat || !p || (seat.role !== "dm" && !seat.purseIds.includes(p.id)))
    throw Error("You do not control this character.");
  if (input.policy) return { manualAllowed: await manualCharacterRolls(room.code) };
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
        "INSERT INTO play_rolls(id,user_id,character_id,code,request_key,body,created_at) SELECT ?,NULL,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND body=?) AND (?=0 OR EXISTS(SELECT 1 FROM play_policies WHERE code=? AND manual_allowed=1)) ON CONFLICT(id) DO NOTHING",
      )
      .bind(
        receipt,
        `party:${p.id}`,
        room.code,
        String(input.requestKey),
        JSON.stringify(roll),
        Date.now(),
        room.code,
        JSON.stringify(room),
        input.manual ? 1 : 0,
        room.code,
      )
      .run();
    const saved = await db
      .prepare("SELECT body FROM play_rolls WHERE id=?")
      .bind(receipt)
      .first<{ body: string }>();
    if (!saved) throw Error("Campaign changed. Reload and retry.");
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
}): Promise<{ code: string; token: string; seatId: string; revision: number }> {
  const table = readCloudTable(input.table);
  if (!table || table.purses.length === 0) throw new Error("The table has no characters to share.");
  const code = await freshCode();
  const seat: CloudSeat = {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    name: input.name.trim() || "Dungeon master",
    role: "dm",
    userId: input.userId,
    purseIds: [],
  };
  await createRoom({
    ownerId: input.userId,
    sessionId: input.userId ? crypto.randomUUID() : undefined,
    code,
    revision: 1,
    turn: 0,
    live: false,
    seats: [seat],
    table,
    seen: { gifts: [], sales: [] },
  });
  return { code, token: seat.token, seatId: seat.id, revision: 1 };
}

export async function previewRoom(
  code: string,
  sessionId?: string,
  userId?: string,
): Promise<{ characters: { id: string; name: string }[] }> {
  const room = await must(code);
  requireInvitationSession(room, sessionId);
  return {
    characters: room.table.purses
      .filter(
        (purse) =>
          purse.kind === "character" &&
          characterControl(purse) === "player" &&
          !room.seats.some((seat) => seat.purseIds.includes(purse.id) && (!userId || seat.userId !== userId)),
      )
      .map((purse) => ({ id: purse.id, name: purse.name })),
  };
}

export async function joinRoom(input: { code: string; purseId: string; name: string; invitation?: string; userId?: string; sessionId?: string }): Promise<{
  token: string;
  seatId: string;
  revision: number;
  purseIds: string[];
  shopIds: string[];
}> {
  const room = await must(input.code);
  if (room.testMode) throw Error("Test rooms are private to the owner.");
  requireInvitationSession(room, input.sessionId);
  const existing = input.userId && room.seats.find(s => s.userId === input.userId && s.role === "player");
  if (existing) return { token: existing.token, seatId: existing.id, revision: room.revision, purseIds: existing.purseIds, shopIds: room.table.shops.map(s => s.id) };
  const blocked = input.userId && room.blockedUsers?.[input.userId];
  if (blocked === "banned") throw Error("You are banned from this campaign.");
  const restriction = room.departed?.find(s => s.purseIds.includes(input.purseId) && (s.status === "kicked" || s.status === "banned"));
  if (restriction?.status === "banned") throw Error("This character is blocked from joining. Ask the DM.");
  if ((blocked === "kicked" || restriction) && (!input.invitation || room.invitations?.[input.purseId] !== input.invitation))
    throw Error("A fresh invitation from the DM is required.");
  const previous = input.userId && room.departed?.find(s => s.userId === input.userId && s.status === "dismissed");
  const claimed = claimSeat(room, input.purseId, input.name);
  claimed.seat.userId = input.userId;
  if (previous) claimed.seat.id = previous.id;
  if (input.invitation && room.invitations?.[input.purseId] !== input.invitation) throw Error("This invitation has expired.");
  if (input.userId && claimed.room.blockedUsers) delete claimed.room.blockedUsers[input.userId];
  if (claimed.room.invitations) delete claimed.room.invitations[input.purseId];
  const next = { ...claimed.room, revision: claimed.room.revision + 1 };
  await updateRoom(next, room.revision);
  return {
    token: claimed.seat.token,
    seatId: claimed.seat.id,
    revision: next.revision,
    purseIds: claimed.seat.purseIds,
    shopIds: claimed.room.table.shops.map((shop) => shop.id),
  };
}

export async function roomState(input: { code: string; token: string }): Promise<RoomView> {
  const room = await must(input.code);
  const seat = room.seats.find((item) => item.token === input.token);
  if (!seat) throw new Error("This browser is not seated at that table.");
  return view(room, seat);
}

export async function publishTurn(_input: {
  code: string;
  token: string;
  baseRevision?: number;
  table?: CloudTable;
  bill?: BillFile;
}): Promise<RoomView> {
  throw new Error(
    "This client uses an older sharing protocol. Reload Lootsplit before submitting changes.",
  );
}

export async function choosePace(input: {
  code: string;
  token: string;
  live: boolean;
}): Promise<RoomView> {
  const room = await must(input.code);
  if (Object.values(room.drafts ?? {}).some((c) => c.length))
    throw new Error("Submit or discard all pending turns before changing modes.");
  const next = setRoomLive(room, input.token, input.live);
  await updateRoom(next, room.revision);
  const seat = next.seats.find((item) => item.token === input.token);
  if (!seat) throw new Error("This browser is not seated at that table.");
  return view(next, seat);
}

export async function closeRoom(input: { code: string; token: string }): Promise<void> {
  const room = await must(input.code);
  const seat = room.seats.find((item) => item.token === input.token);
  if (!seat || seat.role !== "dm")
    throw new Error("Only the dungeon master can return to Local Mode.");
  if (Object.values(room.drafts ?? {}).some((c) => c.length))
    throw new Error("Submit or discard pending turns before closing the campaign.");
  const next = structuredClone(room);
  const active = next.table.journal?.sessions.find(s => !s.endedAt);
  if (active) { active.endedAt = Date.now(); active.endLedgerIds = next.table.ledger.map(l => l.id); }
  archiveSession(next.table, active?.id || crypto.randomUUID(), active?.name || "Room closed");
  for (const report of next.table.journal?.reports || []) if (!report.seatIds) report.seatIds = room.seats.map(s => s.id);
  next.closed = true;
  next.revision++;
  for (const p of next.table.purses) { p.editingAllowed = false; delete p.editBaseline; }
  await updateRoom(next, room.revision);
}

export async function passTurn(input: { code: string; token: string }): Promise<RoomView> {
  const room = await must(input.code);
  if (room.drafts?.[room.seats[room.turn]?.id]?.length)
    throw new Error(
      "This participant has pending changes. Submit or discard them before skipping.",
    );
  const next = skipTurn(room, input.token);
  await updateRoom(next, room.revision);
  const seat = next.seats.find((item) => item.token === input.token);
  if (!seat) throw new Error("This browser is not seated at that table.");
  return view(next, seat);
}

export type RoomView = {
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
  departed?: Array<{ id: string; name: string; status: string; invitation?: string }>;
  testMode?: boolean;
};

function requireInvitationSession(room: CloudRoom, sessionId?: string) {
  if (room.sessionId && room.sessionId !== sessionId)
    throw Error("This invitation has expired. Ask the DM for the current session link.");
}

async function must(code: string): Promise<CloudRoom> {
  const room = await readRoom(code.trim().toUpperCase());
  if (!room) throw new Error("No table uses that code.");
  if (room.closed) throw new Error("This room is closed.");
  return room;
}

function view(room: CloudRoom, seat: CloudSeat): RoomView {
  const current = room.seats[room.turn];
  const journal = projectRecord({ ...room.table, journal: room.table.journal }, seat).journal;
  return {
    code: room.code,
    sessionId: room.sessionId,
    revision: room.revision,
    turn: room.turn,
    mine: room.live || current?.id === seat.id,
    who: room.live ? "everyone" : (current?.name ?? "Someone"),
    live: room.live === true,
    testMode: room.testMode === true,
    departed: seat.role === "dm" ? room.departed?.map(s => ({ id: s.id, name: s.name, status: s.status, invitation: s.purseIds.map(id => room.invitations?.[id]).find(Boolean) })) : undefined,
    seatId: seat.id,
    purseIds: seat.purseIds,
    shopIds: room.table.shops.map((shop) => shop.id),
    seats: room.seats.map((item) => ({
      id: item.id,
      name: item.name,
      role: item.role,
      pending: room.drafts?.[item.id]?.length ?? 0,
      allowParty: room.table.purses.some((p) => p.kind === "party" && item.purseIds.includes(p.id)),
    })),
    acknowledged: (room.commands ?? [])
      .filter((id) => id.startsWith(seat.id + ":"))
      .map((id) => id.slice(seat.id.length + 1)),
    draft: JSON.stringify(room.drafts?.[seat.id] ?? []),
    table:
      seat.role === "dm"
        ? { ...room.table, journal, notes: room.table.notes.filter((note) => canReadNote(note, seat)) }
        : {
            ...room.table,
            purses: room.table.purses.map((p) => {
              if (seat.purseIds.includes(p.id)) return p;
              const {
                sheet: _sheet,
                sheetRevision: _revision,
                profileId: _profile,
                editBaseline: _editBaseline,
                rolls: _rolls,
                ...publicPurse
              } = p;
              return publicPurse;
            }),
            notes: room.table.notes.filter((note) => canReadNote(note, seat)),
            journal: journal
              ? {
                  ...journal,
                  finance: undefined,
                  editReports: journal.editReports?.filter(r => seat.purseIds.includes(r.purseId)),
                  requests: journal.requests.filter((r) =>
                    seat.purseIds.includes(r.purseId),
                  ),
                  events: journal.events
                    .filter((e) => !e.purseId || seat.purseIds.includes(e.purseId))
                    .map(({ change, ...event }) => event),
                }
              : undefined,
            loans: room.table.loans.filter((loan) => seat.purseIds.includes(loan.purseId)),
            sheets: room.table.sheets.filter((sheet) => seat.purseIds.includes(sheet.purseId)),
          },
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
  code: string;
  token: string;
  batchId: string;
  commands: unknown[];
  endTurn?: boolean;
  stage?: boolean;
}): Promise<RoomView> {
  const { commandSchema, applyCommand } = await import("./commands.ts");
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
  for (let attempt = 0; attempt < 5; attempt++) {
    const room = await must(input.code),
      seat = room.seats.find((s) => s.token === input.token);
    if (!seat)
      throw new Error("This session is no longer assigned. Ask the DM to release your character.");
    const key = seat.id + ":" + input.batchId;
    if (room.batches?.includes(key)) return view(room, seat);
    const messagesOnly = commands.length > 0 && commands.every((c) => c.kind === "message");
    if (!messagesOnly && !room.live && room.seats[room.turn]?.id !== seat.id)
      throw new Error("It is not your turn. Your pending actions have been preserved.");
    let table = room.table;
    const seen = new Set(room.commands ?? []);
    for (const command of commands) {
      const key = seat.id + ":" + command.id;
      if (seen.has(key)) continue;
      table = applyCommand(table, seat, command);
      seen.add(key);
    }
    for (const report of table.journal?.reports || [])
      if (!room.table.journal?.reports?.some(r => r.id === report.id)) report.seatIds = room.seats.map(s => s.id);
    const drafts = { ...(room.drafts ?? {}) };
    if (input.stage) {
      drafts[seat.id] = commands;
    } else if (!messagesOnly) {
      delete drafts[seat.id];
    }
    const next: CloudRoom = {
      ...room,
      table: input.stage ? room.table : table,
      drafts,
      revision: room.revision + 1,
      commands: input.stage ? room.commands : [...seen],
      batches: input.stage ? room.batches : [...(room.batches ?? []), key],
      turn:
        !input.stage && input.endTurn && !room.live
          ? (room.turn + 1) % room.seats.length
          : room.turn,
    };
    try {
      await updateRoom(next, room.revision);
      if (!input.stage) {
        const fresh = next.table.notes.filter(
          (note) => !room.table.notes.some((old) => old.id === note.id),
        );
        if (fresh.length) {
          try {
            const { pushMessages } = await import("./push.server.ts");
            await pushMessages(next, seat.id, fresh);
          } catch {
            console.warn("Background notification failed; campaign changes remain saved.");
          }
        }
      }
      return view(next, seat);
    } catch (error) {
      if (attempt === 4 || !(error instanceof Error) || !error.message.includes("table changed"))
        throw error;
    }
  }
  throw new Error("The campaign is busy. Retry your saved pending actions.");
}

export async function manageRoom(input: {
  code: string;
  token: string;
  action: "release" | "leave" | "kick" | "ban" | "invite" | "permission" | "start" | "discard";
  seatId: string;
  allowParty?: boolean;
}): Promise<RoomView> {
  const room = await must(input.code),
    caller = room.seats.find((s) => s.token === input.token);
  if (!caller) throw new Error("Session not found.");
  if (input.action !== "discard" && input.action !== "leave" && caller.role !== "dm")
    throw new Error("Only the DM can manage participants.");
  const target = room.seats.find((s) => s.id === input.seatId) ||
    (input.action === "invite" ? room.departed?.find(s => s.id === input.seatId) : undefined);
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
    const member = db ? await db.prepare("SELECT user_id FROM library_members WHERE code=? AND seat_id=? AND token=?").bind(room.code, target.id, target.token).first<{user_id:string}>() : null;
    const finalStatus = input.action === "release" ? "dismissed" : input.action === "leave" ? "left" : input.action === "kick" ? "kicked" : "banned";
    next.departed = [...(next.departed || []).filter(s => s.id !== target.id), { ...target, status: finalStatus as "left" | "dismissed" | "kicked" | "banned", userId: member?.user_id }];
    if (member && (input.action === "kick" || input.action === "ban"))
      (next.blockedUsers ??= {})[member.user_id] = input.action === "ban" ? "banned" : "kicked";
    const { applyCommand } = await import("./commands.ts");
    for (const p of next.table.purses.filter(p => target.purseIds.includes(p.id) && p.editingAllowed))
      next.table = applyCommand(next.table, caller.role === "dm" ? caller : room.seats.find(s => s.role === "dm")!, { id: crypto.randomUUID(), kind: "character-editing", purseId:p.id, allowed:false });
    if (next.drafts) delete next.drafts[target.id];
    next.seats = next.seats.filter((s) => s.id !== target.id);
    next.turn = Math.max(
      0,
      next.seats.findIndex((s) => s.id === current),
    );
  } else if (input.action === "invite") {
    if (target.role !== "player" || (target as { status?: string }).status === "banned") throw Error("Banned participants cannot be invited.");
    for (const id of target.purseIds.filter(id => room.table.purses.some(p => p.id === id && p.kind === "character")))
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
  return view(next, next.seats.find((s) => s.id === caller.id) ?? caller);
}
