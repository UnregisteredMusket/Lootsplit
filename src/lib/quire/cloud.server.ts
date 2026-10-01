import { readRoom, createRoom, updateRoom, deleteRoom } from "./room-store.server.ts";
import {
  claimSeat,
  readCloudTable,
  setRoomLive,
  skipTurn,
  type CloudRoom,
  type CloudSeat,
  type CloudTable,
} from "./cloud.ts";
import { characterControl } from "./types.ts";
import type { BillFile } from "./table.ts";

export async function openRoom(input: {
  name: string;
  table: CloudTable;
}): Promise<{ code: string; token: string; seatId: string; revision: number }> {
  const table = readCloudTable(input.table);
  if (!table || table.purses.length === 0) throw new Error("The table has no characters to share.");
  const code = await freshCode();
  const seat: CloudSeat = {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    name: input.name.trim() || "Dungeon master",
    role: "dm",
    purseIds: [],
  };
  await createRoom({
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
): Promise<{ characters: { id: string; name: string }[] }> {
  const room = await must(code);
  return {
    characters: room.table.purses
      .filter(
        (purse) =>
          purse.kind === "character" &&
          characterControl(purse) === "player" &&
          !room.seats.some((seat) => seat.purseIds.includes(purse.id)),
      )
      .map((purse) => ({ id: purse.id, name: purse.name })),
  };
}

export async function joinRoom(input: {
  code: string;
  purseId: string;
  name: string;
}): Promise<{
  token: string;
  seatId: string;
  revision: number;
  purseIds: string[];
  shopIds: string[];
}> {
  const room = await must(input.code);
  const claimed = claimSeat(room, input.purseId, input.name);
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
  await deleteRoom(room.code, room.revision);
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
};

async function must(code: string): Promise<CloudRoom> {
  const room = await readRoom(code.trim().toUpperCase());
  if (!room) throw new Error("No table uses that code.");
  return room;
}

function view(room: CloudRoom, seat: CloudSeat): RoomView {
  const current = room.seats[room.turn];
  return {
    code: room.code,
    revision: room.revision,
    turn: room.turn,
    mine: room.live || current?.id === seat.id,
    who: room.live ? "everyone" : (current?.name ?? "Someone"),
    live: room.live === true,
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
        ? room.table
        : {
            ...room.table,
            notes: room.table.notes.filter(
              (note) => note.to === "party" || seat.purseIds.includes(note.purseId),
            ),
            loans: room.table.loans.filter((loan) => seat.purseIds.includes(loan.purseId)),
            sheets: room.table.sheets.filter((sheet) => seat.purseIds.includes(sheet.purseId)),
          },
  };
}

async function freshCode(): Promise<string> {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = "";
    for (let i = 0; i < 5; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
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
  action: "release" | "permission" | "start" | "discard";
  seatId: string;
  allowParty?: boolean;
}): Promise<RoomView> {
  const room = await must(input.code),
    caller = room.seats.find((s) => s.token === input.token);
  if (!caller) throw new Error("Session not found.");
  if (input.action !== "discard" && caller.role !== "dm")
    throw new Error("Only the DM can manage participants.");
  const target = room.seats.find((s) => s.id === input.seatId);
  if (!target) throw new Error("Participant not found.");
  if (input.action === "discard" && caller.role !== "dm" && target.id !== caller.id)
    throw new Error("Only your own pending changes can be discarded.");
  const next = structuredClone(room);
  next.revision++;
  if (input.action === "release") {
    if (target.role === "dm") throw new Error("The DM cannot be removed.");
    if (next.drafts?.[target.id]?.length)
      throw new Error(
        "This player has pending changes. Export or discard them before releasing the character.",
      );
    const current = room.seats[room.turn]?.id;
    next.seats = next.seats.filter((s) => s.id !== target.id);
    next.turn = Math.max(
      0,
      next.seats.findIndex((s) => s.id === current),
    );
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
