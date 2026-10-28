/**
 * Synthetic multiplayer round trip for the owner monitor (owner-approved 2026-10-22).
 *
 * Once per half-hour collection the scheduler opens a probe room through the real server room
 * path, seats a DM and a guest, sends one chat message as the guest, reads it back with the same
 * poll reader the clients use, checks revision/idempotency/authorization behaviour and deletes the
 * room again. Footprint: one `campaign_rooms` row in the isolated `MONITOR-PROBE-<slot>` namespace
 * (see probe-namespace.mjs) that exists for the duration of one run; no account, membership,
 * image, roll, encounter or push rows are created. The row is never visible to players, counts,
 * analytics or listings. Leftovers from an interrupted run are removed by the next run.
 */
import { PROBE_PREFIX } from "./probe-namespace.mjs";

export const PROBE_TIMEOUT_MS = 10000;
/** A probe result older than this no longer verifies the current state (two slots + slack). */
export const PROBE_FRESH_MS = 65 * 60000;
const CHARACTER = "monitor-probe-character";

class ProbeFailure extends Error {}
const expect = (condition, message) => {
  if (!condition) throw new ProbeFailure(message);
};
async function rejects(work, pattern, message) {
  try {
    await work();
  } catch (error) {
    expect(error instanceof Error && pattern.test(error.message), message);
    return;
  }
  throw new ProbeFailure(message);
}

export const probeCode = (slot) => `${PROBE_PREFIX}${slot}`;

/** The minimum valid campaign: one player character, nothing else. */
function probeTable() {
  return {
    purses: [
      {
        id: CHARACTER,
        kind: "character",
        name: "Probe adventurer",
        coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
    ],
    holdings: [],
    shops: [],
    stock: [],
    ledger: [],
    listings: [],
    loans: [],
    sheets: [],
    notes: [],
  };
}

/**
 * Removes probe rooms left by an interrupted earlier run (never the current slot's room, which
 * may belong to a concurrent run). Real campaigns cannot match: their codes contain no "-".
 */
async function sweep(db, slot) {
  const [result] = await db.batch([
    db
      .prepare(
        "DELETE FROM campaign_rooms WHERE code GLOB 'MONITOR-PROBE-*' AND CAST(substr(code,15) AS INTEGER)<?",
      )
      .bind(slot),
    // Their action receipts (campaign_room_receipts, migration 0024) go with them.
    db
      .prepare(
        "DELETE FROM campaign_room_receipts WHERE code GLOB 'MONITOR-PROBE-*' AND CAST(substr(code,15) AS INTEGER)<?",
      )
      .bind(slot),
  ]);
  return result.meta?.changes ?? 0;
}

/**
 * Runs one probe. Never throws: returns `{ outcome: "passed" | "failed" | "skipped", ... }`.
 * `rooms` and `store` default to the real server modules; tests inject failures through them.
 */
export async function runMultiplayerProbe(
  env,
  slot,
  { timeoutMs = PROBE_TIMEOUT_MS, rooms, store, clock = () => Date.now() } = {},
) {
  const db = env.DB,
    code = probeCode(slot),
    started = clock(),
    steps = [];
  // The room store reads its binding from the request environment, as for every client request.
  if (!globalThis.__env__?.DB) globalThis.__env__ = env;
  rooms ??= await import("../src/lib/quire/cloud.server.ts");
  store ??= await import("../src/lib/quire/room-store.server.ts");
  let created = false,
    owned = false,
    current = "sweep",
    swept = 0;
  const step = async (name, work) => {
    current = name;
    const at = clock();
    const value = await work();
    steps.push({ step: name, ms: clock() - at });
    return value;
  };
  const work = (async () => {
    swept = await step("sweep", () => sweep(db, slot));
    // A room with this slot's code means another run owns this slot: do nothing to it.
    if (await store.readRoomAccess(code)) return { skipped: true };
    const probe = { monitorProbe: true, code };
    const host = await step("open", async () => {
      let opened;
      try {
        opened = await rooms.openRoom({ name: "Monitor probe DM", table: probeTable() }, probe);
      } catch (error) {
        // Lost a race for this slot's code: the other run owns the room.
        if (await store.readRoomAccess(code)) return null;
        throw error;
      }
      created = owned = true;
      expect(
        opened.code === code && opened.revision === 1,
        "the new room did not start at revision 1",
      );
      return opened;
    });
    if (!host) return { skipped: true };
    const guest = await step("join", async () => {
      const joined = await rooms.joinRoom(
        { code, purseId: CHARACTER, name: "Monitor probe guest" },
        probe,
      );
      expect(joined.revision === 2, "joining did not advance the room revision");
      expect(joined.purseIds.includes(CHARACTER), "the guest seat did not receive its character");
      return joined;
    });
    await step("authorization", async () => {
      await rejects(
        () => rooms.roomState({ code, token: "monitor-probe-unseated" }),
        /not seated/,
        "an unseated token could read the room",
      );
      await rejects(
        () => rooms.joinRoom({ code, purseId: CHARACTER, name: "Outsider" }),
        /No table uses that code/,
        "a probe room accepted an outside join",
      );
    });
    const message = {
      id: `monitor-probe-message-${slot}`,
      kind: "message",
      to: "dm",
      purseId: CHARACTER,
      text: `Monitor probe ${slot}`,
    };
    const batch = {
      code,
      token: guest.token,
      batchId: `monitor-probe-${slot}`,
      commands: [message],
    };
    await step("send", async () => {
      const sent = await rooms.submitCommands(batch);
      expect(sent.revision === 3, "sending a message did not commit exactly one revision");
      const retried = await rooms.submitCommands(batch);
      expect(retried.revision === 3, "a retried command batch was applied twice");
    });
    await step("read", async () => {
      const read = await rooms.pollRoom({
        code,
        token: host.token,
        knownRevision: 2,
        knownSeatId: host.seatId,
      });
      expect(!read.unchanged && read.revision === 3, "the DM did not receive the new revision");
      expect(
        read.table.notes.some((n) => n.id === message.id && n.text === message.text),
        "the DM's poll did not return the guest's message",
      );
      const unchanged = await rooms.pollRoom({
        code,
        token: host.token,
        knownRevision: 3,
        knownSeatId: host.seatId,
      });
      expect(unchanged.unchanged === true, "an up-to-date poll was not answered as unchanged");
    });
    await step("revision", async () => {
      const room = await store.readRoom(code);
      expect(room?.revision === 3, "the stored room revision is not 3");
      await rejects(
        () => store.updateRoom({ ...room, revision: 3 }, 2),
        /table changed/,
        "a write from a stale revision was accepted",
      );
    });
    await step("cleanup", async () => {
      await store.deleteRoom(code, 3);
      owned = false;
      expect(
        !(await store.readRoomAccess(code)),
        "the probe room was still present after deletion",
      );
    });
    return { skipped: false };
  })();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  let result, failure;
  try {
    result = await Promise.race([work, timeout]);
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(timer);
  }
  if (result?.timedOut) {
    // Let a slow step finish (bounded) so the cleanup below cannot run before a late insert.
    let grace;
    const settled = await Promise.race([
      work.then(
        (value) => value,
        () => null,
      ),
      new Promise((resolve) => {
        grace = setTimeout(() => resolve(null), 2000);
      }),
    ]);
    clearTimeout(grace);
    if (settled?.skipped) result = settled;
  }
  // After a timeout the slot's room is this run's unless another run owned the slot.
  const cleanup = await finalCleanup(
    db,
    code,
    result?.timedOut ? !result?.skipped : created && owned,
  );
  const durationMs = clock() - started;
  const base = { slot, code, startedAt: started, durationMs, steps, swept, cleanup };
  if (result?.skipped)
    return {
      ...base,
      outcome: "skipped",
      summary: "Another run owns this slot's multiplayer probe.",
    };
  if (!failure && !result?.timedOut)
    return {
      ...base,
      outcome: "passed",
      summary: `Multiplayer round trip passed in ${durationMs} ms: open, join, authorization, message, poll read-back, revision and cleanup.`,
    };
  const symptom = result?.timedOut
    ? `timed out after ${timeoutMs} ms during ${current}`
    : failure instanceof ProbeFailure
      ? `${current}: ${failure.message}`
      : `${current}: the room service returned an unexpected error`;
  return {
    ...base,
    outcome: "failed",
    failedStep: current,
    errorCode: result?.timedOut ? "MULTIPLAYER_PROBE_TIMEOUT" : "MULTIPLAYER_PROBE_FAILED",
    summary: `Multiplayer round trip failed (${symptom}).${cleanup === "failed" ? " The probe room could not be removed; the next run removes it." : ""}`,
  };
}

/** Removes this run's room if it still exists (failure or timeout). Never touches other codes. */
async function finalCleanup(db, code, pending) {
  if (!pending) return "complete";
  try {
    await db.batch([
      db.prepare("DELETE FROM campaign_rooms WHERE code=?").bind(code),
      db.prepare("DELETE FROM campaign_room_receipts WHERE code=?").bind(code),
    ]);
    return "deleted-after-failure";
  } catch {
    return "failed";
  }
}
