import type { ChangeEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";
import "./checkbox.css";

/**
 * A checkbox with a 44 px label row and a 24 px box (design plan M1, A7; WCAG 2.5.8). The whole
 * row is the hit area. `label` is the accessible name unless `aria-label` is given.
 */
export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  hint,
  className,
  "aria-label": ariaLabel,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean, event: ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  hint?: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <label className={cn("checkbox-row", disabled && "is-disabled", className)}>
      <input
        type="checkbox"
        className="checkbox-box"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.checked, event)}
      />
      <span className="checkbox-text">
        {label}
        {hint ? <span className="checkbox-hint">{hint}</span> : null}
      </span>
    </label>
  );
}
