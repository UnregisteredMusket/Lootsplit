import { useEffect, useState, type FormEvent } from "react";
import { accountRequest, type MemberProfile, type SiteRole } from "@/lib/account/client";
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
  const [action, setAction] = useState("warn"),
    [reason, setReason] = useState(""),
    [days, setDays] = useState("7"),
    [newRole, setNewRole] = useState("member");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(next = offset) {
    const data = await accountRequest<List>(
      `staff/members?q=${encodeURIComponent(q)}&status=${filter}&offset=${next}`,
    );
    setList(data);
    setOffset(next);
  }
  useEffect(() => {
    void load(0).catch((e) => setError(e.message));
  }, []);
  async function inspect(m: Member) {
    setBusy(true);
    setError("");
    setNotice("");
    setSelected(m);
    setDetail(null);
    setAction("warn");
    setReason("");
    setNewRole(m.role === "owner" ? "member" : m.role);
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
    if (!selected) return;
    const description =
      action === "role"
        ? `Set ${selected.name}'s role to ${newRole}?`
        : action === "ban"
          ? `Ban ${selected.name} ${days === "permanent" ? "permanently" : `for ${days} days`}?`
          : `Apply ${action} to ${selected.name}?`;
    if (!window.confirm(description + " This action is recorded in the moderation log.")) return;
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
        until: days === "permanent" ? null : Date.now() + Number(days) * 86400000,
      });
      setSelected(null);
      setDetail(null);
      await load();
      setNotice("Member action saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const canManage =
    selected &&
    selected.id !== userId &&
    selected.role !== "owner" &&
    (role === "owner" || selected.role === "member");
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
                  onChange={(e) => setAction(e.target.value)}
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
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                  >
                    <option value="member">Member (remove staff access)</option>
                    <option value="moderator">Moderator</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
              )}
              <label>
                Reason
                <textarea
                  aria-label="Moderation reason"
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button className="portal-button" disabled={busy || !detail}>
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
          <button className="portal-button secondary" onClick={() => setSelected(null)}>
            Close member details
          </button>
        </section>
      )}
    </section>
  );
}
