import { canReadCharacter } from "../quire/character-position";
import { accountRequest } from "../account/client";
import { characterSheet } from "./campaign-sheet.mjs";
import { economySnapshot, saveCampaignCharacter } from "../quire/economy";
import { getSeat } from "../quire/table";
import {
  getCloudTable,
  queueCommand,
  captureMutationScope,
  assertMutationScope,
} from "../quire/cloud-client";
import { announceSheetChange } from "../quire/party-sheet-links";
import type { PlaySheet } from "./model.mjs";

export async function characterRequest<T>(
  path: string,
  payload?: any,
  signal?: AbortSignal,
): Promise<T> {
  const scope = path === "sheets/save" ? captureMutationScope() : undefined;
  const joinedAtStart = getCloudTable().joined;
  if (
    !payload?.id ||
    (path === "sheets/assign" && !payload.id.startsWith("party:")) ||
    (getCloudTable().joined && !payload.id.startsWith("party:"))
  )
    return accountRequest<T>(path, payload, signal);
  const table = await economySnapshot();
  if (scope) assertMutationScope(scope);
  const seat = getSeat();
  const linked = table.purses.find((p) => p.profileId === payload.id);
  if (!payload.id.startsWith("party:") && !linked) return accountRequest<T>(path, payload, signal);
  const purseId = linked?.id || payload.id.slice(6);
  payload = { ...payload, id: `party:${purseId}` };
  const p = table.purses.find((p) => p.id === purseId && p.kind === "character");
  if (!p || !canReadCharacter(table, p, seat))
    throw Error("This character is not controlled by your campaign seat.");
  const body = characterSheet(
    p,
    table.holdings,
    table.sheets.find((s) => s.purseId === p.id),
  );
  if (path === "sheets/detail") {
    const room = getCloudTable();
    const observer = seat.role !== "dm" && !seat.purseIds.includes(p.id);
    const policy =
      room.joined && !observer
        ? await (
            await import("../quire/cloud-client")
          ).requestCampaignRoll({ purseId, policy: true })
        : { manualAllowed: !observer };
    const profile = linked
      ? await accountRequest<{ revision: number }>(
          "sheets/detail",
          { id: linked.profileId },
          signal,
        )
      : null;
    return {
      assignmentRevision: profile?.revision,
      id: payload.id,
      body,
      revision: p.sheetRevision || 0,
      editable: !observer && (seat.role !== "dm" || !p.sheetReadOnlyForDm),
      assignmentError: "",
      campaign_code: room.joined ? room.code : "",
      purse_id: p.id,
      campaign: {
        code: getCloudTable().code,
        role: seat.role,
        editingAllowed: !observer && (seat.role === "dm" || p.editingAllowed === true),
        permissions: p.permissions || {},
        manualAllowed: policy.manualAllowed,
        coins: body.coins,
        holdings: table.holdings.filter((h) => h.purseId === p.id),
      },
    } as T;
  }
  if (path === "sheets/save") {
    if (seat.role !== "dm" && !seat.purseIds.includes(p.id))
      throw Error("Only the DM can edit this NPC sheet.");
    const input = {
      purseId,
      before: payload.before as PlaySheet,
      sheet: payload.sheet as PlaySheet,
    };
    let outcome: { status: "committed" | "pending" } = { status: "committed" };
    if (joinedAtStart) outcome = await queueCommand({ kind: "character", ...input }, scope);
    else
      await saveCampaignCharacter(input, () => {
        if (scope) assertMutationScope(scope);
      });
    announceSheetChange();
    return { id: payload.id, ...outcome } as T;
  }
  if (path === "sheets/roll" || path === "sheets/log") {
    if (seat.role !== "dm" && !seat.purseIds.includes(p.id)) {
      if (path === "sheets/log") return { rolls: [], more: false } as T;
      throw Error("Only the DM can roll for this NPC.");
    }
    const { campaignRollRequest } = await import("../quire/character-roll-client");
    return campaignRollRequest(path, payload) as Promise<T>;
  }
  throw Error("This character already belongs to the current campaign.");
}
