import { useEffect, useSyncExternalStore, type CSSProperties } from "react";
import {
  iconLookup,
  loadIconCatalog,
  resolveFantasyIcon,
  subscribeIconCatalog,
  type IconEntry,
} from "@/lib/icons/resolve";

/**
 * The SRD icon tables load on demand (audit F5). The server render and hydration use none
 * (`getServerSnapshot`), so both draw the same family/category icon; the record's own icon replaces
 * it once the tables arrive. Later renders use them straight away.
 */
const serverLookup = () => null;
export function FantasyIcon({
  entry,
  ui,
  categoryOnly = false,
  className = "",
  size = 32,
}: {
  entry?: IconEntry;
  ui?: string;
  categoryOnly?: boolean;
  className?: string;
  size?: number;
}) {
  const lookup = useSyncExternalStore(subscribeIconCatalog, iconLookup, serverLookup);
  // UI symbols and category-only icons never need the record tables.
  const needsLookup = !ui && !categoryOnly;
  useEffect(() => {
    if (needsLookup && !iconLookup()) loadIconCatalog().catch(() => {});
  }, [needsLookup]);
  const icon = resolveFantasyIcon(entry, { ui, categoryOnly, lookup });
  return (
    <span
      aria-hidden="true"
      className={`fantasy-icon ${className}`}
      data-icon={icon.icon}
      style={{ "--icon-color": icon.color, "--icon-size": `${size}px` } as CSSProperties}
    >
      <span
        className="fantasy-icon-glyph"
        style={{ maskImage: `url("${icon.src}")`, WebkitMaskImage: `url("${icon.src}")` }}
      />
    </span>
  );
}
