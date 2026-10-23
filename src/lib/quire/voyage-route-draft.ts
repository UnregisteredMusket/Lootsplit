import type { ShipVoyage } from "./ships-schema.ts";

/**
 * A voyage route drawn on the map, handed to that ship's existing voyage form ("Use in voyage
 * request"). In memory only: it is a draft of the form's inputs, never campaign data, and the
 * form still submits the unchanged `ship-voyage` command with all of its checks.
 */
export type VoyageRouteDraft = {
  propertyId: string;
  destinationId: string;
  mapRoute: NonNullable<ShipVoyage["mapRoute"]>;
  /** The typed "column,row; column,row" field (intermediate tiles, 1-based). */
  waypoints: string;
};
let draft: VoyageRouteDraft | undefined;
export function setVoyageRouteDraft(next: VoyageRouteDraft | undefined) {
  draft = next;
}
/** The draft for this ship, if any (kept until the form submits or another route replaces it). */
export function voyageRouteDraft(propertyId: string): VoyageRouteDraft | undefined {
  return draft?.propertyId === propertyId ? draft : undefined;
}
