import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canManageMember,
  moderationDraftChanged,
  moderationErrorGuidance,
  staffActionPreview,
  type ModerationDraft,
} from "./staff-action-preview.ts";

test("consequence previews distinguish account restrictions from signout and restoration", () => {
  const ban = staffActionPreview("ban", "Synthetic member", "7", "member");
  assert.match(ban.summary, /for 7 days/);
  assert.match(ban.effects.join(" "), /linked campaign seats are blocked/);
  assert.match(ban.effects.join(" "), /sessions end.*push subscriptions are removed/);
  assert.match(ban.effects.join(" "), /expires automatically.*sign in again/);
  assert.match(ban.effects.join(" "), /records are retained.*guest play remains available/);
  assert.match(
    staffActionPreview("ban", "Member", "permanent", "member").effects.join(" "),
    /no automatic expiry/,
  );
  const signout = staffActionPreview("sessions", "Member", "7", "member").effects.join(" ");
  assert.match(signout, /does not revoke separate room access credentials/);
  assert.doesNotMatch(signout, /seats are blocked|subscriptions are removed/);
  const restore = staffActionPreview("restore", "Member", "7", "member").effects.join(" ");
  assert.match(restore, /otherwise valid|Otherwise valid/);
  assert.match(restore, /not reopened or reassigned/);
  assert.match(restore, /sessions.*subscriptions are not recreated/);
});

test("warning/profile/role previews preserve the actual scope and role-change requirements", () => {
  const warn = staffActionPreview("warn", "Member", "7", "member").effects.join(" ");
  assert.match(warn, /account notices/);
  assert.match(warn, /signed-in sessions.*stay unchanged/);
  const clear = staffActionPreview("clear-profile", "Member", "7", "member").effects.join(" ");
  assert.match(clear, /picture, introduction, and messaging email are cleared/);
  assert.match(clear, /display name, sign-in email.*remain unchanged/);
  const role = staffActionPreview("role", "Member", "7", "moderator").effects.join(" ");
  assert.match(role, /moderator site permissions/);
  assert.match(role, /sessions end.*bans or revocation are not lifted/);
  assert.match(role, /owner.*last ten minutes.*Ownership cannot be granted/);
  assert.match(
    staffActionPreview("role", "Member", "7", "member").effects[0]!,
    /Staff access is removed/,
  );
  assert.match(
    staffActionPreview("revoke", "Member", "7", "member").effects.join(" "),
    /until.*restores access/,
  );
});

test("self/owner/staff ceilings remain unchanged regardless of consequence presentation", () => {
  for (const actorRole of ["owner", "admin", "moderator", "member"] as const) {
    assert.equal(canManageMember("actor", actorRole, null), false);
    assert.equal(canManageMember("actor", actorRole, { id: "actor", role: "member" }), false);
    assert.equal(canManageMember("actor", actorRole, { id: "target", role: "owner" }), false);
    assert.equal(
      canManageMember("actor", actorRole, { id: "target", role: "admin" }),
      actorRole === "owner",
    );
    assert.equal(
      canManageMember("actor", actorRole, { id: "target", role: "moderator" }),
      actorRole === "owner",
    );
    assert.equal(
      canManageMember("actor", actorRole, { id: "target", role: "member" }),
      actorRole !== "member",
    );
  }
});

test("draft guards ignore inactive settings but protect reasons and active consequences", () => {
  const saved: ModerationDraft = { action: "warn", reason: "", days: "7", newRole: "member" };
  assert.equal(moderationDraftChanged({ ...saved }, saved), false);
  assert.equal(moderationDraftChanged({ ...saved, days: "30", newRole: "admin" }, saved), false);
  assert.equal(moderationDraftChanged({ ...saved, reason: "Keep this reason" }, saved), true);
  assert.equal(moderationDraftChanged({ ...saved, action: "ban" }, saved), true);
  assert.equal(
    moderationDraftChanged({ ...saved, action: "ban", days: "30" }, { ...saved, action: "ban" }),
    true,
  );
  assert.equal(
    moderationDraftChanged(
      { ...saved, action: "role", newRole: "moderator" },
      { ...saved, action: "role" },
    ),
    true,
  );
  assert.match(
    moderationErrorGuidance("This member changed. Refresh the list before trying again."),
    /reason are still here.*refresh members/,
  );
  assert.match(
    moderationErrorGuidance("Sign out and sign in again before changing staff roles."),
    /Copy your reason/,
  );
  assert.equal(moderationErrorGuidance("The account service is unavailable."), "");
});
