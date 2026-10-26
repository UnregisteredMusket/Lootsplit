import { campaignDisplayName } from "../quire/campaign-name";
import { reloadCampaignContext } from "../quire/navigation-launch.ts";
import { getCampaigns, createCampaign } from "../quire/campaigns";
import { getSeat } from "../quire/table";
import { loadSeatLock } from "../quire/lock";
import {
  captureDeviceBackup,
  getCloudTable,
  hasPendingChanges,
  prepareAccountMembership,
  resumeAccountMembership,
} from "../quire/cloud-client";
import {
  readQuireFile,
  restore,
  ensureEconomy,
  blankPurse,
  savePurse,
  type QuireFile,
} from "../quire/economy";
import { accountRequest, type AccountMembership, type CharacterProfile } from "./client";
import { accountRestoreRequest, acknowledgeAccountRestore } from "./restore-request";
import { saveAccountMapAsset, hydrateAccountMapBackup } from "./map-media";
export async function saveAccountBackup() {
  if (getSeat().role !== "dm")
    throw new Error(
      "Only the DM can save a complete campaign backup. Players can save their campaign membership.",
    );
  if ((await loadSeatLock())?.protectSaves)
    throw new Error(
      "This campaign requires encrypted backups. Use its existing password-protected device backup tools.",
    );
  const file = await captureDeviceBackup();
  for (const asset of file.mapAssets ?? []) await saveAccountMapAsset(asset);
  const state = getCampaigns();
  // PDFs and extracted reference content are device-local. Never upload them implicitly.
  const payload = {
    ...file,
    mapAssets: undefined,
    books: [],
    articles: [],
    lexicon: [],
    catalog: file.catalog?.filter((row) => row.origin !== "pdf"),
  };
  await accountRequest("backup", {
    name: state.campaigns.find((c) => c.id === state.activeId)?.name || "Campaign",
    payload,
  });
}
export async function linkCurrentCampaign() {
  const credentials = await prepareAccountMembership();
  const state = getCampaigns();
  const cloud = getCloudTable();
  // A player's library entry takes the DM's campaign name (or "Shared campaign · CODE"),
  // never this device's default name.
  const name = campaignDisplayName({
    deviceName: state.campaigns.find((c) => c.id === state.activeId)?.name,
    joined: cloud.joined,
    role: cloud.role,
    code: cloud.code,
    roomName: cloud.campaignName,
  });
  await accountRequest("link", { ...credentials, name });
}
export async function restoreAccountBackup(id: string, name: string) {
  if (getCloudTable().joined || hasPendingChanges() || getSeat().role !== "dm")
    throw new Error(
      "Open a local DM campaign before restoring a backup. Your current campaign will be kept.",
    );
  const { payload } = await accountRequest<{ payload: QuireFile }>("read-backup", { id });
  const file = readQuireFile(await hydrateAccountMapBackup(payload));
  createCampaign(`${name} (restored)`);
  await ensureEconomy();
  await restore(file);
  reloadCampaignContext();
}
export async function restoreSharedAccountBackup(id: string) {
  if (getCloudTable().joined || hasPendingChanges() || getSeat().role !== "dm")
    throw new Error(
      "Open a local DM campaign before restoring shared records. Your current campaign will be kept.",
    );
  const userId = sessionStorage.getItem("lootsplit.verified-account") || "";
  const requestKey = accountRestoreRequest(userId, id);
  const membership = await accountRequest<AccountMembership>("restore-backup", { id, requestKey });
  await resumeAccountMembership(membership);
  acknowledgeAccountRestore(userId, id, requestKey);
}
export async function addAccountCharacter(profile: CharacterProfile) {
  if (getCloudTable().joined || getSeat().role !== "dm")
    throw new Error("Open a local DM campaign to add this character.");
  const purse = blankPurse("character");
  await savePurse({
    ...purse,
    name: profile.name,
    ...(profile.portrait ? { portrait: profile.portrait } : {}),
  });
}
