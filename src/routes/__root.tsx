import { CampaignGate } from "@/components/account/campaign-gate";
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
import appCss from "../styles.css?url";

const APP_NAME = "Lootsplit";

export const Route = createRootRoute({
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
  component: function RootDocument() {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const publicPage = [
      "/welcome",
      "/downloads",
      "/updates",
      "/help",
      "/resources",
      "/donate",
    ].includes(pathname.replace(/\/$/, ""));
    installMobileApi();
    return (
      <html lang="en" suppressHydrationWarning>
        <head>
          <HeadContent />
        </head>
        <body>
          <PreviewHostBridge />
          <MemberActivity />
          <RouteLoading />
          <OpeningGate publicPage={publicPage}>
            <AuthProvider>
              <CampaignGate><LibraryProvider>
                <PrefsProvider>
                  <MenuAudioBridge />
                  <EconomyProvider>
                    <AppNotifications />
                    <Outlet />
                  </EconomyProvider>
                </PrefsProvider>
              </LibraryProvider></CampaignGate>
            </AuthProvider>
          </OpeningGate>
          <Scripts />
        </body>
      </html>
    );
  },
});

function OpeningGate({ publicPage, children }: { publicPage: boolean; children: React.ReactNode }) {
  return <OpeningDawn bypass={publicPage}>{children}</OpeningDawn>;
}
