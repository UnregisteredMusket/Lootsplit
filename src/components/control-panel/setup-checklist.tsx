import { useState } from "react";
import { Check, X } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { useEconomy } from "@/lib/quire/economy-context";
import { campaignSetupSteps, setupDismissKey, showCampaignSetup } from "@/lib/quire/campaign-setup";

function readDismissed(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** Desk: "Set up your campaign" for a new campaign (design D4 / dm #16). Dismissal is per device. */
export function DeskSetupChecklist({ campaign, online }: { campaign: string; online: boolean }) {
  const { ready, purses, shops, journal } = useEconomy();
  const key = setupDismissKey(campaign);
  const [dismissed, setDismissed] = useState(() => readDismissed(key));
  if (!ready) return null;
  const steps = campaignSetupSteps({ purses, shops, journal, online });
  if (!showCampaignSetup(steps, journal, dismissed)) return null;
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="desk-setup" aria-labelledby="desk-setup-heading">
      <div className="desk-setup-heading">
        <h2 id="desk-setup-heading">Set up your campaign</h2>
        <small>
          {done} of {steps.length} done
        </small>
        <button
          type="button"
          className="desk-setup-dismiss"
          aria-label="Hide the setup checklist"
          title="Hide the setup checklist"
          onClick={() => {
            try {
              localStorage.setItem(key, "1");
            } catch {
              // Private windows may refuse storage; hiding still lasts for this visit.
            }
            setDismissed(true);
          }}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <ol>
        {steps.map((step) => (
          <li key={step.id} className={step.done ? "done" : undefined}>
            <span className="desk-setup-mark" aria-hidden="true">
              {step.done && <Check size={14} />}
            </span>
            <span className="desk-setup-text">
              <strong>
                {step.label}
                {step.done && <span className="sr-only"> (done)</span>}
              </strong>
              {!step.done && <small>{step.hint}</small>}
            </span>
            {!step.done && (
              <AppLink href={step.href} className="desk-setup-link">
                {step.action} →
              </AppLink>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
