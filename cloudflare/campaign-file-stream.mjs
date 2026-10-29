/**
 * Streaming whole-campaign files (storage follow-up, part 2).
 *
 * Download a copy and the deletion recovery copy are the DM's projection of the whole campaign as
 * a device backup file (account-campaigns.mjs `campaignFile`). Built at once, that held every
 * archived session hydrated, parsed, projected and serialized together, so its memory grew with
 * the whole campaign. Here the file is produced as text, one archived session at a time: the
 * campaign without its archived sessions is projected once, and each session is read from its own
 * rows, hydrated, projected (`projectArchivedReport`, as `projectRecord` does) and serialized
 * before the next is read. Peak memory is the working campaign plus the largest single session.
 *
 * The text is byte for byte what `JSON.stringify(campaignFile(projectRecord(whole), room))` gave:
 * the projected campaign is serialized with a placeholder where its archived sessions go, and
 * their JSON is spliced in in the same order (scripts/campaign-file-stream.test.mjs).
 */
import { hydrateRoomImages } from "./room-images.mjs";
import { projectArchivedReport, projectRecord } from "../src/lib/quire/session-records.ts";
import { readCloudTable } from "../src/lib/quire/cloud.ts";

const PLACEHOLDER = "\u0000lootsplit-streamed-reports";
const PLACEHOLDER_JSON = JSON.stringify([PLACEHOLDER]);
const unsafe = () =>
  Object.assign(
    Error("An archived record cannot be safely backed up. Your campaign was not deleted. Export your records for recovery first."),
    { status: 409 },
  );

/**
 * The DM's campaign file of a stored room (as `readStoredRoom` returns it, history pages
 * included), as an async sequence of text chunks. `wrap(file)` builds the file object around the
 * projected campaign (account-campaigns.mjs `campaignFile`); `envelope(text)` optionally wraps it
 * further (a response object), with `text` as its placeholder.
 *
 * Every archived session is read and checked once before the first chunk (a damaged one refuses
 * the whole file with the same message as before, nothing sent); then read again as it streams.
 * @param {any} db @param {any} room the stored room @param {any} seat the DM's seat
 * @param {(projected: any) => any} wrap
 * @param {(placeholder: string) => any} [envelope]
 * @returns {Promise<{ chunks: () => AsyncGenerator<string>; reports: number }>}
 */
export async function campaignFileStream(db, room, seat, wrap, envelope) {
  const table = await hydrateRoomImages(db, room.code, room.table, { deferReports: true });
  const projected = projectRecord(table, seat);
  const listed = projected.journal?.reports ?? null;
  const stored = new Map((room.table?.journal?.reports ?? []).map((report) => [report.id, report]));
  /** One archived session, hydrated from its rows and projected for the seat. */
  const project = async (/** @type {{ id: string }} */ entry) => {
    const report = stored.get(entry.id);
    if (!report) throw unsafe();
    const one = await hydrateRoomImages(db, room.code, { journal: { reports: [report] } });
    const value = projectArchivedReport(one.journal.reports[0], table, seat, {});
    if (value.error) throw unsafe();
    return JSON.stringify(value);
  };
  if (!readCloudTable(projected)) throw unsafe();
  // Pass 1: every session can be read and projected (nothing is kept).
  for (const entry of listed ?? []) await project(entry);
  let file;
  if (listed?.length) {
    projected.journal.reports = [PLACEHOLDER];
    file = JSON.stringify(wrap(projected));
  } else file = JSON.stringify(wrap(projected));
  const outer = envelope ? JSON.stringify(envelope(PLACEHOLDER)) : null;
  const split = (/** @type {string} */ text, /** @type {string} */ marker) => {
    const at = text.indexOf(marker);
    if (at < 0 || text.indexOf(marker, at + 1) >= 0) throw Error("The campaign file could not be assembled.");
    return [text.slice(0, at), text.slice(at + marker.length)];
  };
  const [envelopeStart, envelopeEnd] = outer ? split(outer, JSON.stringify(PLACEHOLDER)) : ["", ""];
  const [fileStart, fileEnd] = listed?.length ? split(file, PLACEHOLDER_JSON) : [file, ""];
  return {
    reports: listed?.length ?? 0,
    async *chunks() {
      yield envelopeStart + fileStart;
      if (listed?.length) {
        yield "[";
        for (const [index, entry] of listed.entries()) yield (index ? "," : "") + (await project(entry));
        yield "]";
      }
      yield fileEnd + envelopeEnd;
    },
  };
}

/** A Response streaming `chunks` as JSON (the account API's headers). */
export function streamedJson(/** @type {() => AsyncGenerator<string>} */ chunks) {
  const encoder = new TextEncoder();
  const source = chunks();
  return new Response(
    new ReadableStream({
      async pull(controller) {
        try {
          const next = await source.next();
          if (next.done) controller.close();
          else controller.enqueue(encoder.encode(next.value));
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() {
        void source.return(undefined);
      },
    }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}
