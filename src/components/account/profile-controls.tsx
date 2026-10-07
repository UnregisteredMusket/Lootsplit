import { useState, type FormEvent } from "react";
import { accountRequest, type MemberProfile } from "@/lib/account/client";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";

function editableProfile(
  profile:
    | MemberProfile
    | (Omit<MemberProfile, "share_contact" | "email_opt_in"> & {
        share_contact: boolean;
        email_opt_in: boolean;
      }),
) {
  return {
    name: profile.name,
    introduction: profile.introduction,
    portrait: profile.portrait,
    contact_email: profile.contact_email,
    share_contact: !!profile.share_contact,
    email_opt_in: !!profile.email_opt_in,
  };
}
export function ProfileControls({
  profile,
  onSaved,
}: {
  profile: MemberProfile;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    ...profile,
    share_contact: !!profile.share_contact,
    email_opt_in: !!profile.email_opt_in,
  });
  const [saved, setSaved] = useState(editableProfile(profile));
  useDraftGuard(JSON.stringify(editableProfile(draft)) !== JSON.stringify(saved), "profile");
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await accountRequest<MemberProfile>("profile", draft);
      setDraft({ ...next, share_contact: !!next.share_contact, email_opt_in: !!next.email_opt_in });
      setSaved(editableProfile(next));
      await onSaved();
      setNotice("Profile saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save profile.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="portal-card">
      <p className="portal-eyebrow">YOUR MEMBER PROFILE</p>
      <h2>Profile & preferences</h2>
      <p>
        Member since: {new Date(profile.member_since).toLocaleDateString()} · Last Online:{" "}
        {profile.last_online ? new Date(profile.last_online).toLocaleString() : "Not recorded yet"}
      </p>
      <p className="portal-subtle">
        Profile details are visible to site staff. Your sign-in email stays private to account
        administration. A messaging email opens your email app; Lootsplit does not send messages
        from it.
      </p>
      {error && (
        <p role="alert" className="portal-message error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="portal-message">
          {notice}
        </p>
      )}
      <form className="owner-form" onSubmit={save}>
        <fieldset disabled={busy}>
          {draft.portrait && (
            <img className="member-avatar" src={draft.portrait} alt="Your profile" />
          )}
          <label>
            Profile picture
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (
                  file.size > 350000 ||
                  !["image/png", "image/jpeg", "image/webp"].includes(file.type)
                ) {
                  setError("Choose a PNG, JPEG or WebP below 350 KB.");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => setDraft((d) => ({ ...d, portrait: String(reader.result) }));
                reader.readAsDataURL(file);
              }}
            />
          </label>
          <button
            className="portal-button secondary"
            type="button"
            onClick={() => setDraft({ ...draft, portrait: "" })}
          >
            Remove picture
          </button>
          <label>
            Display name
            <input
              value={draft.name}
              required
              maxLength={80}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Introduction
            <textarea
              aria-label="Introduction"
              rows={4}
              maxLength={2000}
              value={draft.introduction}
              onChange={(e) => setDraft({ ...draft, introduction: e.target.value })}
            />
          </label>
          <label>
            Messaging email
            <input
              type="email"
              maxLength={254}
              value={draft.contact_email}
              onChange={(e) => setDraft({ ...draft, contact_email: e.target.value })}
            />
          </label>
          <label className="portal-check">
            <input
              type="checkbox"
              checked={draft.share_contact}
              onChange={(e) => setDraft({ ...draft, share_contact: e.target.checked })}
            />
            Show my messaging email to moderators as well as administrators
          </label>
          <label className="portal-check">
            <input
              type="checkbox"
              checked={draft.email_opt_in}
              onChange={(e) => setDraft({ ...draft, email_opt_in: e.target.checked })}
            />
            I’d like email announcements and release updates
          </label>
          <p className="portal-subtle">
            Email delivery is not enabled yet. This saves your preference only; you can opt out here
            at any time.
          </p>
          <button className="portal-button" type="submit">
            Save member profile
          </button>
        </fieldset>
      </form>
    </section>
  );
}
