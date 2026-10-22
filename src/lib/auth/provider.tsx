import type { ReactNode } from "react";

/**
 * App-wide client provider mounted once near the root (in `src/routes/__root.tsx`):
 *
 *   <AuthProvider><Outlet /></AuthProvider>
 *
 * A passthrough today (accounts are served by the Worker's Better Auth in
 * `cloudflare/accounts.mjs` and need no client context). It's kept as the
 * single, stable mount point for any future client-side providers (e.g. a
 * toast or theme provider) without churning the root shell.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
