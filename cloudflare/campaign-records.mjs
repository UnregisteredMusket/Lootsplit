/**
 * Archived session reports of every campaign an account belongs to (Account → Session records).
 *
 * Streamed (storage follow-up (c)): this used to hydrate each member campaign whole, every archived
 * session and image at once, so its memory grew with the account's whole history. Now each
 * campaign's working set is read on its own, and each archived session is read from its own rows,
 * hydrated, projected for the seat and serialized before the next is read. Peak memory is one
 * campaign's working set plus its largest single session.
 *
 * The response is byte for byte what `JSON.stringify({ reports })` of the old whole-campaign read
 * gave, in the same order (scripts/campaign-records-stream.test.mjs). Everything that refused the
 * old read (a missing or damaged archived session, a missing image) is checked before the first
 * byte, so it still refuses the whole request with the same message and nothing is sent: each
 * session is read and checked once (images by reference only, never loaded; resource packs read
 * one session at a time), then read again as it streams. (When one campaign has both a missing
 * image and a missing pack, the first one met is reported, per session rather than images first.)
 */
import { hydrateRoomImages } from "./room-images.mjs";
import { hydrateRoomReports } from "./room-reports.mjs";
import { hydrateRoomResources } from "./room-resources.mjs";
import { readMemberRooms } from "./room-storage.mjs";
import { readArchivedSnapshot } from "../src/lib/quire/journal.ts";
import { projectRecord } from "../src/lib/quire/session-records.ts";
import { CURRENT_TABLETOP_PROTOCOL, tableForProtocol } from "../src/lib/quire/tabletop-protocol.ts";

const IMAGE_REFERENCE = /\/art\/room-image-[a-f0-9]{64}\.webp/g;
const UNREADABLE = "This archived report cannot be read. Keep its original backup for recovery.";

/** Refuses, as hydration would, when any image `text` refers to is not stored for the room. */
async function checkImages(/** @type {any} */ db, /** @type {string} */ code, /** @type {string} */ text) {
  const refs = [...new Set(text.match(IMAGE_REFERENCE) || [])];
  for (let offset = 0; offset < refs.length; offset += 80) {
    const wanted = refs.slice(offset, offset + 80);
    const rows = await db
      .prepare(
        `SELECT reference FROM campaign_room_images WHERE code=? AND reference IN (${wanted.map(() => "?").join(",")})`,
      )
      .bind(code, ...wanted)
      .all();
    const found = new Set(rows.results.map((/** @type {{ reference: string }} */ row) => row.reference));
    for (const ref of wanted)
      if (!found.has(ref))
        throw Error("A campaign image is missing. Keep the original recovery export; the campaign was not changed.");
  }
}

/**
 * The account's archived reports as text chunks of `{"reports":[...]}`. `protocol` below the
 * current tabletop protocol converts each snapshot for older apps (`tableForProtocol`), as the route did.
 * @param {any} db @param {string} user @param {number} [protocol]
 * @returns {Promise<{ chunks: () => AsyncGenerator<string>; reports: number }>}
 */
export async function campaignRecordsStream(db, user, protocol = Infinity) {
  // Member campaigns in the order the whole read listed them; each one is read on its own.
  const codes = (
    await db
      .prepare("SELECT m.code FROM library_members m JOIN campaign_rooms r ON r.code=m.code WHERE m.user_id=?")
      .bind(user)
      .all()
  ).results.map((/** @type {{ code: string }} */ row) => row.code);
  /** @type {{ code: string; campaign: string; seat: any; report: any }[]} */
  const listed = [];
  for (const code of new Set(codes))
    for (const { member: m, stored } of await readMemberRooms(db, user, { code })) {
      const room = stored.room;
      // Pass 1, the working set: images and resource packs it refers to must exist (the whole
      // read hydrated them; a pack is read here and let go).
      await checkImages(db, m.code, JSON.stringify(room));
      await hydrateRoomResources(db, m.code, room);
      if (room.blockedUsers?.[user] === "banned") continue;
      const seat = [...room.seats, ...(room.departed || [])].find((s) => s.id === m.seat_id && s.token === m.token);
      // Every session is checked even for a seat that sees none of them (the whole read hydrated
      // them all before deciding), so a damaged session refuses exactly as before.
      for (const report of room.table?.journal?.reports || []) {
        const one = await hydrateRoomReports(db, m.code, { journal: { reports: [report] } });
        const snapshot = one.journal.reports[0]?.snapshot;
        if (typeof snapshot === "string") await checkImages(db, m.code, snapshot);
        // Resource packs inside the session, as hydration restores them (integrity review of #388).
        await hydrateRoomResources(db, m.code, one);
        if (!seat || seat.status === "banned") continue;
        if (report.seatIds && !report.seatIds.includes(seat.id)) continue;
        listed.push({ code: m.code, campaign: m.name, seat, report });
      }
    }
  /** One entry: the session read from its rows, hydrated, projected for the seat and serialized. */
  const entry = async (/** @type {(typeof listed)[number]} */ item) => {
    const { report: r, seat } = item;
    const hydrated = (await hydrateRoomImages(db, item.code, { journal: { reports: [r] } })).journal.reports[0];
    let snapshot, error;
    try {
      snapshot = projectRecord(readArchivedSnapshot(hydrated.snapshot), seat);
    } catch {
      error = UNREADABLE;
    }
    if (snapshot && protocol < CURRENT_TABLETOP_PROTOCOL) snapshot = tableForProtocol(snapshot, protocol);
    return JSON.stringify({
      id: r.id,
      code: item.code,
      campaign: item.campaign,
      name: r.name,
      at: r.at,
      snapshot,
      ...(error ? { error } : {}),
    });
  };
  return {
    reports: listed.length,
    async *chunks() {
      yield '{"reports":[';
      for (const [index, item] of listed.entries()) yield (index ? "," : "") + (await entry(item));
      yield "]}";
    },
  };
}

/** The account's archived reports as one value (tests and callers that need the object). */
export async function campaignRecords(/** @type {any} */ db, /** @type {string} */ user) {
  const { chunks } = await campaignRecordsStream(db, user);
  let text = "";
  for await (const chunk of chunks()) text += chunk;
  return JSON.parse(text);
}
