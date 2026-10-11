import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import type { AnchorHTMLAttributes } from "react";
import { appLinkDestination } from "@/lib/quire/feature-navigation";

/** Route app-owned paths without reloading the document; retain query/hash destinations. */
export function AppLink({
  href,
  returnLink = false,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; returnLink?: boolean }) {
  const router = useRouter();
  const currentHref = useRouterState({ select: (state) => state.location.href });
  const url = appLinkDestination(href, currentHref, !returnLink);
  return (
    <Link
      {...props}
      to={url.pathname as never}
      search={router.options.parseSearch!(url.search) as never}
      hash={url.hash.slice(1)}
    />
  );
}
