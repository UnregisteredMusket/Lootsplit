import { Link, useRouter } from "@tanstack/react-router";
import type { AnchorHTMLAttributes } from "react";

/** Route app-owned paths without reloading the document; retain query/hash destinations. */
export function AppLink({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const router = useRouter();
  const url = new URL(href, "https://lootsplit.invalid");
  return (
    <Link
      {...props}
      to={url.pathname as never}
      search={router.options.parseSearch!(url.search) as never}
      hash={url.hash.slice(1)}
    />
  );
}
