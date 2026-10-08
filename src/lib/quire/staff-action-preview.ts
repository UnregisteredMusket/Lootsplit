import type { SiteRole } from "../account/client.ts";

export type StaffAction =
  "warn" | "ban" | "revoke" | "restore" | "sessions" | "clear-profile" | "role";
export type ModerationDraft = {
  action: StaffAction;
  reason: string;
  days: string;
  newRole: Exclude<SiteRole, "owner">;
};

export function canManageMember(
  userId: string,
  role: SiteRole,
  selected: { id: string; role: SiteRole } | null,
) {
  return (
    !!selected &&
    ["owner", "admin", "moderator"].includes(role) &&
    selected.id !== userId &&
    selected.role !== "owner" &&
    (role === "owner" || selected.role === "member")
  );
}

/** Hidden duration/role fields do not turn an untouched warning into a draft. */
export function moderationDraftChanged(draft: ModerationDraft, saved: ModerationDraft) {
  return (
    draft.action !== saved.action ||
    draft.reason !== saved.reason ||
    (draft.action === "ban" && draft.days !== saved.days) ||
    (draft.action === "role" && draft.newRole !== saved.newRole)
  );
}

/** Copy mirrors the existing moderation operation; it grants no additional powers. */
export function staffActionPreview(
  action: StaffAction,
  name: string,
  days: string,
  newRole: string,
) {
  switch (action) {
    case "warn":
      return {
        summary: `Issue a warning to ${name}.`,
        effects: [
          "The warning and reason appear in the member's account notices and moderation history.",
          "Account access, signed-in sessions, and campaign permissions stay unchanged.",
        ],
      };
    case "ban":
      return {
        summary: `Ban ${name} ${days === "permanent" ? "permanently" : `for ${days} day${days === "1" ? "" : "s"}`}.`,
        effects: [
          "Account access and linked campaign seats are blocked. All account sessions end and linked push subscriptions are removed.",
          days === "permanent"
            ? "This ban has no automatic expiry; an authorized administrator must restore access."
            : "The ban expires automatically. The member must sign in again; only otherwise valid campaign seats can be resumed.",
          "Account and campaign records are retained. This is an account restriction; anonymous guest play remains available.",
        ],
      };
    case "revoke":
      return {
        summary: `Revoke account access for ${name}.`,
        effects: [
          "Account access and linked campaign seats are blocked until an authorized administrator restores access.",
          "All account sessions end and linked push subscriptions are removed. Account and campaign records are retained.",
          "This is an account restriction; anonymous guest play remains available.",
        ],
      };
    case "restore":
      return {
        summary: `Restore account access for ${name}.`,
        effects: [
          "The account becomes active and can sign in again. Otherwise valid linked campaign seats become accessible.",
          "Closed rooms and dismissed character assignments are not reopened or reassigned. Ended account sessions and removed push subscriptions are not recreated.",
        ],
      };
    case "sessions":
      return {
        summary: `Sign out all account sessions for ${name}.`,
        effects: [
          "Every signed-in account session ends; the member must sign in again for account features.",
          "Account status, saved data, and campaign assignments remain unchanged. This action does not revoke separate room access credentials.",
        ],
      };
    case "clear-profile":
      return {
        summary: `Clear profile content for ${name}.`,
        effects: [
          "The profile picture, introduction, and messaging email are cleared; sharing the messaging email is turned off.",
          "The display name, sign-in email, account access, and campaign records remain unchanged. Account sessions stay signed in.",
        ],
      };
    case "role":
      return {
        summary: `Set ${name}'s site role to ${newRole}.`,
        effects: [
          newRole === "member"
            ? "Staff access is removed. Campaign DM/player assignments are separate and remain unchanged."
            : `The account receives ${newRole} site permissions. Campaign DM/player assignments are separate and remain unchanged.`,
          "All target account sessions end. Existing account bans or revocation are not lifted.",
          "Only the site owner can change staff roles and must have signed in within the last ten minutes. Ownership cannot be granted here.",
        ],
      };
  }
}

export function moderationErrorGuidance(message: string) {
  if (/member changed|current member revision/i.test(message))
    return "Your action and reason are still here. Use Search / refresh members with this member in the results to get the current revision before reviewing and trying again.";
  if (/sign out and sign in again.*staff roles/i.test(message))
    return "Changing roles needs a recent sign-in. Copy your reason before signing out, then sign in and review the member again.";
  return "";
}
