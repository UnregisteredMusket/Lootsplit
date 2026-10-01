import { readRoom } from "./room-store.server.ts";
import { noteIsForSeat } from "./notify.ts";
import type { CloudRoom } from "./cloud.ts";
import type { ChatNote } from "./chat.ts";
import { SignJWT, importJWK } from "jose";

type Statement = {
  bind(...args: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
};
type PushDb = { prepare(query: string): Statement };
type Keys = { publicKey: string; privateKey: JsonWebKey };
function database(): PushDb | undefined {
  return (globalThis as typeof globalThis & { __env__?: { DB?: PushDb } }).__env__?.DB;
}
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export function validPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value.length < 2048 &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}
async function keys(db: PushDb): Promise<Keys> {
  const existing = await db
    .prepare("SELECT body FROM push_config WHERE id = 'vapid'")
    .first<{ body: string }>();
  if (existing) return JSON.parse(existing.body);
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const next: Keys = {
    publicKey: base64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
  await db
    .prepare("INSERT OR IGNORE INTO push_config (id, body) VALUES ('vapid', ?)")
    .bind(JSON.stringify(next))
    .run();
  const saved = await db
    .prepare("SELECT body FROM push_config WHERE id = 'vapid'")
    .first<{ body: string }>();
  if (!saved) throw new Error("Could not prepare notifications.");
  return JSON.parse(saved.body);
}
async function member(input: { code: string; token: string }) {
  const room = await readRoom(input.code.trim().toUpperCase());
  const seat = room?.seats.find((s) => s.token === input.token);
  if (!room || !seat) throw new Error("Join a room before enabling push notifications.");
  return { room, seat };
}
export async function pushSettings(input: { code: string; token: string; endpoint?: string }) {
  const { room, seat } = await member(input);
  const db = database();
  if (!db) return { available: false, publicKey: "", subscribed: false };
  const k = await keys(db);
  const row = input.endpoint
    ? await db
        .prepare(
          "SELECT endpoint FROM push_subscriptions WHERE room_code = ? AND seat_id = ? AND endpoint = ?",
        )
        .bind(room.code, seat.id, input.endpoint)
        .first()
    : null;
  return { available: true, publicKey: k.publicKey, subscribed: !!row };
}
export async function setPushSubscription(input: {
  code: string;
  token: string;
  endpoint: string;
  enabled: boolean;
}) {
  const { room, seat } = await member(input);
  const db = database();
  if (!db) throw new Error("Background notifications require the hosted website.");
  if (!validPushEndpoint(input.endpoint))
    throw new Error("This browser's push service is not supported yet.");
  if (!input.enabled) {
    await db
      .prepare(
        "DELETE FROM push_subscriptions WHERE endpoint = ? AND room_code = ? AND seat_id = ?",
      )
      .bind(input.endpoint, room.code, seat.id)
      .run();
    return;
  }
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE room_code = ? AND seat_id = ?")
    .bind(room.code, seat.id)
    .first<{ n: number }>();
  const existing = await db
    .prepare(
      "SELECT endpoint FROM push_subscriptions WHERE endpoint = ? AND room_code = ? AND seat_id = ?",
    )
    .bind(input.endpoint, room.code, seat.id)
    .first();
  if (!existing && (count?.n ?? 0) >= 4)
    throw new Error("This player already has notifications enabled on four devices.");
  await db
    .prepare(
      "INSERT OR IGNORE INTO push_subscriptions (endpoint, room_code, seat_id) VALUES (?, ?, ?)",
    )
    .bind(input.endpoint, room.code, seat.id)
    .run();
}
export async function pushAuthorization(endpoint: string, k: Keys): Promise<string> {
  const privateKey = await importJWK(k.privateKey, "ES256");
  const jwt = await new SignJWT({})
    .setProtectedHeader({ typ: "JWT", alg: "ES256" })
    .setAudience(new URL(endpoint).origin)
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .setSubject("https://lootsplit.oliverstorie2017.workers.dev")
    .sign(privateKey);
  return `vapid t=${jwt}, k=${k.publicKey}`;
}
/** Empty Web Push payload: neither message text nor room code reaches the push provider. */
export async function pushMessages(
  room: CloudRoom,
  senderId: string,
  notes: ChatNote[],
): Promise<void> {
  const db = database();
  if (!db || !notes.length) return;
  const { results } = await db
    .prepare(
      "SELECT endpoint, seat_id FROM push_subscriptions WHERE room_code = ? AND last_sent < ?",
    )
    .bind(room.code, Date.now() - 5000)
    .all<{ endpoint: string; seat_id: string }>();
  const targets = results.filter((row) => {
    const seat = room.seats.find((s) => s.id === row.seat_id);
    return !!seat && seat.id !== senderId && notes.some((note) => noteIsForSeat(note, seat));
  });
  if (!targets.length) return;
  const k = await keys(db);
  await Promise.allSettled(
    targets.map(async (row) => {
      if (!validPushEndpoint(row.endpoint)) return;
      await db
        .prepare(
          "UPDATE push_subscriptions SET last_sent = ? WHERE endpoint = ? AND room_code = ? AND seat_id = ?",
        )
        .bind(Date.now(), row.endpoint, room.code, row.seat_id)
        .run();
      const response = await fetch(row.endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: await pushAuthorization(row.endpoint, k),
          TTL: "300",
          Urgency: "normal",
          Topic: "lootsplit-chat",
          "Content-Length": "0",
        },
        signal: AbortSignal.timeout(4000),
      });
      if (response.status === 404 || response.status === 410)
        await db
          .prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
          .bind(row.endpoint)
          .run();
      else if (!response.ok) console.warn("Push service rejected a notification", response.status);
    }),
  );
}
