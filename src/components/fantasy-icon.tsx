import type { CSSProperties } from "react";
import { resolveFantasyIcon, type IconEntry } from "@/lib/icons/resolve";
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
  const icon = resolveFantasyIcon(entry, { ui, categoryOnly });
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
