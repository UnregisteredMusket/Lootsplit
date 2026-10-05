import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Toaster, toast } from "sonner";
import { usePrefs } from "@/lib/quire/prefs";

/** One host per document: route mounts must not replay active toast history. */
export function AppNotifications() {
  const { prefs } = usePrefs();
  const location = useRouterState({ select: (state) => state.location.href });
  const previous = useRef(location);
  useEffect(() => {
    if (previous.current !== location) {
      for (const item of toast.getToasts()) {
        if (!("type" in item) || item.type !== "loading") toast.dismiss(item.id);
      }
      previous.current = location;
    }
  }, [location]);
  return (
    <Toaster
      theme={prefs.appearance === "light" ? "light" : "dark"}
      position="top-center"
      closeButton
      duration={4000}
    />
  );
}
