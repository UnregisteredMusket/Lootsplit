import { forwardRef, type DetailsHTMLAttributes, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import "./disclosure.css";

/**
 * The one disclosure look (design plan, dm-mobile #18): a consistent chevron, focus ring, hit area
 * and spacing for everything that opens and closes.
 *
 * - `section`: a bordered card with the title on the left and the chevron on the right (the same
 *   look as `Fold`), for a block of a screen.
 * - `inline`: a compact row with the chevron before the text, for a detail inside a block.
 *
 * It wraps native `<details>`/`<summary>`, so it opens without JavaScript and in the Android
 * WebView, keeps the browser's own keyboard handling, and passes `open`, `onToggle`, `id` and a
 * ref straight through (hash anchors such as `useDisclosureAnchor` keep working).
 */
export type DisclosureVariant = "section" | "inline";

export const Disclosure = forwardRef<
  HTMLDetailsElement,
  Omit<DetailsHTMLAttributes<HTMLDetailsElement>, "title"> & {
    summary: ReactNode;
    variant?: DisclosureVariant;
    summaryClassName?: string;
    bodyClassName?: string;
  }
>(function Disclosure(
  { summary, variant = "section", className, summaryClassName, bodyClassName, children, ...props },
  ref,
) {
  return (
    <details ref={ref} {...props} className={cn("disclosure", `disclosure-${variant}`, className)}>
      <summary className={cn("disclosure-summary", summaryClassName)}>
        {variant === "inline" && <DisclosureChevron />}
        <span className="disclosure-title">{summary}</span>
        {variant === "section" && <DisclosureChevron />}
      </summary>
      <div className={cn("disclosure-body", bodyClassName)}>{children}</div>
    </details>
  );
});

/** The shared chevron: down when closed; it turns when the disclosure opens. */
export function DisclosureChevron({ className }: { className?: string }) {
  return <ChevronDown aria-hidden="true" className={cn("disclosure-chevron", className)} />;
}
