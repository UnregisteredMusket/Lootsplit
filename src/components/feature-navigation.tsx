import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Fold } from "./ui";
import { AppLink } from "./app-link";
import { useSeat } from "@/lib/quire/seat";
import { useEconomy } from "@/lib/quire/economy-context";
import { readFinance } from "@/lib/quire/finance";
import { formatCopper } from "@/lib/quire/money";
import { featureScreens, safeReturn, type Feature } from "@/lib/quire/feature-navigation";
export function FeatureLink({
  feature,
  children,
  campaignCode,
}: {
  feature: Feature;
  children?: ReactNode;
  campaignCode?: string;
}) {
  const href = useRouterState({ select: (s) => s.location.href });
  return (
    <AppLink
      className="settings-link"
      href={`/features/${feature}?from=${encodeURIComponent(safeReturn(href))}${campaignCode ? `&code=${encodeURIComponent(campaignCode)}` : ""}`}
    >
      {children || `Open ${featureScreens[feature].title}`} →
    </AppLink>
  );
}
export function FeatureCards({
  desktop = false,
  grouped = false,
}: {
  desktop?: boolean;
  grouped?: boolean;
}) {
  const seat = useSeat(),
    dm = seat.role === "dm";
  const { journal, loans, holdings } = useEconomy();
  const f = readFinance(journal.finance);
  const cards = Object.entries(featureScreens).filter(
    ([id, x]) => (!x.dm || dm) && !(dm && id === "finances"),
  );
  if (grouped && dm)
    return (
      <section className="feature-cards dm-tool-groups" aria-label="Campaign features">
        <h2>Campaign tools</h2>
        <FeatureLink feature="music">Music & Ambience</FeatureLink>
        <Fold title="Sessions & records" hint="Journal, reports, downtime and reviews." defaultOpen>
          <div className="dm-tool-links">
            {(["journal", "reports", "downtime", "review"] as Feature[]).map((id) => (
              <FeatureLink key={id} feature={id}>
                {id === "reports" ? "Reports" : featureScreens[id].title}
              </FeatureLink>
            ))}
          </div>
        </Fold>
        <Fold title="Economy & properties" hint="Bank, shops, property and financial rules.">
          <div className="dm-tool-links">
            {(["bank", "shops", "properties", "financial"] as Feature[]).map((id) => (
              <FeatureLink key={id} feature={id}>
                {featureScreens[id].title}
              </FeatureLink>
            ))}
          </div>
        </Fold>
      </section>
    );
  return (
    <section
      className={desktop ? "feature-desktop-links" : "feature-cards"}
      aria-label="Campaign features"
    >
      {cards.map(([id, x]) => (
        <div className="journal-entry" key={id}>
          {!desktop && (
            <>
              <h2>{x.title}</h2>
              <p className="text-sm text-muted">
                {id === "bank"
                  ? `${loans.filter((l) => l.status === "pending").length + journal.requests.filter((r) => r.status === "pending").length} pending financial requests`
                  : id === "properties"
                    ? `${holdings.filter((h) => h.kind === "property" && h.quantity > 0 && (dm || seat.purseIds.includes(h.purseId))).length} owned properties`
                    : id === "downtime"
                      ? `Campaign day ${f.day} · ${f.downtime.some((d) => d.status === "pending") ? "Approval pending" : "No pending settlement"}`
                      : id === "journal"
                        ? `${journal.entries?.length || 0} visible entries`
                        : id === "finances"
                          ? `Outstanding debt ${formatCopper(f.loans.reduce((s, l) => s + l.principal + l.interest, 0))}`
                          : id === "financial"
                            ? "Economic settings & recurring agreements"
                            : id === "reports"
                              ? "Sessions, activity & financial analysis"
                              : id === "review"
                                ? "Financial requests & character imports"
                                : id === "music"
                                  ? "Device playlists, playback & audio credits"
                                  : "Shop availability & restocking"}
              </p>
            </>
          )}
          <FeatureLink feature={id as Feature}>{desktop ? x.title : `Open ${x.title}`}</FeatureLink>
        </div>
      ))}
    </section>
  );
}
