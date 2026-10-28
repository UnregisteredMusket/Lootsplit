/**
 * Per-device conveniences for joining a room (plan P3, Q15, Q16). Browser storage only: a missing
 * or blocked store simply means no remembered name and no tip strip.
 */
const NAME = "lootsplit.join.name.v1";
const TIPS = "lootsplit.join.tips.v1";
const TIPS_DISMISSED = "lootsplit.join.tips.dismissed.v1";

export function recalledJoinName(): string {
  try {
    return (localStorage.getItem(NAME) || "").slice(0, 80);
  } catch {
    return "";
  }
}

export function rememberJoinName(name: string) {
  try {
    if (name.trim()) localStorage.setItem(NAME, name.trim().slice(0, 80));
  } catch {
    // Blocked storage: the name is asked again next time.
  }
}

/** After a join, Home shows the three-tip strip once until it is dismissed. */
export function offerJoinTips() {
  try {
    if (localStorage.getItem(TIPS_DISMISSED) !== "1") sessionStorage.setItem(TIPS, "1");
  } catch {
    // No strip without storage.
  }
}

export function joinTipsOffered(): boolean {
  try {
    return sessionStorage.getItem(TIPS) === "1" && localStorage.getItem(TIPS_DISMISSED) !== "1";
  } catch {
    return false;
  }
}

export function dismissJoinTips() {
  try {
    sessionStorage.removeItem(TIPS);
    localStorage.setItem(TIPS_DISMISSED, "1");
  } catch {
    // Dismissed for this view only.
  }
}
