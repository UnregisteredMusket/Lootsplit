import { accountRequest } from "@/lib/account/client";
import { AppLink } from "@/components/app-link";
import { FantasyIcon } from "@/components/fantasy-icon";
import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { Button, Modal } from "@/components/ui";
import {
  defaultShortcuts,
  normalizeShortcuts,
  shortcutDestinations,
  destinationsFor,
  shortcutIcons,
} from "@/lib/quire/shortcuts.mjs";
function cacheShortcuts(userId: string, role: string, items: unknown) {
  // DM-only convenience cache; no campaign data or guest/player preferences.
  if (role === "dm")
    try {
      localStorage.setItem(`lootsplit.account-shortcuts.v1.${userId}.dm`, JSON.stringify(items));
    } catch {
      /* Account remains authoritative. */
    }
}
function legacyShortcuts(raw: string, role: string) {
  const parsed = JSON.parse(raw);
  return normalizeShortcuts(
    Array.isArray(parsed)
      ? parsed.map((x) => (x?.destination === "review" ? { ...x, destination: "bank" } : x))
      : parsed,
    role,
  );
}
type Shortcut = { destination: string; label: string; icon: string };
export function Shortcuts({
  campaignId,
  role = "dm",
}: {
  campaignId: string;
  role?: "dm" | "player";
}) {
  const [identity, setIdentity] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [loaded, setLoaded] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const destinations = destinationsFor(role);
  const key = `lootsplit.shortcuts.v1.${campaignId}`;
  const [items, setItems] = useState<Shortcut[]>(defaultShortcuts),
    [draft, setDraft] = useState<Shortcut[]>(defaultShortcuts),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let disposed = false,
      generation = 0;
    async function load() {
      const current = ++generation;
      setLoaded(false);
      setIdentity(null);
      setItems(normalizeShortcuts(null, role));
      setError("");
      try {
        const session = await accountRequest<{ user: { id: string } } | null>("auth/get-session");
        if (disposed || current !== generation) return;
        if (!session?.user) {
          setLoaded(true);
          return;
        }
        setIdentity(session.user.id);
        const data = await accountRequest<{ items: Shortcut[]; revision: number }>(
          `shortcuts?role=${role}`,
        );
        if (disposed || current !== generation) return;
        let next = data.items;
        if (!data.revision && role === "dm") {
          try {
            next = legacyShortcuts(localStorage.getItem(key) || "null", role);
          } catch {
            next = normalizeShortcuts(null, role);
          }
        }
        setItems(next);
        setRevision(data.revision);
        setLoaded(true);
        cacheShortcuts(session.user.id, role, next);
        if (new URLSearchParams(location.search).get("customize") === "1") {
          setDraft(next.map((x) => ({ ...x })));
          setOpen(true);
        }
      } catch (e) {
        if (!disposed && current === generation) {
          setError(e instanceof Error ? e.message : "Shortcuts unavailable.");
          // Only the already verified owner may use cached DM destinations offline.
          const owner = sessionStorage.getItem("lootsplit.verified-account");
          if (
            role === "dm" &&
            owner &&
            localStorage.getItem(`quire.owner.${campaignId}`) === owner
          ) {
            try {
              const cached = localStorage.getItem(`lootsplit.account-shortcuts.v1.${owner}.dm`);
              setItems(
                cached
                  ? normalizeShortcuts(JSON.parse(cached), role)
                  : legacyShortcuts(localStorage.getItem(key) || "null", role),
              );
              setIdentity(owner);
            } catch {
              /* Keep fixed feature links available. */
            }
          }
        }
      }
    }
    void load();
    const changed = () => {
      setOpen(false);
      void load();
    };
    window.addEventListener("lootsplit-account-changed", changed);
    return () => {
      disposed = true;
      window.removeEventListener("lootsplit-account-changed", changed);
    };
  }, [key, role, campaignId]);
  useEffect(() => {
    const show = () => {
      if (!identity || !loaded) return;
      setDraft(items.map((x) => ({ ...x })));
      setOpen(true);
    };
    window.addEventListener("lootsplit:shortcuts", show);
    return () => window.removeEventListener("lootsplit:shortcuts", show);
  }, [items, identity, loaded]);
  function edit() {
    setDraft(items.map((x) => ({ ...x })));
    setOpen(true);
  }
  function patch(i: number, change: Partial<Shortcut>) {
    setDraft((rows) => rows.map((x, j) => (j === i ? { ...x, ...change } : x)));
  }
  function move(i: number, d: number) {
    setDraft((rows) => {
      const next = [...rows];
      [next[i], next[i + d]] = [next[i + d]!, next[i]!];
      return next;
    });
  }
  return (
    <section className="desk-shortcuts" aria-label="My shortcuts">
      <div className="panel-heading">
        <h2>My shortcuts</h2>
        {identity && (
          <Button
            disabled={!loaded}
            variant="secondary"
            className="shortcut-customize"
            onClick={edit}
          >
            Customize
          </Button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {!loaded && !error ? (
        <p role="status" className="text-sm">Loading your account shortcuts…</p>
      ) : !identity ? (
        <p className="text-sm">
          Sign in to save personal shortcuts. Use the campaign feature buttons.
        </p>
      ) : (
        <div className="shortcut-grid">
          {items.map((item, i) => {
            const target = shortcutDestinations.find((x) => x.id === item.destination)!;
            return (
              <AppLink key={i} href={target.href} className="shortcut-button">
                <FantasyIcon ui={item.icon} size={40} />
                <span>{item.label}</span>
              </AppLink>
            );
          })}
        </div>
      )}
      <p className="shortcut-hint">Your destinations, one tap away.</p>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Customize shortcuts"
        returnFocus=".shortcut-customize"
      >
        <p className="text-sm text-muted mb-4">
          Choose six destinations. Saved to your account for this role across devices.
        </p>
        <div className="shortcut-editor">
          {draft.map((item, i) => (
            <div className="shortcut-edit-row" key={i}>
              <label>
                Button {i + 1}
                <select
                  aria-label={`Button ${i + 1}`}
                  value={item.destination}
                  onChange={(e) => {
                    const target = shortcutDestinations.find((x) => x.id === e.target.value)!;
                    patch(i, {
                      destination: target.id,
                      label: target.label,
                      icon: target.icon,
                    });
                  }}
                >
                  {destinations.map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Label
                <input
                  maxLength={32}
                  value={item.label}
                  onChange={(e) => patch(i, { label: e.target.value })}
                />
              </label>
              <label>
                Icon
                <select
                  aria-label={`Button ${i + 1} icon`}
                  value={item.icon}
                  onChange={(e) => patch(i, { icon: e.target.value })}
                >
                  {shortcutIcons.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  aria-label={`Move button ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={18} />
                </Button>
                <Button
                  variant="secondary"
                  aria-label={`Move button ${i + 1} down`}
                  disabled={i === 5}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={18} />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={saving || !loaded || !identity}
            onClick={async () => {
              setSaving(true);
              try {
                const data = await accountRequest<{ items: Shortcut[]; revision: number }>(
                  "shortcuts",
                  { role, revision, items: normalizeShortcuts(draft, role) },
                );
                setItems(data.items);
                setRevision(data.revision);
                cacheShortcuts(identity!, role, data.items);
                setOpen(false);
                toast.success("Account shortcuts saved");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Unable to save shortcuts.");
              } finally {
                setSaving(false);
              }
            }}
          >
            Save shortcuts
          </Button>
          <Button
            variant="secondary"
            disabled={saving}
            onClick={async () => {
              try {
                const d = await accountRequest<{ items: Shortcut[]; revision: number }>(
                  `shortcuts?role=${role}`,
                );
                setDraft(d.items);
                setItems(d.items);
                setRevision(d.revision);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Unable to reload.");
              }
            }}
          >
            Reload account shortcuts
          </Button>
          <Button variant="secondary" onClick={() => setDraft(normalizeShortcuts(null, role))}>
            Restore defaults
          </Button>
        </div>
      </Modal>
    </section>
  );
}
