import type { MapCombatBinding } from "../quire/map-combat-schema.ts";
export type MapEncounterDetail = {
  id: string;
  code: string;
  revision: number;
  status: string;
  readOnly?: boolean;
  body: { name: string; round: number; activeId: string };
};
/** Two canonical stores, with a durable prepared binding before this function.
 * Readback resolves lost responses; the same encounter is never recreated. */
export async function finishMapEncounter(
  binding: MapCombatBinding,
  code: string,
  operations: {
    read: () => Promise<MapEncounterDetail>;
    start: (revision: number) => Promise<unknown>;
    activate: () => Promise<void>;
    guard: () => void;
  },
) {
  async function read() {
    const detail = await operations.read();
    operations.guard();
    if (detail.id !== binding.encounterId || detail.code !== code || detail.readOnly)
      throw Error("This encounter is not writable in the current campaign.");
    return detail;
  }
  let detail = await read();
  if (detail.status === "draft") {
    if (detail.revision !== binding.encounterRevision)
      throw Error(
        "The encounter changed after review. Cancel this prepared transition and review it again.",
      );
    try {
      await operations.start(detail.revision);
    } catch (error) {
      const confirmed = await read();
      if (confirmed.status !== "active") throw error;
    }
    detail = await read();
  }
  if (detail.status !== "active")
    throw Error("This encounter is already concluded. Review its loot or return to exploration.");
  await operations.activate();
  operations.guard();
  return detail;
}
