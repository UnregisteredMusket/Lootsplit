import { LocationNpcs } from "@/components/location-npcs";
import { CampaignTrading } from "@/components/campaign-trading";
import { SessionTime } from "@/components/session-time";
import { getCampaigns, serverCampaigns, subscribeCampaigns } from "@/lib/quire/campaigns";
import { CampaignReports } from "@/components/campaign-reports";
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useSyncExternalStore } from "react";
import { Shell } from "@/components/shell";
import { AppLink } from "@/components/app-link";
import {
  featureScreens,
  safeReturn,
  screenName,
  type Feature,
} from "@/lib/quire/feature-navigation";
import { useSeat } from "@/lib/quire/seat";
import { CampaignFinance } from "@/components/campaign-finance";
import { CampaignJournal, PriceHistory } from "@/components/campaign-journal";
import { CampaignOperations } from "@/components/campaign-operations";
import { JournalNotes } from "@/components/journal-notes";
import { LoanAskForm } from "@/components/market-board";
import { PersonalFinances } from "@/components/personal-finances";
import { PropertyDetails } from "@/components/property-details";
import { PropertyOperationReviews } from "@/components/property-operations";
import { PropertyMarketplace } from "@/components/property-marketplace";
import { CharacterImportReviews } from "@/components/character-import-reviews";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { SettingsPage } from "@/components/settings-page";
import { LocalAudioPanel } from "@/components/local-audio-panel";
// Load exchange editors only for this screen. Downtime shares the small review
// without pulling every market editor into startup.
const TradeEconomyPanel = lazy(() =>
  import("@/components/trade-economy").then((m) => ({ default: m.TradeEconomyPanel })),
);
export const Route = createFileRoute("/features/$feature")({
  validateSearch: (
    s: Record<string, unknown>,
  ): {
    from: string;
    code: string | undefined;
    npc?: string;
    exchange?: string;
    commodity?: string;
  } => ({
    from: safeReturn(s.from),
    code: typeof s.code === "string" ? s.code.slice(0, 24) : undefined,
    npc: typeof s.npc === "string" ? s.npc.slice(0, 150) : undefined,
    exchange: typeof s.exchange === "string" ? s.exchange.slice(0, 150) : undefined,
    commodity: typeof s.commodity === "string" ? s.commodity.slice(0, 150) : undefined,
  }),
  component: FeaturePage,
});
function FeaturePage() {
  const { feature } = Route.useParams(),
    { from, code } = Route.useSearch(),
    seat = useSeat(),
    dm = seat.role === "dm";
  const campaigns = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const screen = Object.hasOwn(featureScreens, feature)
    ? featureScreens[feature as Feature]
    : undefined;
  return (
    <Shell>
      <div
        className="feature-screen"
        key={`${campaigns.activeId}:${room.code}:${room.sessionId}:${seat.role}:${seat.purseIds.join(",")}:${feature}`}
      >
        <h1>{screen?.title || "Feature unavailable"}</h1>
        {!screen || (screen.dm && !dm) ? (
          <p>This screen is available to the campaign DM.</p>
        ) : (
          <>
            {feature === "npcs" && <LocationNpcs />}
            {feature === "economy" && (
              <Suspense fallback={<p role="status">Loading trade exchanges…</p>}>
                <TradeEconomyPanel />
              </Suspense>
            )}
            {feature === "trading" && <CampaignTrading />}
            {feature === "time" && <SessionTime />}
            {feature === "music" && <LocalAudioPanel />}
            {feature === "bank" && (
              <>
                <p>
                  {dm
                    ? "Loan officer desk · applications, terms and repayments"
                    : "Banking services · loans, repayments and financial requests"}
                </p>
                {dm ? (
                  <CampaignFinance section="bank" />
                ) : (
                  <>
                    <PersonalFinances bank />
                    <h2>Apply for a loan</h2>
                    <LoanAskForm />
                  </>
                )}
                <CampaignJournal section="bank" />
              </>
            )}
            {feature === "finances" &&
              (dm ? <CampaignJournal section="reports" /> : <PersonalFinances />)}
            {feature === "downtime" && (
              <>
                <AppLink className="settings-link" href="/features/properties">
                  Property Management →
                </AppLink>
                <CampaignFinance section="downtime" />
                <CampaignJournal section="sessions" />
              </>
            )}
            {feature === "financial" && (
              <>
                <CampaignFinance section="settings" />
                <SettingsPage financial />
              </>
            )}
            {feature === "properties" && (
              <>
                <AppLink
                  className="settings-link"
                  href="/features/economy?from=%2Ffeatures%2Fproperties"
                >
                  Trade Exchanges · stored goods & seasonal prices →
                </AppLink>
                <PropertyMarketplace />
                <PropertyDetails plans />
              </>
            )}
            {feature === "shops" && (
              <>
                <AppLink className="settings-link" href="/market">
                  Open Market & stock →
                </AppLink>
                <CampaignOperations section="shops" />
              </>
            )}
            {feature === "journal" && <JournalNotes />}
            {feature === "reports" && (
              <>
                <CampaignReports />
                <CampaignJournal section="reports" />
                <PriceHistory />
                <AppLink className="settings-link" href="/party?section=funds">
                  Open full ledger & funds →
                </AppLink>
              </>
            )}
            {feature === "review" && (
              <>
                <PropertyOperationReviews />
                {(!code || code === room.code) && <CampaignJournal section="bank" reviewOnly />}
                {code || room.joined ? (
                  <CharacterImportReviews code={code || room.code} />
                ) : (
                  <p>Open a shared session to review account character imports.</p>
                )}
                <AppLink className="settings-link" href="/party">
                  Character permissions & editing →
                </AppLink>
                <AppLink className="settings-link" href="/share">
                  Manual report imports & recovery →
                </AppLink>
              </>
            )}
          </>
        )}
        <footer className="feature-return">
          <AppLink className="quick-action" href={from}>
            Return to {screenName(from, dm)}
          </AppLink>
        </footer>
      </div>
    </Shell>
  );
}
