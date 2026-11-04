/**
 * The player view of a shared campaign, shared by the server and the device (no server imports).
 *
 * `cloud.server.ts` `view()` sends a player seat `playerTable(table, projectRecord(table, seat,
 * { directory: true }), seat)`; the DM's read-only "Preview as player" (player-preview.ts) runs the
 * same two functions on the DM's own copy (`seatView`), so the preview holds exactly what that seat
 * would receive (player-preview.test.ts proves it against the server for one fixture).
 */
import {
  characterVisible,
  canReadCharacter,
  companionFundsReadable,
  inParty,
  seatInParty,
} from "./character-position.ts";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import { projectRecord } from "./session-records.ts";
import { characterControl, type Purse } from "./types.ts";
import { npcController } from "./world.ts";

/**
 * Player projection on top of `projectRecord`. Owner decision (2026-10-22): other visible
 * party players' balances and ledger lines stay readable to party players, as before; a player
 * whose character is not with the party does not receive them. NPC, hidden-NPC,
 * exchange-treasury and non-party balances and ledger lines are never projected, and
 * purses the seat does not control never carry editing permissions. Owner decision (2026-10-22):
 * the DM may share party companion NPC funds with party players (off by default).
 */
/**
 * Which ledger lines a player's view holds (owner decision 2026-10-22, see `playerTable`): lines
 * of purses the seat controls (and delegated NPCs), and of party balances or shared companion
 * funds this seat may read. Also used for older ledger pages (`readCloudHistory`).
 */
export function playerLedgerLine(table: CloudTable, seat: CloudSeat) {
  const npcs = table.journal?.world?.npcs ?? [];
  const npcIds = new Set(npcs.map((n) => n.id));
  const controlled = new Set([
    ...seat.purseIds,
    ...npcs.filter((n) => npcController(n, seat)).map((n) => n.id),
  ]);
  const treasuries = new Set((table.journal?.tradeEconomy?.exchanges ?? []).map((e) => e.purseId));
  const partyPlayer = (p: Purse) =>
    characterVisible(table, p) &&
    !p.nonParty &&
    !npcIds.has(p.id) &&
    !treasuries.has(p.id) &&
    (p.kind === "party" || characterControl(p) === "player");
  const viewerInParty = seatInParty(table, seat);
  const byId = new Map(table.purses.map((p) => [p.id, p]));
  return (l: CloudTable["ledger"][number]) => {
    if (controlled.has(l.purseId)) return true;
    const p = byId.get(l.purseId);
    return !!p && ((viewerInParty && partyPlayer(p) && inParty(table, p)) || companionFundsReadable(table, p, seat));
  };
}
export function playerTable(table: CloudTable, record: CloudTable, seat: CloudSeat): CloudTable {
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
    ledger: table.ledger.filter(playerLedgerLine(table, seat)),
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
          attunementLimit: _attunementLimit,
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

/**
 * What `view()` sends a player seat as its table, computed from the whole campaign table (the
 * server's room table, or the DM's device copy of it). Map posters (the owner's account assets)
 * and quest receipts resolved over archived history pages are the server's only additions.
 */
export function seatView(
  table: CloudTable,
  seat: Pick<CloudSeat, "purseIds"> & Partial<Pick<CloudSeat, "id" | "token" | "name">>,
): CloudTable {
  const full: CloudSeat = { id: "", token: "", name: "", ...seat, role: "player" };
  const record = projectRecord({ ...table, journal: table.journal }, full, { directory: true });
  return playerTable(table, record, full);
}
