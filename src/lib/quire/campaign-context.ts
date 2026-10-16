const ACTIVE = "quire.campaign.v1";
const WINDOW_ACTIVE = "lootsplit.window.campaign.v1";

/** Each app window keeps its own campaign; localStorage remains the legacy default. */
export function activeCampaignId(): string {
  if (typeof localStorage === "undefined") return "main";
  let pinned: string | null = null;
  try {
    if (typeof sessionStorage !== "undefined") pinned = sessionStorage.getItem(WINDOW_ACTIVE);
  } catch {
    /* Use the existing device selection when per-tab storage is blocked. */
  }
  if (pinned) return pinned;
  try {
    return localStorage.getItem(ACTIVE) || "main";
  } catch {
    return "main";
  }
}

/** Called by the access gate before campaign providers can open their databases. */
export function pinCampaignContext() {
  const id = activeCampaignId();
  try {
    sessionStorage.setItem(WINDOW_ACTIVE, id);
  } catch {
    /* Legacy single-window storage remains available. */
  }
  return id;
}

export function selectWindowCampaign(id: string) {
  localStorage.setItem(ACTIVE, id);
  try {
    sessionStorage.setItem(WINDOW_ACTIVE, id);
  } catch {
    /* Preserve the existing device selection. */
  }
}

export function prepareWindowContext(storage: Pick<Storage, "setItem">) {
  storage.setItem(WINDOW_ACTIVE, activeCampaignId());
}
