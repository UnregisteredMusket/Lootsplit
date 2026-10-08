import { useEffect, useState, type FormEvent } from "react";
import { accountRequest, type MemberProfile, type SiteRole } from "@/lib/account/client";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import {
  canManageMember,
  moderationDraftChanged,
  moderationErrorGuidance,
  staffActionPreview,
  type ModerationDraft,
  type StaffAction,
} from "@/lib/quire/staff-action-preview";
import "./account-admin.css";
type Member = {
  id: string;
  name: string;
  email: string;
  member_since: string | number;
  last_online: number | null;
  role: SiteRole;
  status: string;
  ban_until: number | null;
  reason: string;
  revision: number;
};
type List = { members: Member[]; total: number; offset: number; role: SiteRole };
type Detail = {
  profile: MemberProfile;
  history: { action: string; reason: string; created_at: number; actor: string; details: string }[];
};
export function StaffControls({ userId, role }: { userId: string; role: SiteRole }) {
  const [list, setList] = useState<List | null>(null),
    [q, setQ] = useState(""),
    [filter, setFilter] = useState("all"),
    [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Member | null>(null),
    [detail, setDetail] = useState<Detail | null>(null);
  const [action, setAction] = useState<StaffAction>("warn"),
    [reason, setReason] = useState(""),
    [days, setDays] = useState("7"),
    [newRole, setNewRole] = useState<ModerationDraft["newRole"]>("member");
  const [savedDraft, setSavedDraft] = useState<ModerationDraft>({
    action: "warn",
    reason: "",
    days: "7",
    newRole: "member",
  });
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const canManage = canManageMember(userId, role, selected);
  const dirty =
    !!selected &&
    canManage &&
    moderationDraftChanged({ action, reason, days, newRole }, savedDraft);
  useDraftGuard(dirty, "moderation action and reason");
  const preview = selected ? staffActionPreview(action, selected.name, days, newRole) : null;
  const guidance = moderationErrorGuidance(error);
  async function load(next = offset) {
    const data = await accountRequest<List>(
      `staff/members?q=${encodeURIComponent(q)}&status=${filter}&offset=${next}`,
    );
    setList(data);
    setOffset(next);
    // A refresh reconciles the target revision without discarding the action/reason draft.
    setSelected((current) =>
      current ? data.members.find((m) => m.id === current.id) || current : null,
    );
  }
  useEffect(() => {
    void load(0).catch((e) => setError(e.message));
  }, []);
  async function inspect(m: Member) {
    if (busy) return;
    const sameMember = selected?.id === m.id;
    if (
      !sameMember &&
      dirty &&
      !window.confirm(
        "Discard the unsaved moderation action and reason before managing another member?",
      )
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    setSelected(m);
    setDetail(null);
    if (!sameMember) {
      const nextRole = m.role === "owner" ? "member" : m.role;
      setAction("warn");
      setReason("");
      setNewRole(nextRole);
      setSavedDraft({ action: "warn", reason: "", days, newRole: nextRole });
    }
    try {
      setDetail(await accountRequest<Detail>("staff/member", { id: m.id }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected || busy || !detail || !canManage || !preview || !reason.trim()) return;
    const until = days === "permanent" ? null : Date.now() + Number(days) * 86400000;
    const expiry =
      action === "ban" && until !== null
        ? `\nScheduled expiry: ${new Date(until).toLocaleString()}.`
        : "";
    if (
      !window.confirm(
        `${preview.summary}\n\n${preview.effects.join("\n")}${expiry}\n\nThis action and reason are recorded in the moderation log. Apply this member action?`,
      )
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await accountRequest("staff/action", {
        id: selected.id,
        revision: selected.revision,
        action,
        reason,
        role: newRole,
        until,
      });
      setSelected(null);
      setDetail(null);
      setReason("");
      setNotice("Member action saved.");
      try {
        await load();
      } catch (refreshError) {
        setError(
          `The action was saved, but the member list could not refresh. ${refreshError instanceof Error ? refreshError.message : "Use Search / refresh members to try again."}`,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="portal-card staff-controls">
      <p className="portal-eyebrow">{role.toUpperCase()} WORKSPACE</p>
      <h2>Member management</h2>
      <p>
        Search current members, review profiles and history, and manage account access. Revocation
        disables access while retaining data. Temporary bans expire automatically. Account
        restrictions also apply to linked campaign seats; anonymous guest play remains available.
      </p>
      {error && (
        <p role="alert" className="portal-message error">
          {error}
        </p>
      )}
      {guidance && <p className="portal-subtle">{guidance}</p>}
      {notice && (
        <p role="status" className="portal-message">
          {notice}
        </p>
      )}
      <form
        className="owner-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          void load(0)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Search members
          <input value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label>
          Account status
          <select
            aria-label="Account status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All accounts</option>
            <option value="active">Active</option>
            <option value="banned">Banned</option>
            <option value="revoked">Revoked</option>
          </select>
        </label>
        <button className="portal-button secondary" disabled={busy}>
          Search / refresh members
        </button>
      </form>
      {list && (
        <>
          <p>
            {list.total} members · Showing {list.total ? offset + 1 : 0}–
            {Math.min(offset + 30, list.total)}
          </p>
          <div className="member-list">
            {list.members.map((m) => (
              <article key={m.id} className="member-row">
                <div>
                  <h3>{m.name}</h3>
                  <p>{m.email}</p>
                  <p>
                    {m.role} · {m.status}
                    {m.status === "banned" &&
                      (m.ban_until
                        ? ` until ${new Date(m.ban_until).toLocaleString()}`
                        : " permanently")}
                  </p>
                  <p className="portal-subtle">
                    Member since: {new Date(m.member_since).toLocaleDateString()}
                    <br />
                    Last Online:{" "}
                    {m.last_online ? new Date(m.last_online).toLocaleString() : "Not recorded yet"}
                  </p>
                </div>
                <button
                  className="portal-button secondary"
                  disabled={busy}
                  onClick={() => void inspect(m)}
                >
                  Manage {m.name}
                </button>
              </article>
            ))}
          </div>
          <div className="portal-actions">
            <button
              className="portal-button secondary"
              disabled={busy || !offset}
              onClick={() => void load(offset - 30).catch((e) => setError(e.message))}
            >
              Previous members
            </button>
            <button
              className="portal-button secondary"
              disabled={busy || offset + 30 >= list.total}
              onClick={() => void load(offset + 30).catch((e) => setError(e.message))}
            >
              Next members
            </button>
          </div>
        </>
      )}
      {selected && (
        <section className="staff-detail">
          <h3>Manage {selected.name}</h3>
          {detail && (
            <>
              {detail.profile.portrait && (
                <img
                  className="member-avatar"
                  src={detail.profile.portrait}
                  alt={`${selected.name}'s profile`}
                />
              )}
              <p className="member-introduction">
                {detail.profile.introduction || "No introduction yet."}
              </p>
              {detail.profile.contact_email && (
                <a href={`mailto:${encodeURIComponent(detail.profile.contact_email)}`}>
                  Messaging email: {detail.profile.contact_email}
                </a>
              )}
            </>
          )}
          {canManage ? (
            <form className="owner-form" onSubmit={submit}>
              <label>
                Member action
                <select
                  aria-label="Member action"
                  disabled={busy}
                  value={action}
                  onChange={(e) => setAction(e.target.value as StaffAction)}
                >
                  <option value="warn">Issue warning</option>
                  <option value="ban">Ban account</option>
                  <option value="clear-profile">Clear profile content</option>
                  {role !== "moderator" && (
                    <>
                      <option value="revoke">Revoke account access</option>
                      <option value="restore">Restore account access</option>
                      <option value="sessions">Sign out all sessions</option>
                    </>
                  )}
                  {role === "owner" && <option value="role">Change staff role</option>}
                </select>
              </label>
              {action === "ban" && (
                <label>
                  Ban duration
                  <select
                    aria-label="Ban duration"
                    disabled={busy}
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                  >
                    {[1, 7, 30].map((n) => (
                      <option key={n} value={n}>
                        {n} day{n > 1 ? "s" : ""}
                      </option>
                    ))}
                    {role !== "moderator" && (
                      <>
                        <option value="90">90 days</option>
                        <option value="permanent">Permanent</option>
                      </>
                    )}
                  </select>
                </label>
              )}
              {action === "role" && (
                <label>
                  Staff role
                  <select
                    aria-label="Staff role"
                    disabled={busy}
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as ModerationDraft["newRole"])}
                  >
                    <option value="member">Member (remove staff access)</option>
                    <option value="moderator">Moderator</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
              )}
              {preview && (
                <section
                  className="staff-action-preview"
                  aria-labelledby="staff-action-preview-title"
                >
                  <h4 id="staff-action-preview-title">Before you apply this action</h4>
                  <p>
                    <strong>{preview.summary}</strong>
                  </p>
                  <ul>
                    {preview.effects.map((effect) => (
                      <li key={effect}>{effect}</li>
                    ))}
                  </ul>
                  {action === "ban" && days !== "permanent" && (
                    <p>
                      Approximate expiry if applied now:{" "}
                      {new Date(Date.now() + Number(days) * 86400000).toLocaleString()}. The
                      confirmation shows the scheduled expiry.
                    </p>
                  )}
                  <p>
                    A reason is required. The action and reason are recorded in moderation history.
                  </p>
                </section>
              )}
              <label>
                Reason
                <textarea
                  aria-label="Moderation reason"
                  required
                  disabled={busy}
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              {dirty && (
                <p className="portal-subtle">
                  Unsaved moderation action and reason. Refreshing members keeps this draft.
                </p>
              )}
              <button className="portal-button" disabled={busy || !detail || !reason.trim()}>
                Apply member action
              </button>
            </form>
          ) : (
            <p>This account is protected from actions by your role.</p>
          )}
          <h4>Moderation history</h4>
          {detail?.history.length ? (
            detail.history.map((h, i) => (
              <p key={i}>
                <strong>{h.action}</strong> · {new Date(h.created_at).toLocaleString()} ·{" "}
                {h.actor || "Former staff"}
                <br />
                {h.reason}
              </p>
            ))
          ) : (
            <p>No recorded actions.</p>
          )}
          <button
            className="portal-button secondary"
            disabled={busy}
            onClick={() => {
              if (
                dirty &&
                !window.confirm(
                  "Discard the unsaved moderation action and reason and close member details?",
                )
              )
                return;
              setSelected(null);
              setDetail(null);
              setReason("");
            }}
          >
            Close member details
          </button>
        </section>
      )}
    </section>
  );
}
