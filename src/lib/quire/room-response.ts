import { readCloudTable } from "./cloud.ts";
import { commandSchema, type Command } from "./commands.ts";
import type { RoomView } from "./cloud.server.ts";

const incompleteResponse =
  "The shared campaign response was incomplete. Your pending actions are retained. Try again; if this continues, export any pending actions before refreshing the page.";

function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(typeof Response !== "undefined" && value instanceof Response)
  );
}

const text = (value: unknown): value is string => typeof value === "string";
const identifier = (value: unknown): value is string => text(value) && value.length > 0;
const identifiers = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(identifier);
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const optionalText = (value: unknown) => value === undefined || text(value);
const optionalBoolean = (value: unknown) => value === undefined || typeof value === "boolean";

function seat(value: unknown): boolean {
  return (
    record(value) &&
    identifier(value.id) &&
    text(value.name) &&
    (value.role === "dm" || value.role === "player") &&
    count(value.pending) &&
    typeof value.allowParty === "boolean"
  );
}

function departedSeat(value: unknown): boolean {
  return (
    record(value) &&
    identifier(value.id) &&
    text(value.name) &&
    text(value.status) &&
    optionalText(value.invitation)
  );
}

/** Validate a response before any caller changes its session, receipts or pending work. */
export function readRoomResponse(value: unknown): { remote: RoomView; draft: Command[] } {
  try {
    if (
      !record(value) ||
      !identifier(value.code) ||
      !identifier(value.seatId) ||
      !count(value.revision) ||
      !count(value.turn) ||
      typeof value.mine !== "boolean" ||
      typeof value.live !== "boolean" ||
      !text(value.who) ||
      !identifiers(value.purseIds) ||
      !identifiers(value.shopIds) ||
      !identifiers(value.acknowledged) ||
      !Array.isArray(value.seats) ||
      !value.seats.every(seat) ||
      !optionalText(value.userId) ||
      !optionalText(value.sessionId) ||
      !optionalBoolean(value.viewOnly) ||
      !optionalBoolean(value.testMode) ||
      (value.departed !== undefined &&
        (!Array.isArray(value.departed) || !value.departed.every(departedSeat))) ||
      !text(value.draft) ||
      !record(value.table)
    )
      throw new Error(incompleteResponse);

    const table = value.table;
    for (const key of [
      "purses",
      "holdings",
      "shops",
      "stock",
      "ledger",
      "listings",
      "loans",
      "sheets",
      "notes",
    ] as const)
      if (!Array.isArray(table[key])) throw new Error(incompleteResponse);
    if (table.handouts !== undefined && !Array.isArray(table.handouts))
      throw new Error(incompleteResponse);

    // Use the same runtime reader as hydration, which retains old archive data.
    // This is validation only: return the original table, not a normalized copy.
    if (!readCloudTable(table)) throw new Error(incompleteResponse);

    const draft: unknown = JSON.parse(value.draft);
    if (
      !Array.isArray(draft) ||
      !draft.every((command) => commandSchema.safeParse(command).success)
    )
      throw new Error(incompleteResponse);

    // Keep receipt content intact. Schema defaults, trim and unknown-field
    // stripping must not replace the original commands parsed from the response.
    return { remote: value as unknown as RoomView, draft: draft as Command[] };
  } catch {
    // Do not expose raw gateway bodies, account data or parser internals. A lost
    // response does not establish whether the server committed the action.
    throw new Error(incompleteResponse);
  }
}
