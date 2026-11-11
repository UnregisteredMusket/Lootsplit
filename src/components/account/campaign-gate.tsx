import { activeCampaignId, pinCampaignContext } from "../../lib/quire/campaign-context.ts";
import { subscribeWorkspaceChanges } from "@/lib/quire/workspace-events";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  accountRequest,
  forgetAccountIdentity,
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
import { useUnmatchedRoute } from "@/lib/website/not-found-route";
import { drawsBeforeAccountCheck, isGatePublicPath } from "@/lib/website/public-gate";
import { DeviceRecovery } from "./device-recovery";
import { roomLifecycleLabels } from "@/lib/quire/room-state";
import {
  gateAccess,
  identityFailure,
  UNCHECKED_NOTICE,
  UNCHECKED_SIGNED_OUT_NOTICE,
  type IdentityCheck,
} from "@/lib/account/gate-access";

/**
 * Resolve identity before providers open any campaign storage. Never erase legacy saves.
 * `publicPage` is the page alone, without the campaign providers. A document opened on a public
 * website page or the not-found page shows it at once (and in server HTML) instead of waiting for
 * the account check, and keeps it until the visitor moves to another page: swapping it for
 * `children` in place would draw the page a second time, closing an open menu and repeating its
 * reads. From the next page on, `children` (providers and page) render exactly as before.
 */
export function CampaignGate({
  children,
  publicPage,
}: {
  children: ReactNode;
  publicPage?: ReactNode;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.searchStr });
  // The website's not-found page needs no campaign access (W-1).
  const notFound = useUnmatchedRoute();
  useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const [identityEpoch, setIdentityEpoch] = useState(0);
  useEffect(() => {
    const refresh = () => setIdentityEpoch((x) => x + 1);
    const unsubscribe = subscribeWorkspaceChanges((change) => {
      if (change.kind === "account") {
        forgetAccountIdentity();
        sessionStorage.removeItem("lootsplit.verified-account");
        refresh();
      }
    });
    window.addEventListener("lootsplit-account-changed", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener("lootsplit-account-changed", refresh);
    };
  }, []);
  // The address this document opened on, while it is drawn without the campaign providers.
  const [barePath, setBarePath] = useState<string | null>(() =>
    publicPage && drawsBeforeAccountCheck(path, notFound) ? path : null,
  );
  if (barePath !== null && barePath !== path) setBarePath(null);
  const [library, setLibrary] = useState<AccountLibrary | null>(null);
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The account check did not finish (audit 2026-11-10 D1): a notice with Retry, and another check
  // when the device reconnects or the window regains focus. Only a positive "no session" signs
  // the device out of its campaign.
  const [unchecked, setUnchecked] = useState(false);
  const [noticeHidden, setNoticeHidden] = useState(false);
  useEffect(() => {
    if (!unchecked) return;
    let last = Date.now();
    const recheck = () => setIdentityEpoch((x) => x + 1);
    const onFocus = () => {
      // Window focus fires often; at most one check every 15 s (the sign-in limit is per address).
      if (Date.now() - last < 15000) return;
      last = Date.now();
      recheck();
    };
    window.addEventListener("online", recheck);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("online", recheck);
      window.removeEventListener("focus", onFocus);
    };
  }, [unchecked]);
  useEffect(() => {
    let active = true;

    void (async () => {
      pinCampaignContext();
      let next: AccountLibrary | null = null;
      let check: IdentityCheck;
      try {
        const session = await accountRequest<{ user: { id: string } } | null>("auth/get-session");
        if (session?.user) {
          next = await accountRequest<AccountLibrary>("library");
          check = { kind: "signed-in", userId: next.user.id };
        } else check = { kind: "signed-out" };
      } catch (e) {
        check = identityFailure(e);
      }
      if (!active) return;
      const id = activeCampaignId();
      const owner = localStorage.getItem(`quire.owner.${id}`);
      const ticket = sessionStorage.getItem("lootsplit.player.reconnect.v1");
      const access = gateAccess({
        check,
        owner,
        marker: localStorage.getItem("lootsplit.offline-owner"),
      });
      if (access.verified) sessionStorage.setItem("lootsplit.verified-account", access.verified);
      else if (access.verified === null) sessionStorage.removeItem("lootsplit.verified-account");
      if (access.marker) localStorage.setItem("lootsplit.offline-owner", access.marker);
      else if (access.marker === null) localStorage.removeItem("lootsplit.offline-owner");
      refreshRecoveryVisibility();
      const owned = access.owned;
      setUnchecked(access.unchecked);
      // A dismissed notice stays hidden through later failed re-checks of this page.
      if (!access.unchecked) setNoticeHidden(false);
      setError(access.unchecked && !owned ? UNCHECKED_SIGNED_OUT_NOTICE : "");
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
  const invitation = path === "/share" && !!new URLSearchParams(search).get("join");
  if (barePath !== null && barePath === path) return publicPage;
  if (!ready)
    return (
      <main className="mx-auto max-w-xl p-6" role="status">
        Checking campaign access…
      </main>
    );
  if (
    isGatePublicPath(path) ||
    notFound ||
    allowed ||
    !!sessionStorage.getItem("lootsplit.player.reconnect.v1") ||
    invitation ||
    path === "/share"
  )
    // One shape whether or not the notice shows, so the campaign never remounts under it.
    return (
      <>
        {allowed && unchecked && !noticeHidden ? (
          <div
            role="status"
            aria-label="Account check"
            className="fixed inset-x-2 bottom-2 z-50 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-md border border-border bg-elevated p-3 text-sm shadow-lg"
          >
            <p className="min-w-0 flex-1">{UNCHECKED_NOTICE}</p>
            <Button variant="secondary" onClick={() => setIdentityEpoch((x) => x + 1)}>
              Retry
            </Button>
            <Button variant="ghost" onClick={() => setNoticeHidden(true)}>
              Dismiss
            </Button>
          </div>
        ) : null}
        {children}
      </>
    );
  async function resume(member: AccountLibrary["members"][number]) {
    setBusy(true);
    setError("");
    try {
      const result = await accountRequest<AccountMembership>("resume", {
        code: member.code,
        ...(member.closed ? { reopen: true, revision: member.room_revision } : {}),
      });
      await resumeAccountMembership(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to resume campaign.");
    } finally {
      setBusy(false);
    }
  }
  async function claim() {
    const id = activeCampaignId();
    const owner = localStorage.getItem(`quire.owner.${id}`);
    if (!library || (owner && owner !== library.user.id)) return;
    const seat = JSON.parse(
      localStorage.getItem(id === "main" ? "quire.seat.v1" : `quire.seat.v1.${id}`) || "null",
    );
    if (seat?.role === "player") {
      setError("This is a player copy. Resume a campaign you own from My account.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = JSON.parse(localStorage.getItem(`quire.cloud.v2.${id}`) || "null");
      if (saved?.role === "dm" && saved.code && saved.token) {
        const campaigns = JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]");
        await accountRequest("link", {
          code: saved.code,
          token: saved.token,
          name:
            campaigns.find((c: { id: string; name: string }) => c.id === id)?.name || "Campaign",
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
      <h1 className="text-3xl">{library ? "Choose your campaign" : "Welcome to Lootsplitter"}</h1>
      {!library ? (
        <>
          <p>Create an account or sign in to proceed as a Dungeon Master in your own campaign</p>
          <Link to="/account" className="settings-link">
            Create an account or sign in
          </Link>
          <Link to="/share" className="settings-link">
            Join with a current session invitation
          </Link>
        </>
      ) : (
        <>
          <p>Your account owns your campaigns. Choose one to load its saved data.</p>
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
          <Button disabled={busy} variant="secondary" onClick={() => void claim()}>
            Claim this device’s existing DM campaign
          </Button>
          <p className="text-sm">
            Existing device saves are preserved. Claiming enables offline DM play; start a room to
            save the shared campaign to your account.
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {unchecked && (
        <Button variant="secondary" onClick={() => setIdentityEpoch((x) => x + 1)}>
          Retry
        </Button>
      )}
    </main>
  );
}
