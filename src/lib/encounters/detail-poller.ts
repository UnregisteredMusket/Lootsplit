import { createSharedPoller } from "../quire/visible-poll";
import { encounterRequest } from "./client";

/**
 * The page's one `encounters/detail` poll per encounter (audit 2026-10-28 F4): the DM's TV
 * display controller, the map Initiative panel and the device-campaign combat HUD share it, and
 * it pauses while the tab is hidden unless a launched display still needs updates.
 */
export const encounterDetailPoller = createSharedPoller((id) =>
  encounterRequest<unknown>("encounters/detail", { id }),
);
