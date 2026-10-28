/**
 * One header for the main feature screens (design plan, dm-mobile "Feature page headers vary"):
 * eyebrow, title and an optional line under it on the left; the primary action and a ⋯ overflow
 * menu on the right (they wrap under the title on narrow phones). Screens keep their own h1 text.
 */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { useContext, type ReactNode } from "react";
import { AppLink } from "./app-link";
import { OverlayContainer } from "./overlay-container";
import type { RecordMenuItem } from "./record-row";
import { cn } from "@/lib/cn";
import "./feature-header.css";

export function FeatureHeader({
  eyebrow,
  title,
  subtitle,
  primary,
  overflow,
  overflowLabel,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** The screen's main action(s), e.g. a Button. */
  primary?: ReactNode;
  /** Secondary destinations or actions, in a ⋯ menu. */
  overflow?: RecordMenuItem[];
  /** Accessible name of the ⋯ button. */
  overflowLabel?: string;
  className?: string;
}) {
  const overlay = useContext(OverlayContainer);
  const items = overflow?.filter(Boolean) ?? [];
  return (
    <header className={cn("feature-header", className)}>
      <div className="feature-header-text">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="feature-header-title">{title}</h1>
        {subtitle ? <div className="feature-header-subtitle">{subtitle}</div> : null}
      </div>
      {primary || items.length ? (
        <div className="feature-header-actions">
          {primary}
          {items.length ? (
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="feature-header-more"
                  aria-label={overflowLabel ?? "More actions"}
                >
                  <MoreHorizontal size={20} aria-hidden="true" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal container={overlay ?? undefined}>
                <DropdownMenu.Content
                  className="split-menu record-row-menu"
                  align="end"
                  sideOffset={6}
                  aria-label={overflowLabel ?? "More actions"}
                >
                  {items.map((item) =>
                    "href" in item ? (
                      <DropdownMenu.Item
                        key={item.label}
                        asChild
                        disabled={!!item.disabledReason}
                        className="split-menu-item"
                      >
                        <AppLink href={item.href}>{item.label}</AppLink>
                      </DropdownMenu.Item>
                    ) : (
                      <DropdownMenu.Item
                        key={item.label}
                        className={cn("split-menu-item", item.tone === "danger" && "is-danger")}
                        disabled={!!item.disabledReason}
                        onSelect={() => item.onSelect()}
                      >
                        {item.label}
                        {item.disabledReason ? <small>{item.disabledReason}</small> : null}
                      </DropdownMenu.Item>
                    ),
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
