import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

export function LogoLoading() {
  return (
    <div className="loot-route-loading" role="status" aria-label="Loading Lootsplit">
      <img src="/favicon.svg" width="56" height="56" alt="" />
    </div>
  );
}
export function RouteLoading() {
  const busy = useRouterState({ select: (state) => state.isLoading });
  const [visible, setVisible] = useState(false);
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    const listener = () => setReloading(true);
    window.addEventListener("lootsplit:context-loading", listener);
    return () => window.removeEventListener("lootsplit:context-loading", listener);
  }, []);
  useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 180);
    return () => window.clearTimeout(timer);
  }, [busy]);
  return visible || reloading ? <LogoLoading /> : null;
}
