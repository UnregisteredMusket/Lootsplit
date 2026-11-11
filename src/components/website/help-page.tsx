import { HelpContent } from "../help-content";
import { PageHero } from "./parts";
import { Website } from "./site";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/website/contact";

export function HelpPage() {
  return (
    <Website>
      <PageHero kicker="The Lootsplitter field guide" title="A little help, adventurer.">
        <p className="ls-lead ls-measure">
          Menus, money, encounters and recovery. Find a topic and jump straight to the tool you
          need.
        </p>
        <p className="ls-fine">
          Still stuck, or have feedback? Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
        </p>
      </PageHero>
      <section className="ls-ink ls-section ls-section-tight">
        <div className="ls-wrap ls-reading ls-help-guide">
          <HelpContent />
        </div>
      </section>
    </Website>
  );
}
