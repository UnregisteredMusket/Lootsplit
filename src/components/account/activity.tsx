import { useEffect } from "react";
import { accountRequest } from "@/lib/account/client";
/** Visible, signed-in browsing records approximate activity without tracking guests. */
export function MemberActivity() {
  useEffect(() => {
    let stopped = false;
    let busy = false;
    const checkedKey = "lootsplit.activity.checked.v1";
    const record = async () => {
      if (stopped || busy || document.visibilityState !== "visible") return;
      // Survive full-page navigation: frequent page visits must not multiply auth probes.
      const checked = Number(sessionStorage.getItem(checkedKey) || 0);
      if (Date.now() - checked < 240000) return;
      sessionStorage.setItem(checkedKey, String(Date.now()));
      busy = true;
      try {
        const session = await accountRequest<{ user?: unknown } | null>("auth/get-session");
        if (!stopped && session?.user) await accountRequest("activity");
      } catch {
        /* Optional activity must not interrupt local play. */
      } finally {
        busy = false;
      }
    };
    void record();
    const timer = setInterval(() => void record(), 240000);
    const visible = () => void record();
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return null;
}
