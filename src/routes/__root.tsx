import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { OpeningDawn } from "@/components/opening-dawn";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { LibraryProvider } from "@/lib/quire/library";
import { EconomyProvider } from "@/lib/quire/economy-context";
import { PrefsProvider } from "@/lib/quire/prefs";
import appCss from "../styles.css?url";

const APP_NAME = "Lootsplit";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content: "Track campaign money, shops, and prices. Create shops from an item catalog, and read names and prices from PDFs you import.",
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
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <OpeningDawn />
        <AuthProvider>
          <LibraryProvider>
            <PrefsProvider>
              <EconomyProvider>
                <Outlet />
              </EconomyProvider>
            </PrefsProvider>
          </LibraryProvider>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
