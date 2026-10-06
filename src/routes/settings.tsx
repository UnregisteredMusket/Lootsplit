import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { SettingsPage } from "@/components/settings-page";
export const Route = createFileRoute("/settings")({ component: SettingsRoute });
function SettingsRoute() {
  const hash = useRouterState({ select: (s) => s.location.hash }),
    navigate = useNavigate();
  useEffect(() => {
    if (hash === "economy")
      void navigate({
        to: "/features/$feature",
        params: { feature: "financial" },
        search: { from: "/settings", code: undefined },
        replace: true,
      });
  }, [hash, navigate]);
  return <SettingsPage />;
}
