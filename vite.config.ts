import { accountDevPlugin } from "./scripts/account-dev-plugin.mjs";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
// @ts-expect-error JS plugin alongside the TS vite config
import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";
// @ts-expect-error JS plugin alongside the TS vite config
import { appEnvPlugin } from "./scripts/app-env-plugin.mjs";
// @ts-expect-error JS plugin alongside the TS vite config
import { webChangelogPlugin } from "./scripts/web-changelog-plugin.mjs";

// `0.0.0.0:8080` is the live-preview contract — don't change host/port.
// The dev server starts once `src/router.tsx` and `src/routes/` exist — see
// AGENTS.md § "First scaffold".
export default defineConfig(({ command, isPreview }) => ({
  // Focused snapshots share locked packages, never a running server's dependency cache.
  cacheDir: process.env.LOOTSPLIT_VITE_CACHE_DIR,
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  // Start's generated client imports these after the initial static scan. Prebundle
  // them up front so first-load development checks do not race an optimizer reload.
  optimizeDeps: {
    include: [
      "@tanstack/router-core",
      "@tanstack/router-core/isServer",
      "@tanstack/router-core/ssr/client",
      "seroval",
      "tesseract.js",
    ],
  },
  plugins: [
    accountDevPlugin(),
    // Dev-only /__app-env, read by scripts/check-auth-invariant.mjs.
    appEnvPlugin(),
    // PWA head + ?install=1 tutorial page; runs before Start/Nitro.
    grokPwaPlugin(),
    // Website changelog notes stamped with their deployed commit (main builds only).
    webChangelogPlugin(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview
      ? [
          nitro({
            preset: "cloudflare_module",
            output: { dir: "dist", serverDir: "dist/server", publicDir: "dist/client" },
            // Auto-registers server/middleware/* (the PWA install page +
            // manifest + head-tag middleware). Nitro v3 defaults serverDir to
            // false, so removing this silently unwires /?install=1 on deploys.
            serverDir: "./server",
            // Root wrangler.toml is the deploy config. Nitro must not write a
            // second one that drops the D1 binding.
            cloudflare: { deployConfig: false },
          }),
        ]
      : []),
    viteReact(),
  ],
}));
