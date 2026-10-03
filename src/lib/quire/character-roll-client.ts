import { quireDb, request } from "./db";
import { getCloudTable, requestCampaignRoll } from "./cloud-client";
import { getSeat } from "./table";
import { characterSheet } from "../characters/campaign-sheet.mjs";
import { makeCampaignRoll } from "../characters/campaign-roll.mjs";
import type { Purse, Holding } from "./types";
export async function campaignRollRequest(path: string, body: any): Promise<any> {
  const purseId = body.id.slice(6);
  if (getCloudTable().joined)
    return requestCampaignRoll({ ...body, purseId, log: path === "sheets/log" });
  const db = await quireDb();
  const tx = db.transaction(["purses", "holdings"], "readwrite");
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || Error("Roll could not be saved."));
  });
  try {
    const p = await request<Purse | undefined>(tx.objectStore("purses").get(purseId));
    const seat = getSeat();
    if (!p || (seat.role !== "dm" && !seat.purseIds.includes(purseId)))
      throw Error("You do not control this character.");
    const rolls = p.rolls || [];
    if (path === "sheets/log") {
      await done;
      const filtered = rolls.filter((r) => r.seq < (body.before || Infinity)).reverse();
      return { rolls: filtered.slice(0, 50), more: filtered.length > 50 };
    }
    const prior = rolls.find((r) => r.id === body.requestKey);
    if (prior) {
      await done;
      return prior;
    }
    if ((p.sheetRevision || 0) !== body.revision)
      throw Error("Reload your character before rolling.");
    const holdings = await request<Holding[]>(tx.objectStore("holdings").getAll());
    const roll = {
      ...makeCampaignRoll(characterSheet(p, holdings), body, p.name, p.id, "device", true),
      seq: rolls.length + 1,
      at: Date.now(),
    };
    tx.objectStore("purses").put({ ...p, rolls: [...rolls, roll] });
    await done;
    return roll;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already committed or aborted. */
    }
    await done.catch(() => {});
    throw error;
  }
}
