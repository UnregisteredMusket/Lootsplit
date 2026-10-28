import { useEffect, useState } from "react";
import { Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { accountRequest } from "@/lib/account/client";
import { AppLink } from "@/components/app-link";
import { FantasyIcon } from "@/components/fantasy-icon";
import { destinationsFor, pinShortcut, unpinShortcut } from "@/lib/quire/shortcuts.mjs";
import "./pins.css";

type Shortcut = { destination: string; label: string; icon: string };
type State = { identity: string | null; items: Shortcut[]; revision: number; loaded: boolean };
const CHANGED = "lootsplit:shortcuts-changed";

/**
 * The DM's account-saved shortcuts (Settings → Dashboard → Saved shortcut settings), read for
 * Pin to Desk and the Desk's Pinned row (design Q8). The account stays authoritative.
 */
function useDmShortcuts() {
  const [state, setState] = useState<State>({
    identity: null,
    items: [],
    revision: 0,
    loaded: false,
  });
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const session = await accountRequest<{ user: { id: string } } | null>("auth/get-session");
        if (!session?.user) {
          if (live) setState({ identity: null, items: [], revision: 0, loaded: true });
          return;
        }
        const data = await accountRequest<{ items: Shortcut[]; revision: number }>(
          "shortcuts?role=dm",
        );
        if (live)
          setState({
            identity: session.user.id,
            items: data.items,
            revision: data.revision,
            loaded: true,
          });
      } catch {
        if (live) setState((s) => ({ ...s, loaded: true }));
      }
    };
    void load();
    window.addEventListener(CHANGED, load);
    window.addEventListener("lootsplit-account-changed", load);
    return () => {
      live = false;
      window.removeEventListener(CHANGED, load);
      window.removeEventListener("lootsplit-account-changed", load);
    };
  }, []);
  return state;
}

/** Feature screen header: Pin to Desk / Unpin (DM, signed in). */
export function PinToDesk({ feature }: { feature: string }) {
  const { identity, items, revision, loaded } = useDmShortcuts();
  const [busy, setBusy] = useState(false);
  const target = destinationsFor("dm").find((d) => d.id === feature);
  if (!loaded || !identity || !target) return null;
  const pinned = items.some((x) => x.destination === feature);
  async function toggle() {
    setBusy(true);
    try {
      const next = pinned ? unpinShortcut(items, feature, "dm") : pinShortcut(items, feature, "dm");
      const dropped = items.find((x) => !next.some((y) => y.destination === x.destination));
      await accountRequest("shortcuts", { role: "dm", revision, items: next });
      window.dispatchEvent(new Event(CHANGED));
      toast.success(
        pinned
          ? `${target!.label} unpinned from the Desk.`
          : `${target!.label} pinned to the Desk${dropped ? `; it replaced ${dropped.label}` : ""}.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change your Desk pins.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      className="pin-to-desk"
      aria-pressed={pinned}
      disabled={busy}
      onClick={() => void toggle()}
    >
      {pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}
      {pinned ? "Pinned to Desk" : "Pin to Desk"}
    </button>
  );
}

/**
 * Desk: the saved shortcuts as one compact row, once the DM has pinned or saved them
 * (revision > 0); DMs who never customized keep the Desk as it was.
 */
export function DeskPinned() {
  const { identity, items, revision } = useDmShortcuts();
  if (!identity || !revision) return null;
  const destinations = destinationsFor("dm");
  return (
    <section className="desk-pins" aria-labelledby="desk-pins-heading">
      <div className="desk-pins-heading">
        <h2 id="desk-pins-heading">Pinned</h2>
        <AppLink href="/?view=home&customize=1#saved-shortcuts">Edit</AppLink>
      </div>
      <div className="desk-pins-row">
        {items.map((item, i) => {
          const target = destinations.find((d) => d.id === item.destination);
          return target ? (
            <AppLink key={`${item.destination}-${i}`} href={target.href} className="desk-pin">
              <FantasyIcon ui={item.icon} size={22} />
              <span>{item.label}</span>
            </AppLink>
          ) : null;
        })}
      </div>
    </section>
  );
}
