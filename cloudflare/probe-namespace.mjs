/**
 * Isolated namespace for the owner monitor's synthetic multiplayer probe (owner-approved 2026-10-22).
 *
 * Every real room code is made only of letters and digits (open: 8 characters without 0/1/I/O;
 * owner Test mode: "T" + 7 hex; campaign recovery: 10 hex), so a code containing "-" can never be a
 * player's campaign. Probe rooms use `MONITOR-PROBE-<slot>` and exist only for the seconds of one
 * probe run. Every count, analytics total and listing over `campaign_rooms` excludes this namespace,
 * and players cannot preview or join a probe room.
 */
export const PROBE_PREFIX = "MONITOR-PROBE-";
/** SQL predicate (no bound values) that excludes probe rooms; `column` is a trusted literal. */
export const notProbeRoom = (column = "code") => `${column} NOT GLOB 'MONITOR-PROBE-*'`;
/** @param {unknown} code */
export const isProbeRoomCode = (code) =>
  typeof code === "string" && code.trim().toUpperCase().startsWith(PROBE_PREFIX);
