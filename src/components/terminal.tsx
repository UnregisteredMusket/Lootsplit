import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("loot-card rounded-2xl border border-lead/25 bg-elevated p-5", className)}>{children}</section>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="loot-empty rounded-2xl border border-lead/20 px-4 py-6 text-center">
      <p className="font-display text-2xl tracking-tight">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{body}</p>
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
