/**
 * My account shows one section at a time (design plan P9). Every older `/account#<anchor>` link
 * keeps working: the anchor picks the section that contains it, then scrolls to it.
 */
export type AccountTab =
  "campaigns" | "characters" | "profile" | "backups" | "support" | "administration";

export type AccountSiteRole = "member" | "moderator" | "admin" | "owner" | string;

export const ACCOUNT_TAB_LABELS: Record<AccountTab, string> = {
  campaigns: "Campaigns",
  characters: "Characters",
  profile: "Profile",
  backups: "Backups",
  support: "Support",
  administration: "Administration",
};

/** The anchor each section writes to the address bar; every one of them is an element id. */
export const ACCOUNT_TAB_ANCHORS: Record<AccountTab, string> = {
  campaigns: "account-campaigns",
  characters: "account-characters",
  profile: "account-profile",
  backups: "account-backups",
  support: "account-support",
  administration: "account-administration",
};

/** Staff sections appear only for staff roles; the server still authorizes every staff request. */
export function accountTabs(role: AccountSiteRole | undefined): AccountTab[] {
  const tabs: AccountTab[] = ["campaigns", "characters", "profile", "backups", "support"];
  return role && role !== "member" ? [...tabs, "administration"] : tabs;
}

const ANCHOR_TABS: Record<string, AccountTab> = {
  "account-campaigns": "campaigns",
  "account-device-campaigns": "campaigns",
  "account-encounters": "campaigns",
  "account-characters": "characters",
  "account-reusable-profiles": "characters",
  "account-profile": "profile",
  "account-community": "profile",
  "account-recovery": "profile",
  "account-backups": "backups",
  "account-reports": "backups",
  "account-support": "support",
  "bug-reports": "support",
  "account-administration": "administration",
  "account-member-management": "administration",
  "home-screen-widget": "administration",
  "field-monitor": "administration",
};

/**
 * The section an `/account#…` link opens, or null when the hash names no section (the page then
 * keeps the current one). Field monitor (`#field-*`, `#owner-*`) and monitor history links
 * (`#monitor-*`, including widget count chips) live in Administration. A hash for a section this
 * account cannot see falls back to Campaigns.
 */
export function accountTabForHash(
  hash: string,
  role: AccountSiteRole | undefined,
): AccountTab | null {
  const id = decodeURIComponent(hash.replace(/^#/, "")).trim();
  if (!id) return null;
  const tab: AccountTab | null =
    ANCHOR_TABS[id] ??
    (/^(monitor|field|owner|staff|community-reports)-/.test(id) ? "administration" : null);
  if (!tab) return null;
  return accountTabs(role).includes(tab) ? tab : "campaigns";
}

type Membership = { role: "dm" | "player" | null };

/**
 * DM-only parts of My account (the hosting allowance, DM encounters) are for accounts that run a
 * campaign. A new account with no memberships yet may be about to start one, so it still sees
 * them; an account whose memberships are all player seats does not. The site owner keeps the
 * exempt allowance line.
 */
export function accountRunsCampaigns(
  members: readonly Membership[],
  role: AccountSiteRole | undefined,
): boolean {
  return role === "owner" || !members.length || members.some((m) => m.role === "dm");
}
