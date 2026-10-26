import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("loot-card rounded-2xl border border-lead/25 bg-elevated p-5", className)}>{children}</section>;
}

/**
 * The shared empty state (design D9): an optional icon, a title, one sentence that says what to do
 * next, and an optional action. Use it instead of a zero or an empty list.
 */
export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("loot-empty rounded-2xl border border-lead/20 px-4 py-6 text-center", className)}>
      {icon ? (
        <div className="loot-empty-icon mx-auto mb-2 flex justify-center text-lead" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p className="font-display text-2xl tracking-tight">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function MoneyLine({ copper, label }: { copper: number; label: string }) {
  const sign = copper > 0 ? "+" : copper < 0 ? "−" : "";
  const tone = copper > 0 ? "text-positive" : copper < 0 ? "text-negative" : "text-muted";
  return (
    <span className={cn("tabular-nums", tone)}>
      {sign}
      {label}
    </span>
  );
}
