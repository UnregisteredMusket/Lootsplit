import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  accountRequest,
  type AccountLibrary,
  type AccountMembership,
} from "@/lib/account/client";
import { setEphemeralCampaign } from "@/lib/quire/guest-storage";
import { setSeat, DM_SEAT } from "@/lib/quire/table";
import { closeQuireDb } from "@/lib/quire/db";
import {
  resumeAccountMembership,
  subscribeCloudTable,
  getCloudTable,
  getServerCloudTable,
  refreshRecoveryVisibility,
} from "@/lib/quire/cloud-client";
import { Button } from "@/components/ui";
import { DeviceRecovery } from "./device-recovery";
import { roomLifecycleLabels } from "@/lib/quire/room-state";

const publicPaths = new Set([
  "/welcome",
  "/downloads",
  "/updates",
  "/help",
  "/resources",
  "/donate",
  "/account",
]);
/** Resolve identity before providers open any campaign storage. Never erase legacy saves. */
export function CampaignGate({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.searchStr });
  useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const [identityEpoch, setIdentityEpoch] = useState(0);
  useEffect(() => {
    const refresh = () => setIdentityEpoch((x) => x + 1);
    window.addEventListener("lootsplit-account-changed", refresh);
    return () =>
      window.removeEventListener("lootsplit-account-changed", refresh);
  }, []);
  const [library, setLibrary] = useState<AccountLibrary | null>(null);
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;

    void (async () => {
      let next: AccountLibrary | null = null;
      try {
        const session = await accountRequest<{ user: { id: string } } | null>(
          "auth/get-session",
        );
        if (session?.user)
          next = await accountRequest<AccountLibrary>("library");
      } catch {
        if (navigator.onLine) {
          if (active)
            setError(
              "Your account could not be checked. Reconnect and retry before opening a campaign.",
            );
        }
      }
      if (!active) return;
      const id = localStorage.getItem("quire.campaign.v1") || "main";
      const owner = localStorage.getItem(`quire.owner.${id}`);
      const ticket = sessionStorage.getItem("lootsplit.player.reconnect.v1");
      const offlineOwner =
        !navigator.onLine &&
        owner &&
        owner === localStorage.getItem("lootsplit.offline-owner");
      if (next) {
        sessionStorage.setItem("lootsplit.verified-account", next.user.id);
        localStorage.setItem("lootsplit.offline-owner", next.user.id);
      } else if (offlineOwner)
        sessionStorage.setItem("lootsplit.verified-account", owner!);
      else if (navigator.onLine) {
        sessionStorage.removeItem("lootsplit.verified-account");
        localStorage.removeItem("lootsplit.offline-owner");
      }
      refreshRecoveryVisibility();
      const owned = !!(next && owner === next.user.id) || !!offlineOwner;
      setEphemeralCampaign(!!ticket || !owned);
      if (!owned || ticket)
        setSeat({
          role: "player",
          purseIds: [],
          shopIds: [],
          openedAt: Date.now(),
        });
      setLibrary(next);
      setAllowed(owned || !!ticket);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [identityEpoch]);
  const invitation =
    path === "/share" && !!new URLSearchParams(search).get("join");
  if (!ready)
    return (
      <main className="mx-auto max-w-xl p-6" role="status">
        Checking campaign access…
      </main>
    );
  if (
    publicPaths.has(path) ||
    allowed ||
    !!sessionStorage.getItem("lootsplit.player.reconnect.v1") ||
    invitation ||
    path === "/share"
  )
    return children;
  async function resume(member: AccountLibrary["members"][number]) {
    setBusy(true);
    setError("");
    try {
      const result = await accountRequest<AccountMembership>("resume", {
        code: member.code,
        ...(member.closed
          ? { reopen: true, revision: member.room_revision }
          : {}),
      });
      await resumeAccountMembership(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to resume campaign.");
    } finally {
      setBusy(false);
    }
  }
  async function claim() {
    const id = localStorage.getItem("quire.campaign.v1") || "main";
    const owner = localStorage.getItem(`quire.owner.${id}`);
    if (!library || (owner && owner !== library.user.id)) return;
    const seat = JSON.parse(
      localStorage.getItem(
        id === "main" ? "quire.seat.v1" : `quire.seat.v1.${id}`,
      ) || "null",
    );
    if (seat?.role === "player") {
      setError(
        "This is a player copy. Resume a campaign you own from My account.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = JSON.parse(
        localStorage.getItem(`quire.cloud.v2.${id}`) || "null",
      );
      if (saved?.role === "dm" && saved.code && saved.token) {
        const campaigns = JSON.parse(
          localStorage.getItem("quire.campaigns.v1") || "[]",
        );
        await accountRequest("link", {
          code: saved.code,
          token: saved.token,
          name:
            campaigns.find((c: { id: string; name: string }) => c.id === id)
              ?.name || "Campaign",
        });
      }
      localStorage.setItem(`quire.owner.${id}`, library.user.id);
      setEphemeralCampaign(false);
      closeQuireDb();
      setSeat(DM_SEAT);
      setAllowed(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The device campaign could not be claimed. Your save is unchanged.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-3xl">
        {library ? "Choose your campaign" : "Welcome to Lootsplit"}
      </h1>
      {!library ? (
        <>
          <p>
            Create an account or sign in to proceed as a Dungeon Master in your
            own campaign
          </p>
          <Link to="/account" className="settings-link">
            Create an account or sign in
          </Link>
          <Link to="/share" className="settings-link">
            Join with a current session invitation
          </Link>
        </>
      ) : (
        <>
          <p>
            Your account owns your campaigns. Choose one to load its saved data.
          </p>
          <DeviceRecovery userId={library.user.id} />
          {library.members
            .filter((m) => m.role === "dm" && !m.archived)
            .map((m) => (
              <section className="ledger-card" key={m.code}>
                <h2>{m.name}</h2>
                <p>Campaign ID {m.code}</p>
                <p>{Object.values(roomLifecycleLabels(m)).join(" · ")}</p>
                <Button disabled={busy} onClick={() => void resume(m)}>
                  {m.closed ? "Reopen as DM" : m.viewOnly ? "Open for viewing" : "Resume"}
                </Button>
              </section>
            ))}
          <Link to="/account" className="settings-link">
            My account and saved campaigns
          </Link>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void claim()}
          >
            Claim this device’s existing DM campaign
          </Button>
          <p className="text-sm">
            Existing device saves are preserved. Claiming enables offline DM
            play; start a room to save the shared campaign to your account.
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
