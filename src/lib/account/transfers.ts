import { reloadCampaignContext } from "../quire/navigation-launch.ts";
import { getCampaigns, createCampaign } from "../quire/campaigns";
import { getSeat } from "../quire/table";
import { loadSeatLock } from "../quire/lock";
import {
  captureDeviceBackup,
  getCloudTable,
  hasPendingChanges,
  prepareAccountMembership,
} from "../quire/cloud-client";
import {
  readQuireFile,
  restore,
  ensureEconomy,
  blankPurse,
  savePurse,
  type QuireFile,
} from "../quire/economy";
import { accountRequest, type CharacterProfile } from "./client";
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
  const state = getCampaigns();
  // PDFs and extracted reference content are device-local. Never upload them implicitly.
  const payload = {
    ...file,
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
  await accountRequest("link", {
    ...credentials,
    name: state.campaigns.find((c) => c.id === state.activeId)?.name || "Campaign",
  });
}
export async function restoreAccountBackup(id: string, name: string) {
  if (getCloudTable().joined || hasPendingChanges() || getSeat().role !== "dm")
    throw new Error(
      "Open a local DM campaign before restoring a backup. Your current campaign will be kept.",
    );
  const { payload } = await accountRequest<{ payload: QuireFile }>("read-backup", { id });
  const file = readQuireFile(payload);
  createCampaign(`${name} (restored)`);
  await ensureEconomy();
  await restore(file);
  reloadCampaignContext();
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
