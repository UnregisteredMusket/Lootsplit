import { Link } from "@tanstack/react-router";
import { Website } from "./site";
import { PageHero } from "./parts";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/website/contact";

/** Shown at the top of the policy; change it (and add a Changelog note) whenever the text changes. */
export const PRIVACY_UPDATED = "October 23, 2026";

const Support = () => <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>;

/**
 * The privacy policy (website prompt #3, W4). Owner decisions 2026-10-23: run by and
 * named as UnregisteredMusket; account deletion by email within 30 days; not directed
 * at children under 13. Keep it in step with what the code actually stores.
 */
export function PrivacyPage() {
  return (
    <Website>
      <PageHero kicker="Plain words, no fine print" title="Privacy at Lootsplitter">
        <p className="ls-lead ls-measure">
          Lootsplitter is a free tabletop campaign manager run by one person, UnregisteredMusket.
          It has no ads, no trackers and no analytics scripts, and it never sells or shares your
          information for marketing.
        </p>
        <p className="ls-fine">Last updated {PRIVACY_UPDATED}</p>
      </PageHero>
      <section className="ls-paper ls-section ls-section-tight" aria-label="Privacy policy">
        <div className="ls-wrap ls-reading ls-privacy">
          <p>This page explains what Lootsplitter stores, where, for how long and how to remove it.</p>

          <h2 id="device">What stays on your device</h2>
          <p>
            If you play without an account, or in Local mode, your campaigns live only in your
            browser or the Android app. Lootsplitter’s server never receives them. This also covers:
          </p>
          <ul>
            <li>private PDF books and your audio library;</li>
            <li>preferences and map views;</li>
            <li>device backups you save.</li>
          </ul>
          <p>
            If you clear site data or uninstall the app, these are deleted. Export a backup to keep
            a copy.
          </p>

          <h2 id="server">What the server stores when you use an account or a shared room</h2>
          <ul>
            <li>
              <strong>Your account:</strong> your name and email address, your password (stored
              only as a secure hash), and when you signed up.
            </li>
            <li>
              <strong>Your profile, if you fill it in:</strong> an introduction, a portrait, and a
              contact email you choose to share.
            </li>
            <li>
              <strong>Sign-in sessions:</strong> each session stores the IP address and browser
              description it started from, to keep your account secure. Sessions last up to 30
              days.
            </li>
            <li>
              <strong>Shared campaigns:</strong> the campaigns you host or join, including
              characters, funds, inventory, maps, images and chat. Cloud backups you make of them
              are stored too.
            </li>
            <li>
              <strong>Bug reports you send:</strong> your message. You choose whether to add
              technical details (app version, platform, browser and screen size), and you see a
              preview before sending.
            </li>
            <li>
              <strong>Notifications, if you turn them on:</strong> your browser’s push address for
              that campaign.
            </li>
          </ul>

          <h2 id="security">Security limits</h2>
          <p>To stop password guessing and abuse, Lootsplitter keeps short-lived records:</p>
          <ul>
            <li>
              <strong>Request limits</strong> are keyed by a scrambled (hashed) form of your IP
              address and deleted within an hour of disuse.
            </li>
            <li>
              <strong>Failed sign-ins</strong> are counted against a hashed form of your email
              address and deleted a day after the last attempt, once any wait has ended.
            </li>
          </ul>

          <h2 id="cookies">Cookies</h2>
          <p>Lootsplitter uses only these cookies:</p>
          <ul>
            <li>
              <strong>Sign-in cookies</strong> (named <code>lootsplit…</code>) keep you signed in.
            </li>
            <li>
              <strong>The <code>lootsplit-app</code> cookie</strong> remembers that this browser has
              opened the app, so the plain address goes straight to it.
            </li>
          </ul>
          <p>It sets no advertising or tracking cookies.</p>

          <h2 id="others">Who else handles data</h2>
          <ul>
            <li>
              <strong>Cloudflare</strong> hosts the website and its database, and forwards email
              sent to <Support />. On the website, signing in, creating an account and resetting a
              password with a recovery key include Cloudflare Turnstile, a human check that
              usually needs no clicks; Cloudflare receives technical signals from your browser to
              run it.
            </li>
            <li>
              <strong>Open5e:</strong> when you search monsters, spells or items from the SRD, your
              browser asks api.open5e.com directly.
            </li>
            <li>
              <strong>Ko-fi:</strong> donations are handled by Ko-fi, on its own site.
            </li>
            <li>
              <strong>GitHub:</strong> the Android app file is published on GitHub.
            </li>
          </ul>

          <h2 id="public-numbers">Public numbers</h2>
          <p>
            The home page can show one combined total of coins spent across all shared campaigns.
            It never names a person or a campaign.
          </p>

          <h2 id="deleting">Deleting your data</h2>
          <ul>
            <li>
              <strong>Campaigns:</strong> you can delete them yourself. Lootsplitter keeps a
              recovery copy first, in case a deletion was a mistake.
            </li>
            <li>
              <strong>Your account:</strong> to delete it and everything linked to it, email{" "}
              <Support /> from your account’s email address. Your account is deleted within 30
              days.
            </li>
            <li>
              <strong>Bug reports</strong> remain without your name attached.
            </li>
          </ul>

          <h2 id="children">Children</h2>
          <p>
            Lootsplitter is not directed at children under 13. If you believe a child under 13 has
            created an account, email <Support /> and it will be removed.
          </p>

          <h2 id="changes">Changes and contact</h2>
          <p>
            If this policy changes, the date at the top changes and the{" "}
            <Link to="/updates">Changelog</Link> says so. Questions go to <Support />.
          </p>
        </div>
      </section>
    </Website>
  );
}
