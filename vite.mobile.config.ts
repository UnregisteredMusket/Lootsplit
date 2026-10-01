import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Client-only package for Capacitor. The Cloudflare Worker build stays on vite.config.ts
 * and keeps writing dist/client and dist/server. This config writes beside that output
 * so a mobile build cannot replace the Worker bundle.
 * Server-function IDs come from the same Start compiler. boot.ts sends them to the live Worker.
 * There is no Capacitor server.url.
 */
export default defineConfig({
  build: { outDir: "dist/mobile-build" },
  plugins: [
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
        prerender: { outputPath: "/index.html", crawlLinks: false },
      },
      serverFns: { disableCsrfMiddlewareWarning: true },
    }),
    viteReact(),
  ],
  resolve: { tsconfigPaths: true },
});
