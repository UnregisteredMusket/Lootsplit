import { ServerMonitor } from "@/components/account/server-monitor";
import { ProfileControls } from "@/components/account/profile-controls";
import { StaffControls } from "@/components/account/staff-controls";
import { Campaigns } from "@/components/campaigns";
import { OwnerControls } from "@/components/account/owner-controls";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  ArrowRight,
  Archive,
  Download,
  ShieldCheck,
  Users,
  LogOut,
  Plus,
  Trash2,
} from "lucide-react";
import { SiteHeader, SiteFooter } from "./welcome";
import {
  accountRequest,
  type AccountLibrary,
  type AccountMembership,
  type CharacterProfile,
} from "@/lib/account/client";
import {
  addAccountCharacter,
  linkCurrentCampaign,
  restoreAccountBackup,
  saveAccountBackup,
} from "@/lib/account/transfers";
import {
  getCloudTable,
  getServerCloudTable,
  subscribeCloudTable,
  resumeAccountMembership,
  hasPendingChanges,
  leaveTable,
} from "@/lib/quire/cloud-client";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { downloadJson } from "@/lib/quire/table";
export const Route = createFileRoute("/account")({ component: Account });
function Account() {
  const [library, setLibrary] = useState<AccountLibrary | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [mode, setMode] = useState<"signin" | "signup" | "recover">("signin");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [recoveryInput, setRecoveryInput] = useState(""),
    [key, setKey] = useState("");
  const [profileName, setProfileName] = useState(""),
    [description, setDescription] = useState(""),
    [portrait, setPortrait] = useState(""),
    [editId, setEditId] = useState(""),
    [archived, setArchived] = useState(false);
  const economy = useEconomy(),
    seat = useSeat();
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const reload = async () => setLibrary(await accountRequest<AccountLibrary>("library"));
  useEffect(() => {
    let live = true;
    void accountRequest<{ user: unknown } | null>("auth/get-session")
      .then(async (session) => {
        if (session?.user) {
          const data = await accountRequest<AccountLibrary>("library");
          if (live) setLibrary(data);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function authSubmit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      if (mode === "recover") {
        const result = await accountRequest<{ key: string }>("recover", {
          email,
          key: recoveryInput,
          password,
        });
        setKey(result.key);
        setNotice("Password changed. Save your replacement recovery key, then sign in.");
        setMode("signin");
        setRecoveryInput("");
        setPassword("");
        return;
      }
      await accountRequest(mode === "signup" ? "auth/sign-up/email" : "auth/sign-in/email", {
        email,
        password,
        ...(mode === "signup" ? { name } : {}),
      });
      setPassword("");
      await reload();
      if (mode === "signup") {
        const result = await accountRequest<{ key: string }>("recovery-key", {});
        setKey(result.key);
        await reload();
      }
    });
  }
  async function signOut() {
    if (hasPendingChanges())
      throw new Error("Submit or resolve your pending campaign actions before signing out.");
    await accountRequest("auth/sign-out", {});
    const current = localStorage.getItem("quire.campaign.v1") || "";
    if (current.startsWith("account-") && cloud.joined) leaveTable();
    for (const k of Object.keys(localStorage))
      if (k.startsWith("quire.cloud.v2.account-")) localStorage.removeItem(k);
    setLibrary(null);
    setKey("");
    setNotice("Signed out. Your device campaign copies remain on this device.");
  }
  const action = (work: () => Promise<void>) => () => void run(work);
  const remove = (kind: string, id: string) =>
    action(async () => {
      if (
        !window.confirm(
          `Remove this ${kind} from your account library? Device copies and shared rooms will remain.`,
        )
      )
        return;
      await accountRequest("remove", { kind, id });
      await reload();
    });
  return (
    <div className="portal">
      <SiteHeader />
      <main className="portal-content">
        <div className="portal-title-row">
          <div>
            <p className="portal-eyebrow">YOUR NEXT ADVENTURE STARTS HERE</p>
            <h1>{library ? `${library.user.name}’s library` : "Welcome to your next chapter."}</h1>
            <p className="portal-lead">
              {library
                ? "Your campaigns, recovery copies and characters, ready when you are."
                : "Sign in to return to your campaigns across devices. Guest and offline play stay available."}
            </p>
          </div>
          {library && (
            <button disabled={busy} onClick={action(signOut)} className="portal-button secondary">
              <LogOut size={16} /> Sign out
            </button>
          )}
        </div>
        {error && (
          <p className="portal-message error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="portal-message" role="status">
            {notice}
          </p>
        )}
        {(library?.user.role === "owner" || library?.user.role === "admin") && <ServerMonitor />}
        {library?.user.role === "owner" && <OwnerControls />}
        {library && (
          <>
            {library.notices.map((n, i) => (
              <p key={i} className="portal-message" role="status">
                Staff warning ({new Date(n.created_at).toLocaleDateString()}): {n.reason}
              </p>
            ))}
            <ProfileControls profile={library.profile} onSaved={reload} />
            {library.user.role !== "member" && (
              <StaffControls userId={library.user.id} role={library.user.role} />
            )}
            <section className="portal-card">
              <h2>Campaigns on this device</h2>
              <p>
                These campaigns are stored on this device, separately from your shared memberships
                and cloud backups.
              </p>
              <Campaigns />
            </section>
          </>
        )}
        {key && (
          <section className="portal-key" aria-label="Recovery key">
            <ShieldCheck />
            <h2>Keep this recovery key somewhere safe</h2>
            <p>
              This key can reset your password. It replaces any previous key. Email reset is not
              enabled; save this key outside Lootsplit.
            </p>
            <code>{key}</code>
            <div className="portal-actions">
              <button
                className="portal-button secondary"
                onClick={action(async () => {
                  await downloadJson("Lootsplit-account-recovery.json", {
                    email: library?.user.email || email,
                    recoveryKey: key,
                  });
                })}
              >
                Save recovery key
              </button>
              <button className="portal-button secondary" onClick={() => setKey("")}>
                I have saved it
              </button>
            </div>
          </section>
        )}
        {loading ? (
          <p role="status">Opening your library…</p>
        ) : !library ? (
          <div className="portal-auth-layout">
            <section className="portal-card">
              <div className="portal-tabs">
                <button
                  className={mode === "signin" ? "selected" : ""}
                  onClick={() => setMode("signin")}
                >
                  Sign in
                </button>
                <button
                  className={mode === "signup" ? "selected" : ""}
                  onClick={() => setMode("signup")}
                >
                  Create account
                </button>
              </div>
              <h2>
                {mode === "recover"
                  ? "Recover your account"
                  : mode === "signup"
                    ? "A home for your adventures"
                    : "Good to see you again"}
              </h2>
              <form onSubmit={authSubmit} className="portal-form">
                {mode === "signup" && (
                  <label>
                    Display name
                    <input
                      required
                      maxLength={60}
                      autoComplete="nickname"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                )}
                <label>
                  Email
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                {mode === "recover" && (
                  <label>
                    Recovery key
                    <input
                      required
                      autoComplete="off"
                      value={recoveryInput}
                      onChange={(e) => setRecoveryInput(e.target.value)}
                    />
                  </label>
                )}
                <label>
                  {mode === "recover" ? "New password" : "Password"}
                  <input
                    required
                    type="password"
                    minLength={mode === "signin" ? 1 : 12}
                    maxLength={128}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                {mode !== "signin" && (
                  <p className="portal-subtle">
                    Use at least 12 characters. A password manager can save your password and
                    recovery key.
                  </p>
                )}
                <button className="portal-button" disabled={busy}>
                  {busy
                    ? "Please wait…"
                    : mode === "signup"
                      ? "Create account"
                      : mode === "recover"
                        ? "Reset password"
                        : "Sign in"}
                  <ArrowRight size={17} />
                </button>
              </form>
              <button
                className="portal-text-button"
                onClick={() => setMode(mode === "recover" ? "signin" : "recover")}
              >
                {mode === "recover"
                  ? "Back to sign in"
                  : "Forgot your password? Use a recovery key"}
              </button>
            </section>
            <aside className="portal-auth-aside">
              <Users size={40} />
              <h2>
                Same party.
                <br />
                Less getting set up.
              </h2>
              <p>
                Save your place in shared campaigns. Keep private cloud backups. Reuse character
                profiles without carrying money between worlds.
              </p>
              <p>
                Signing in does not upload any campaign automatically. Your PDFs stay on your
                device.
              </p>
              <Link to="/" search={{ view: "home" }}>
                Continue as guest →
              </Link>
            </aside>
          </div>
        ) : (
          <>
            <section className="portal-account-section">
              <div className="portal-section-title">
                <div>
                  <p className="portal-eyebrow">PICK UP WHERE YOU LEFT OFF</p>
                  <h2>My campaigns</h2>
                </div>
                <button
                  className="portal-button secondary"
                  disabled={busy || !cloud.joined}
                  onClick={action(async () => {
                    await linkCurrentCampaign();
                    await reload();
                    setNotice(
                      "This membership is saved. You can resume it on another signed-in device.",
                    );
                  })}
                >
                  <Plus size={16} /> Save current membership
                </button>
              </div>
              <p className="portal-subtle">
                Open or join a shared campaign in the app, then save its membership here. Your DM
                controls your access. Linking does not upload a local-only campaign.
              </p>
              <label className="portal-check">
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(e) => setArchived(e.target.checked)}
                />{" "}
                Show archived campaigns
              </label>
              <div className="portal-library-grid">
                {library.members
                  .filter((m) => archived || !m.archived)
                  .map((m) => (
                    <article className="portal-card" key={m.code}>
                      <span className="portal-eyebrow">
                        {m.archived ? "ARCHIVED" : "SHARED CAMPAIGN"} · {m.code}
                      </span>
                      <h3>{m.name}</h3>
                      <p className="portal-subtle">
                        Last used {new Date(m.updated_at).toLocaleDateString()}
                      </p>
                      <div className="portal-actions">
                        <button
                          className="portal-button secondary"
                          disabled={busy}
                          onClick={action(async () => {
                            const name = window.prompt("Campaign name in your library", m.name);
                            if (!name) return;
                            await accountRequest("campaign", {
                              action: "rename",
                              code: m.code,
                              name,
                            });
                            await reload();
                          })}
                        >
                          Rename
                        </button>
                        {m.role === "dm" && (
                          <button
                            className="portal-button secondary"
                            disabled={busy}
                            onClick={action(async () => {
                              if (cloud.joined && cloud.code === m.code && hasPendingChanges())
                                throw new Error(
                                  "Submit or export pending changes before deleting this campaign.",
                                );
                              const confirm = window.prompt(
                                `Delete shared campaign ${m.name} for everyone? A private cloud backup of its saved state will be kept. Device copies remain. Type ${m.code} to confirm.`,
                              );
                              if (confirm !== m.code) return;
                              await accountRequest("campaign", {
                                action: "delete",
                                code: m.code,
                                confirm,
                                revision: m.room_revision,
                              });
                              if (cloud.joined && cloud.code === m.code) leaveTable();
                              await reload();
                              setNotice(
                                "Shared campaign deleted. Its saved state is in Cloud backups.",
                              );
                            })}
                          >
                            Delete shared campaign
                          </button>
                        )}
                        <button
                          className="portal-button"
                          disabled={busy}
                          onClick={action(async () => {
                            const member = await accountRequest<AccountMembership>("resume", {
                              code: m.code,
                            });
                            await resumeAccountMembership(member);
                          })}
                        >
                          Resume <ArrowRight size={16} />
                        </button>
                        <button
                          aria-label={`${m.archived ? "Unarchive" : "Archive"} ${m.name}`}
                          className="portal-icon-button"
                          disabled={busy}
                          onClick={action(async () => {
                            await accountRequest("archive", {
                              code: m.code,
                              archived: !m.archived,
                            });
                            await reload();
                          })}
                        >
                          <Archive size={18} />
                        </button>
                        <button
                          aria-label={`Forget ${m.name}`}
                          className="portal-icon-button"
                          disabled={busy}
                          onClick={remove("membership", m.code)}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
              {!library.members.length && (
                <div className="portal-empty">
                  No saved memberships yet. <Link to="/share">Open campaign sharing →</Link>
                </div>
              )}
            </section>
            <section className="portal-account-section">
              <div className="portal-section-title">
                <div>
                  <p className="portal-eyebrow">SAVE A MOMENT IN THE STORY</p>
                  <h2>Cloud backups</h2>
                </div>
                <button
                  className="portal-button secondary"
                  disabled={busy || seat.role !== "dm" || !economy.ready}
                  onClick={action(async () => {
                    await saveAccountBackup();
                    await reload();
                    setNotice("A new private cloud backup is saved. Earlier backups were kept.");
                  })}
                >
                  <Plus size={16} /> Save current campaign
                </button>
              </div>
              <p className="portal-subtle">
                Manual recovery copies, separate from live campaigns. Each save keeps a new version.
                Restoring creates a new device campaign. PDFs and extracted reference content stay
                device-local; protected saves use the existing encrypted device tools.
              </p>
              <div className="portal-backup-list">
                {library.backups.map((b) => (
                  <article key={b.id}>
                    <div>
                      <h3>{b.name}</h3>
                      <p>{new Date(b.created_at).toLocaleString()}</p>
                    </div>
                    <div className="portal-actions">
                      <button
                        className="portal-button secondary"
                        disabled={busy}
                        onClick={action(async () => {
                          if (
                            window.confirm(
                              "Restore into a new device campaign? Your current campaign will remain.",
                            )
                          )
                            await restoreAccountBackup(b.id, b.name);
                        })}
                      >
                        Restore as new
                      </button>
                      <button
                        aria-label={`Download ${b.name}`}
                        className="portal-icon-button"
                        disabled={busy}
                        onClick={action(async () => {
                          const r = await accountRequest<{ payload: unknown }>("read-backup", {
                            id: b.id,
                          });
                          await downloadJson(`Lootsplit-cloud-${b.id}.json`, r.payload);
                        })}
                      >
                        <Download size={18} />
                      </button>
                      <button
                        aria-label={`Delete backup ${b.name}`}
                        className="portal-icon-button"
                        disabled={busy}
                        onClick={remove("backup", b.id)}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!library.backups.length && (
                <div className="portal-empty">
                  No cloud backups yet. Local saves are still available in the app’s settings.
                </div>
              )}
            </section>
            <section className="portal-account-section">
              <p className="portal-eyebrow">FAMILIAR FACES, NEW ADVENTURES</p>
              <h2>My characters</h2>
              <p className="portal-subtle">
                Reusable names, portraits and notes. Adding a profile creates a new character with
                no money or inventory, in your current local DM campaign.
              </p>
              <div className="portal-library-grid">
                {library.characters.map((c) => (
                  <article className="portal-card" key={c.id}>
                    {c.portrait && <img className="portal-portrait" src={c.portrait} alt="" />}
                    <h3>{c.name}</h3>
                    <p>{c.description}</p>
                    <div className="portal-actions">
                      <button
                        className="portal-button secondary"
                        disabled={busy}
                        onClick={action(async () => {
                          await addAccountCharacter(c);
                          await economy.reload();
                          setNotice(
                            `${c.name} was added to your local campaign with an empty purse.`,
                          );
                        })}
                      >
                        Add to campaign
                      </button>
                      <button
                        className="portal-text-button"
                        onClick={() => {
                          setEditId(c.id);
                          setProfileName(c.name);
                          setDescription(c.description);
                          setPortrait(c.portrait);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="portal-icon-button"
                        aria-label={`Delete character ${c.name}`}
                        disabled={busy}
                        onClick={remove("character", c.id)}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <form
                className="portal-card portal-form profile-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await accountRequest("character", {
                      ...(editId ? { id: editId } : {}),
                      name: profileName,
                      description,
                      portrait,
                    });
                    setEditId("");
                    setProfileName("");
                    setDescription("");
                    setPortrait("");
                    await reload();
                  });
                }}
              >
                <h3>{editId ? "Edit character profile" : "Save a character profile"}</h3>
                {!editId && (
                  <label>
                    Start from a current character (optional)
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const p = economy.purses.find((p) => p.id === e.target.value);
                        if (p) {
                          setProfileName(p.name);
                          setPortrait(p.portrait || "");
                          setDescription("");
                        }
                      }}
                    >
                      <option value="">Choose a character or enter one below</option>
                      {economy.purses
                        .filter(
                          (p) =>
                            p.kind === "character" &&
                            (seat.role === "dm" || seat.purseIds.includes(p.id)),
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label>
                  Character name
                  <input
                    value={profileName}
                    required
                    maxLength={80}
                    onChange={(e) => setProfileName(e.target.value)}
                  />
                </label>
                <label>
                  Notes
                  <textarea
                    value={description}
                    maxLength={2000}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <label>
                  Portrait (optional, PNG/JPEG/WebP, up to 350 KB)
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      void run(async () => {
                        if (f.size > 350000) throw new Error("Choose a portrait below 350 KB.");
                        const data = await new Promise<string>((resolve, reject) => {
                          const reader = new FileReader();
                          reader.onload = () => resolve(String(reader.result));
                          reader.onerror = () => reject(new Error("Could not read the portrait."));
                          reader.readAsDataURL(f);
                        });
                        setPortrait(data);
                      });
                    }}
                  />
                </label>
                {portrait && (
                  <div className="portal-actions">
                    <img className="portal-portrait" src={portrait} alt="Selected portrait" />
                    <button type="button" onClick={() => setPortrait("")}>
                      Remove portrait
                    </button>
                  </div>
                )}
                <div className="portal-actions">
                  <button className="portal-button" disabled={busy}>
                    Save profile
                  </button>
                  {editId && (
                    <button
                      type="button"
                      className="portal-button secondary"
                      onClick={() => {
                        setEditId("");
                        setProfileName("");
                        setDescription("");
                        setPortrait("");
                      }}
                    >
                      Cancel edit
                    </button>
                  )}
                </div>
              </form>
            </section>
            <section className="portal-callout">
              <div>
                <ShieldCheck />
                <h2>Account recovery</h2>
                <p>
                  {library.hasRecoveryKey
                    ? "A recovery key is set. Keep it outside the app."
                    : "Save a recovery key now so you can recover a forgotten password."}{" "}
                  Generating another invalidates the old key. Email reset is not enabled.
                </p>
                <p className="portal-subtle">
                  Signed in as {library.user.email}. Signing out keeps device copies, while removing
                  account-resumed connections from this device.
                </p>
              </div>
              <button
                className="portal-button secondary"
                disabled={busy}
                onClick={action(async () => {
                  if (
                    library.hasRecoveryKey &&
                    !window.confirm(
                      "Replace your current recovery key? The old key will stop working.",
                    )
                  )
                    return;
                  const r = await accountRequest<{ key: string }>("recovery-key", {});
                  setKey(r.key);
                  await reload();
                  window.scrollTo({ top: 0, behavior: "smooth" });
                })}
              >
                {library.hasRecoveryKey ? "Replace recovery key" : "Create recovery key"}
              </button>
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
