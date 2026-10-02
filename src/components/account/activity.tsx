import { useEffect } from "react";
import { accountRequest } from "@/lib/account/client";
/** Visible, signed-in browsing records approximate activity without tracking guests. */
export function MemberActivity() {
  useEffect(() => {
    let stopped = false;
    let busy = false;
    const record = async () => {
      if (stopped || busy || document.visibilityState !== "visible") return;
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
