import { PlayerDisplayProvider } from "@/components/player-display-controller";
import { CampaignGate } from "@/components/account/campaign-gate";
import { MobileOwnerWidgetBridge } from "@/components/account/mobile-owner-widget";
import { AppNotifications } from "@/components/app-notifications";
import { RouteLoading } from "@/components/route-loading";
import { DialogHost } from "@/components/confirm-dialog";
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
import { QuestUpdateToasts } from "@/components/quest-toasts";
import { PrefsProvider } from "@/lib/quire/prefs";
import { MenuAudioBridge } from "@/components/menu-audio-bridge";
import { installMobileApi } from "@/lib/mobile/boot";
import { useEffect } from "react";
import { APP_VISITOR_COOKIE } from "@/lib/deployment/public-urls.mjs";
import { SplitViewProvider, usePane } from "@/components/split-view";
import { retainBeside } from "@/lib/quire/split-view";
import { NotFoundPage } from "@/components/website/not-found";
import { NOT_FOUND_TITLE, isUnmatchedRoute, useUnmatchedRoute } from "@/lib/website/not-found-route";
import appCss from "../styles.css?url";

const APP_NAME = "Lootsplitter";

export const Route = createRootRoute({
  // Navigation in the main (left) pane keeps the split-view pane beside it.
  search: { middlewares: [retainBeside] },
  head: ({ matches }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      // An unknown address gets its own tab title (W-1); every page route sets its own.
      { title: isUnmatchedRoute(matches) ? NOT_FOUND_TITLE : APP_NAME },
      ...(isUnmatchedRoute(matches) ? [{ name: "robots", content: "noindex" }] : []),
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
  notFoundComponent: NotFoundPage,
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
    "/privacy",
    "/community",
  ].includes(pathname.replace(/\/$/, "")) || pathname.startsWith("/community/");
  const playerDisplay = pathname.replace(/\/$/, "") === "/player-display";
  // My account and the not-found page are drawn in website chrome, so the app's title screen
  // never stands in front of them (W-1). My account still marks the browser as an app visitor,
  // as it always has; a broken link does not.
  const accountPage = pathname.replace(/\/$/, "") === "/account";
  const notFound = useUnmatchedRoute();
  installMobileApi();
  const appPage = !publicPage && !playerDisplay && !notFound;
  useEffect(() => {
    // Opening the app marks this browser as a returning player, so the bare address skips the
    // public home page next time (landingRedirect in public-urls.mjs). Public pages never set it.
    if (!appPage) return;
    try {
      document.cookie = `${APP_VISITOR_COOKIE}=1; Path=/; Max-Age=34560000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    } catch {
      // Cookies blocked: the bare address shows the home page, whose "Open the app" still works.
    }
  }, [appPage]);
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
        {/* Themed confirm/prompt dialogs for every screen and the split-view pane (audit D7). */}
        <DialogHost />
        {playerDisplay ? (
          <Outlet />
        ) : (
          <OpeningGate publicPage={publicPage || accountPage || notFound} settle={accountPage}>
            <AuthProvider>
              <CampaignGate>
                <LibraryProvider>
                  <PrefsProvider>
                    <MenuAudioBridge />
                    <EconomyProvider>
                      <PlayerDisplayProvider>
                        <AppNotifications />
                        <QuestUpdateToasts />
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

function OpeningGate({
  publicPage,
  settle,
  children,
}: {
  publicPage: boolean;
  settle: boolean;
  children: React.ReactNode;
}) {
  return (
    <OpeningDawn bypass={publicPage} settle={settle}>
      {children}
    </OpeningDawn>
  );
}
