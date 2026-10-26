/**
 * One record in a list (design plan D3, shared): icon, name, a meta line (holder, category),
 * badges, quantity, value and a ⋯ menu of actions. Optional select checkbox for bulk actions and
 * an expand toggle for stacked rows. Used by Party → Funds & inventory; reusable for any list of
 * records (shop stock, NPCs, quests).
 */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { useContext, type ReactNode } from "react";
import { AppLink } from "./app-link";
import { OverlayContainer } from "./overlay-container";
import { cn } from "@/lib/cn";
import "./record-row.css";

export type RecordMenuItem =
  | {
      label: string;
      onSelect: () => void;
      tone?: "danger";
      /** Shown greyed with this reason; the item cannot be chosen. */
      disabledReason?: string;
    }
  | { label: string; href: string; disabledReason?: string; tone?: undefined };

export function RecordRow({
  id,
  icon,
  title,
  meta,
  badges,
  quantity,
  value,
  detail,
  menu,
  menuLabel,
  select,
  expand,
  className,
  children,
}: {
  id?: string;
  icon: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  badges?: ReactNode;
  quantity?: ReactNode;
  value?: ReactNode;
  detail?: ReactNode;
  menu?: RecordMenuItem[];
  /** Accessible name of the ⋯ button, e.g. "Actions for Longbow". */
  menuLabel?: string;
  select?: { checked: boolean; onChange: (checked: boolean) => void; label: string; indeterminate?: boolean };
  expand?: { open: boolean; onToggle: () => void; label: string };
  className?: string;
  /** Rows shown under this one (an expanded stack). */
  children?: ReactNode;
}) {
  const overlay = useContext(OverlayContainer);
  const items = menu?.filter(Boolean) ?? [];
  return (
    <li id={id} className={cn("record-row", select?.checked && "is-selected", className)}>
      <div className="record-row-main">
        {select ? (
          <label className="record-row-select">
            <input
              type="checkbox"
              checked={select.checked}
              ref={(el) => {
                if (el) el.indeterminate = !!select.indeterminate && !select.checked;
              }}
              onChange={(event) => select.onChange(event.target.checked)}
              aria-label={select.label}
            />
          </label>
        ) : null}
        <span className="record-row-icon">{icon}</span>
        <span className="record-row-body">
          <span className="record-row-title">
            <strong>{title}</strong>
            {badges ? <span className="record-row-badges">{badges}</span> : null}
          </span>
          {meta ? <span className="record-row-meta">{meta}</span> : null}
          {detail ? <span className="record-row-detail">{detail}</span> : null}
        </span>
        <span className="record-row-figures">
          {quantity !== undefined ? <span className="record-row-qty">{quantity}</span> : null}
          {value !== undefined ? <span className="record-row-value">{value}</span> : null}
        </span>
        {expand ? (
          <button
            type="button"
            className="record-row-button"
            aria-expanded={expand.open}
            aria-label={expand.label}
            onClick={expand.onToggle}
          >
            <ChevronDown size={18} aria-hidden="true" className={expand.open ? "rotate-180" : ""} />
          </button>
        ) : null}
        {items.length ? (
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="record-row-button" aria-label={menuLabel ?? "Actions"}>
                <MoreHorizontal size={18} aria-hidden="true" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal container={overlay ?? undefined}>
              <DropdownMenu.Content
                className="split-menu record-row-menu"
                align="end"
                sideOffset={6}
                aria-label={menuLabel ?? "Actions"}
              >
                {items.map((item) =>
                  "href" in item ? (
                    <DropdownMenu.Item
                      key={item.label}
                      asChild
                      disabled={!!item.disabledReason}
                      className="split-menu-item"
                    >
                      <AppLink href={item.href}>
                        {item.label}
                        {item.disabledReason ? <small>{item.disabledReason}</small> : null}
                      </AppLink>
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
      {children ? <ul className="record-row-children">{children}</ul> : null}
    </li>
  );
}
