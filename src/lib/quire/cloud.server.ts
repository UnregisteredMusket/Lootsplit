import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  claimSeat,
  endDmTurn,
  endPlayerTurn,
  readCloudTable,
  setRoomLive,
  skipTurn,
  type CloudRoom,
  type CloudSeat,
  type CloudTable,
} from "./cloud.ts";
import type { BillFile } from "./table.ts";

const FILE = path.join(process.cwd(), "data", "cloud-rooms.json");
const rooms = new Map<string, CloudRoom>();
let loaded = false;

export async function openRoom(input: { name: string; table: CloudTable }): Promise<{ code: string; token: string; seatId: string; revision: number }> {
  await load();
  const table = readCloudTable(input.table);
  if (!table || table.purses.length === 0) throw new Error("The table has no characters to share.");
  const code = freshCode();
  const seat: CloudSeat = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: input.name.trim() || "Dungeon master", role: "dm", purseIds: [] };
  rooms.set(code, { code, revision: 1, turn: 0, live: false, seats: [seat], table, seen: { gifts: [], sales: [] } });
  await save();
  return { code, token: seat.token, seatId: seat.id, revision: 1 };
}

export async function previewRoom(code: string): Promise<{ characters: { id: string; name: string }[] }> {
  const room = await must(code);
  return {
    characters: room.table.purses
      .filter((purse) => purse.kind === "character" && !room.seats.some((seat) => seat.purseIds.includes(purse.id)))
      .map((purse) => ({ id: purse.id, name: purse.name })),
  };
}

export async function joinRoom(input: { code: string; purseId: string; name: string }): Promise<{ token: string; seatId: string; revision: number; purseIds: string[]; shopIds: string[] }> {
  const room = await must(input.code);
  const claimed = claimSeat(room, input.purseId, input.name);
  const next = { ...claimed.room, revision: claimed.room.revision + 1 };
  rooms.set(room.code, next);
  await save();
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
  if (!seat) throw new Error("This phone is not seated at that table.");
  return view(room, seat);
}

export async function publishTurn(input: { code: string; token: string; baseRevision?: number; table?: CloudTable; bill?: BillFile }): Promise<RoomView> {
  const room = await must(input.code);
  const seat = room.seats.find((item) => item.token === input.token);
  if (!seat) throw new Error("This phone is not seated at that table.");
  let next = room;
  if (seat.role === "dm") {
    const table = readCloudTable(input.table);
    if (!table) throw new Error("The table could not be published.");
    next = endDmTurn(room, input.token, table, input.baseRevision);
  } else if (input.bill) {
    next = endPlayerTurn(room, input.token, input.bill, input.baseRevision);
  } else {
    throw new Error("There is nothing to publish.");
  }
  rooms.set(room.code, next);
  await save();
  const updated = next.seats.find((item) => item.id === seat.id) ?? seat;
  return view(next, updated);
}

export async function choosePace(input: { code: string; token: string; live: boolean }): Promise<RoomView> {
  const room = await must(input.code);
  const next = setRoomLive(room, input.token, input.live);
  rooms.set(room.code, next);
  await save();
  const seat = next.seats.find((item) => item.token === input.token);
  if (!seat) throw new Error("This phone is not seated at that table.");
  return view(next, seat);
}

export async function closeRoom(input: { code: string; token: string }): Promise<void> {
  const room = await must(input.code);
  const seat = room.seats.find((item) => item.token === input.token);
  if (!seat || seat.role !== "dm") throw new Error("Only the dungeon master can return to Local Mode.");
  rooms.delete(room.code);
  await save();
}

export async function passTurn(input: { code: string; token: string }): Promise<RoomView> {
  const room = await must(input.code);
  const next = skipTurn(room, input.token);
  rooms.set(room.code, next);
  await save();
  const seat = next.seats.find((item) => item.token === input.token);
  if (!seat) throw new Error("This phone is not seated at that table.");
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
  seats: { name: string; role: "dm" | "player" }[];
  table: CloudTable;
  live: boolean;
};

async function must(code: string): Promise<CloudRoom> {
  await load();
  const room = rooms.get(code.trim().toUpperCase());
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
    seats: room.seats.map((item) => ({ name: item.name, role: item.role })),
    table: room.table,
  };
}

function freshCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = "";
    for (let i = 0; i < 5; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error("Could not open a table. Try again.");
}

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const text = await readFile(FILE, "utf8");
    const parsed = JSON.parse(text) as CloudRoom[];
    if (!Array.isArray(parsed)) return;
    for (const room of parsed) {
      if (room && typeof room.code === "string" && readCloudTable(room.table)) rooms.set(room.code, { ...room, live: room.live === true });
    }
  } catch {
    // The first table creates the file.
  }
}

async function save(): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  const list = [...rooms.values()].slice(-20);
  await writeFile(FILE, JSON.stringify(list));
}
