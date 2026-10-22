import { PlayerDisplayProvider } from "@/components/player-display-controller";
import { CampaignGate } from "@/components/account/campaign-gate";
import { MobileOwnerWidgetBridge } from "@/components/account/mobile-owner-widget";
import { AppNotifications } from "@/components/app-notifications";
import { RouteLoading } from "@/components/route-loading";
import { APP_DESCRIPTION } from "@/lib/help/content";
import { MemberActivity } from "@/components/account/activity";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { OpeningDawn } from "@/components/opening-dawn";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { LibraryProvider } from "@/lib/quire/library";
import { EconomyProvider } from "@/lib/quire/economy-context";
import { PrefsProvider } from "@/lib/quire/prefs";
import { MenuAudioBridge } from "@/components/menu-audio-bridge";
import { installMobileApi } from "@/lib/mobile/boot";
import { SplitViewProvider, usePane } from "@/components/split-view";
import { retainBeside } from "@/lib/quire/split-view";
import appCss from "../styles.css?url";

const APP_NAME = "Lootsplitter";

export const Route = createRootRoute({
  // Navigation in the main (left) pane keeps the split-view pane beside it.
  search: { middlewares: [retainBeside] },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      {
        name: "description",
        content: APP_DESCRIPTION,
      },
      { name: "theme-color", content: "#10182c" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: function RootComponent() {
    // The right split-view pane renders this route tree inside the existing document.
    return usePane() ? <Outlet /> : <RootDocument />;
  },
});

function RootDocument() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const publicPage = [
    "/welcome",
    "/features",
    "/downloads",
    "/updates",
    "/help",
    "/resources",
    "/donate",
  ].includes(pathname.replace(/\/$/, ""));
  const playerDisplay = pathname.replace(/\/$/, "") === "/player-display";
  installMobileApi();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Development-only render profiler, opt in with VITE_REACT_SCAN=1 (docs/AGENT-TOOLING.md).
            It must load before React; production builds drop this branch entirely. */}
        {import.meta.env.DEV && import.meta.env.VITE_REACT_SCAN === "1" ? (
          <script src="https://unpkg.com/react-scan@0.5.7/dist/auto.global.js" crossOrigin="anonymous" />
        ) : null}
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        {import.meta.env.VITE_MOBILE === "true" && <MobileOwnerWidgetBridge />}
        {!playerDisplay && <MemberActivity />}
        <RouteLoading />
        {playerDisplay ? (
          <Outlet />
        ) : (
          <OpeningGate publicPage={publicPage}>
            <AuthProvider>
              <CampaignGate>
                <LibraryProvider>
                  <PrefsProvider>
                    <MenuAudioBridge />
                    <EconomyProvider>
                      <PlayerDisplayProvider>
                        <AppNotifications />
                        <SplitViewProvider>
                          <Outlet />
                        </SplitViewProvider>
                      </PlayerDisplayProvider>
                    </EconomyProvider>
                  </PrefsProvider>
                </LibraryProvider>
              </CampaignGate>
            </AuthProvider>
          </OpeningGate>
        )}
        <Scripts />
      </body>
    </html>
  );
}

function OpeningGate({ publicPage, children }: { publicPage: boolean; children: React.ReactNode }) {
  return <OpeningDawn bypass={publicPage}>{children}</OpeningDawn>;
}
