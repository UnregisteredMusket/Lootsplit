import { accountRequest } from "../account/client";
import { characterSheet } from "./campaign-sheet.mjs";
import { economySnapshot, saveCampaignCharacter } from "../quire/economy";
import { getSeat } from "../quire/table";
import { getCloudTable, queueCommand } from "../quire/cloud-client";
import { announceSheetChange } from "../quire/party-sheet-links";
import type { PlaySheet } from "./model.mjs";

export async function characterRequest<T>(
  path: string,
  payload?: any,
  signal?: AbortSignal,
): Promise<T> {
  if (
    !payload?.id ||
    (path === "sheets/assign" && !payload.id.startsWith("party:")) ||
    (getCloudTable().joined && !payload.id.startsWith("party:"))
  )
    return accountRequest<T>(path, payload, signal);
  const table = await economySnapshot(),
    seat = getSeat();
  const linked = table.purses.find((p) => p.profileId === payload.id);
  if (!payload.id.startsWith("party:") && !linked) return accountRequest<T>(path, payload, signal);
  const purseId = linked?.id || payload.id.slice(6);
  payload = { ...payload, id: `party:${purseId}` };
  const p = table.purses.find((p) => p.id === purseId && p.kind === "character");
  if (!p || (seat.role !== "dm" && !seat.purseIds.includes(purseId)))
    throw Error("This character is not controlled by your campaign seat.");
  const body = characterSheet(
    p,
    table.holdings,
    table.sheets.find((s) => s.purseId === p.id),
  );
  if (path === "sheets/detail") {
    const room = getCloudTable();
    const policy = room.joined
      ? await (await import("../quire/cloud-client")).requestCampaignRoll({ purseId, policy: true })
      : { manualAllowed: true };
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
      editable: seat.role !== "dm" || !p.sheetReadOnlyForDm,
      assignmentError: "",
      campaign_code: room.joined ? room.code : "",
      purse_id: p.id,
      campaign: {
        code: getCloudTable().code,
        role: seat.role,
        editingAllowed: seat.role === "dm" || p.editingAllowed === true,
        permissions: p.permissions || {},
        manualAllowed: policy.manualAllowed,
        coins: body.coins,
        holdings: table.holdings.filter((h) => h.purseId === p.id),
      },
    } as T;
  }
  if (path === "sheets/save") {
    const input = {
      purseId,
      before: payload.before as PlaySheet,
      sheet: payload.sheet as PlaySheet,
    };
    if (getCloudTable().joined) await queueCommand({ kind: "character", ...input });
    else await saveCampaignCharacter(input);
    announceSheetChange();
    return { id: payload.id } as T;
  }
  if (path === "sheets/roll" || path === "sheets/log") {
    const { campaignRollRequest } = await import("../quire/character-roll-client");
    return campaignRollRequest(path, payload) as Promise<T>;
  }
  throw Error("This character already belongs to the current campaign.");
}
