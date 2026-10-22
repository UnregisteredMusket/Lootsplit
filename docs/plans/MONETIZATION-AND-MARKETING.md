# Monetization and marketing plan

Research date: 2026-10-22. Research only: nothing was signed up for, posted, changed or deployed. Every price, fee and policy links to its source with the date checked. Revenue figures are **estimates**, labelled as such; replace them with real numbers after a month.

Companion document: `docs/audit/2026-10-22-domain-migration-audit.md`, which covers the domain, the rename and the cutover.

## Owner decisions (2026-10-22)

- **Lootsplitter stays free.** No feature, platform or saved data goes behind a payment. This matches CLAUDE.md's feature-preservation rule.
- **The Donate page stays.** Donations are optional, and the page stays a plain outbound link with no embedded payment widget.
- **Paid cosmetic perks and ads are not being pursued.** The research on them is kept below for reference.
- **The app is renamed Lootsplitter, at lootsplitter.com** (see the audit). Marketing waits for the rename, so posts go out under the final name and address.

### Still open (OWNER DECISION)

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | Donation platform for the Donate page. The page currently says "Donations aren't open yet". | **Ko-fi**: 0% fee on one-off donations, a public/private supporter choice, and familiar to TTRPG players. Optionally add **GitHub Sponsors**: 0% from personal accounts, and the repository is public. |
| 2 | Opt-in "Supporters" credits page | Yes, maintained by hand from names supporters chose to make public. |
| 3 | Affiliate list (DriveThruRPG, marked "Paid link") on a public Resources page | Optional. Expect about $0–5 a month. It's useful mainly as a resource list. |
| 4 | Privacy-friendly analytics | **Cloudflare Web Analytics**, on public pages only, with a privacy notice. |
| 5 | AI-development disclosure wording | Needed for r/dndnext and similar rules. Suggested: "I build it with an AI coding assistant; I design and review every release." |
| 6 | Channels and order | r/rpg, then r/DMAcademy (after taking part in the community), r/dndnext once, r/DungeonMasters on a Friday, r/digitaltabletop, r/rpg_generators, AlternativeTo, itch.io. Skip r/DnD unless its mods approve. |
| 7 | Official Discord, Product Hunt launch, Google Play | Not now. Revisit Play before the 2027 Android developer verification. |
| 8 | SEO landing pages, sitemap, per-page metadata, privacy notice | Yes. The sitemap, canonical tags and per-page descriptions overlap with audit finding P2-9. |

## Baseline: what Lootsplitter costs to run

Production readback on 2026-10-22 at 13:01 UTC: a read-only SELECT of the owner monitor's latest `cloudflare-usage` reading.

| Metric (billing cycle since Oct 11, 37% elapsed) | Used | Workers Paid included | Share |
| --- | --- | --- | --- |
| Worker requests | 69,223 | 10,000,000 | 0.69% |
| Worker CPU time | 1,717,310 ms | 30,000,000 ms | 5.7% |
| D1 rows read | 22,575,426 | 25,000,000,000 | 0.09% |
| D1 rows written | 134,420 | 50,000,000 | 0.27% |
| D1 storage | 47.0 MB | 5 GB | 0.94% |

- **Users:** 3 accounts and 12 shared rooms. Much of the request volume comes from the minute monitoring cron, the multiplayer probe and CI live audits, not from users.
- **Running cost:** the flat **Workers Paid $5 a month** ([pricing](https://developers.cloudflare.com/workers/platform/pricing/)), with no overage, plus **lootsplitter.com at about $10.46 a year**. That's roughly **$70 a year**.
- **Break-even:** about 1–2 small donations a month.

## Ranked shortlist: the next month

1. **Open donations.**
   - **What:** point the Donate page at Ko-fi, optionally add GitHub Sponsors, and add an opt-in Supporters credits page.
   - **Cost and effort:** $0, size S (an owner setting plus a small page).
   - **Expected effect (estimate):** $0–30 a month, enough to cover hosting.
   - **Owner:** create a Ko-fi account linked to PayPal or Stripe, then set the Donate URL on the owner account page.
   - No CSP or privacy change while it stays a plain link.
2. **Launch quietly after the rename.**
   - **What:** list on AlternativeTo, post once on r/rpg with the "Self Promotion" flair, list on itch.io as a free tool, and send a short note to Rascal News.
   - **Cost and effort:** $0, a few hours of the owner's time.
   - **Expected effect (estimate):** tens to a few hundred visitors, plus the first real feedback.
   - **Owner:** approve the AI disclosure wording, then post personally. Reddit rules require posts in your own words.
   - Before posting, ship the SEO basics (sitemap, canonical tags, per-page titles and descriptions) and a privacy notice. Both are small engineering tasks.
3. **Measure it.**
   - **What:** Cloudflare Web Analytics, loaded only by the public website pages, with automatic SPA tracking off and a route-scoped CSP.
   - **Cost and effort:** $0, size M (route-scoped CSP, audit proof that nothing fires in the app, a privacy notice).
   - **Expected effect:** you'll know which channel works.
   - **Owner:** approve the CSP change and the privacy notice text.

## Comparison of all researched options

Size: S under a day, M a few days, L a week or more.

| Option | Setup cost / fees | Revenue (estimate, 500–3,000 visitors a month) | Privacy and CSP impact | Size | Fit | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Donations (Ko-fi; GitHub Sponsors, Liberapay, Buy Me a Coffee, Patreon) | $0. Ko-fi 0% on one-off donations; BMC 5%; Patreon 10%; plus about 3% + $0.30 processing | $0–30 a month | None as a plain link | S | Good | **Chosen** |
| Cosmetic supporter perks (Stripe Payment Links / Lemon Squeezy / Paddle) | 2.9% + 30¢ (Stripe, you handle tax) or 5% + 50¢ (merchant of record) | $0–40 a month | None with a redirect checkout; needs entitlements tables and a webhook | M | OK | **Not pursued** (stays free) |
| Google Play listing | $25 one-time; 12 testers for 14 days; Data safety form; API 36; fees 10% + 5% | None directly; reach only | Data safety form and privacy policy | M | Good reach | Later |
| Ads (EthicalAds / Carbon / AdSense / AdMob) | EthicalAds needs 50k page views a month; Carbon invite-only; AdSense needs a certified consent banner | $1–20 a month | AdSense adds tracking and many CSP hosts | M–L | Poor | **Not pursued** |
| Static sponsor slot (TTRPG publisher) | $0 | $20–100 a month (weak basis) | None (first-party image and link, "Sponsored" label) | S | OK | Possible later |
| Affiliate list (DriveThruRPG; Amazon unsuitable) | $0; up to 5% store credit | $0–5 a month | None (outbound links only) | S | OK | Open decision |
| Partner content packs (SRD 5.1/5.2.1 CC-BY, ORC) | Licensing work | $0 at first | None; credits in `resources.ts` | M | Good for reach | Later |

The detailed research follows. Marketing drafts are in "Ready-to-post drafts" below; they use the new name, so post them only after the rename and cutover.

---

## Part A: Monetization research (reference)

### Revenue estimate basis (applies to every estimate below)

Traffic is assumed to be **500 to 3,000 visitors a month, about 1,000 to 8,000 page views**. Estimates use these assumptions, not measured Lootsplit data:
- About **0.1% to 0.5%** of monthly visitors give money.
- The typical gift is **$3 to $5**.
- Display ads earn **$1 to $3 per 1,000 page views**. The low end comes from the Carbon and EthicalAds published figures below, and AdSense at hobby scale is similar.
- Affiliate links convert **0 to 5** sales a month.

All revenue figures are **ESTIMATES** and should be replaced with real numbers after one month.

---

### 1. Donations

| Platform | Platform fee | Processing | Payout | Public supporter recognition |
|---|---|---|---|---|
| Ko-fi | **0%** on one-off donations (Free plan). **5%** on shop, memberships, commissions and monthly tips. Turning on "Standard mode" adds 5% to donations too. [help.ko-fi.com](https://help.ko-fi.com/hc/en-us/articles/360002506494-Does-Ko-fi-take-a-fee) (checked 2026-10-22) | The PayPal or Stripe fee is charged on top, "typically around 3% + $0.30" (same source) | Money goes straight into the owner's own PayPal or Stripe account (same source) | Yes. There is a public feed of names and messages, and each supporter picks public or private. Guests show as "Somebody". [help.ko-fi.com](https://help.ko-fi.com/hc/en-us/articles/360009392953-What-information-do-supporters-share-Public-private-options) (checked 2026-10-22) |
| Buy Me a Coffee | **5%** | Stripe 2.9% + $0.30, plus 0.5% payout processing, 1% on international payments and 0.5% on subscriptions. Supporters can choose to cover the fees. [help.buymeacoffee.com](https://help.buymeacoffee.com/en/articles/8105744-how-to-calculate-charges-on-your-payment) (checked 2026-10-22) | Paid to a bank account (same source) | Supporter feed on the page. Its privacy controls were not verified. |
| GitHub Sponsors | **0%** from personal accounts. Up to 6% from organisations (3% card fee plus 3% GitHub fee). No PayPal since 2023-02-23. [docs.github.com](https://docs.github.com/en/sponsors/sponsoring-open-source-contributors/about-sponsorships-fees-and-taxes) (checked 2026-10-22) | Included in the above | Stripe payout (the payout page was not fetched) | Yes. Each sponsor chooses public or private, and one-time sponsors stay visible for one month (same source) |
| Patreon | **10%** for pages published after 2025-08-04 [support.patreon.com](https://support.patreon.com/hc/en-us/articles/11111747095181-Creator-fees-overview) (checked 2026-10-22) | Card or US PayPal 2.9% + $0.30. Non-US PayPal 3.9% + $0.30. EUR 3.4% + €0.35. Currency conversion 2.5% (same source) | US: Stripe $0.25 per payout. PayPal 1% (minimum $0.25, maximum $20) with a $10 payout minimum. Payoneer $1 with a $25 minimum (same source) | Patron list on the page |
| Liberapay | **0%**. It is funded by donations to itself. [liberapay.com/about/faq](https://liberapay.com/about/faq) (checked 2026-10-22) | Average about 3% for Stripe and about 5% for PayPal (same source) | Paid directly to the owner's own Stripe or PayPal (same source) | Yes. A public patron count, a top-patron list and a CSV export, e.g. [liberapay.com/davidrevoy](https://liberapay.com/davidrevoy/) (checked 2026-10-22). Donations are weekly or recurring and amounts are anonymous by design. |

- **Setup cost:** $0 on every platform.
- **Revenue (ESTIMATE):** $0 to $30 a month. Basis: 500 to 3,000 visitors × 0.1–0.5% × $3–5, which is roughly 0 to 6 gifts.
- **Privacy and CSP:** No impact if the Donate page stays a plain outbound HTTPS link. Do **not** embed the Ko-fi or BMC overlay widgets, because those add third-party script and iframe sources to the CSP. No campaign data leaves Lootsplit.
- **Engineering:** **S.** The Donate page already exists. An optional "Supporters" credits page can be filled in by hand from names that supporters chose to make public. Do not scrape it automatically.
- **Fit with the audience:** Good. Ko-fi is common among TTRPG creators.
- **Risks:** Platform terms can change (Patreon's 2025 fee change is an example), and processor fees take a large share of small gifts.
- **Best pick:** Ko-fi (0% on one-off donations, a public or private supporter feed, and TTRPG familiarity). GitHub Sponsors (0%) is a good addition if the repository is public.

### 2. Optional cosmetic supporter perks (additive only)

| Provider | Fees | Merchant of record / tax | Payout |
|---|---|---|---|
| Stripe Payment Links | 2.9% + 30¢ (US cards), +1.5% for international cards, +1% for currency conversion. Payment Links cost nothing extra. Stripe Tax Basic is 0.5% per transaction where registered. **Managed Payments (merchant of record): +3.5%** on top. [stripe.com/pricing](https://stripe.com/pricing) (checked 2026-10-22) | Plain Stripe: the owner is the seller and handles VAT/sales tax. With Managed Payments, Stripe is the merchant of record. | Stripe pays to the owner's bank account |
| Lemon Squeezy | **5% + 50¢**, no monthly fee, with "small additional fees" possible outside the US [lemonsqueezy.com/pricing](https://www.lemonsqueezy.com/pricing) (checked 2026-10-22) | Merchant of record. It collects, files and pays sales tax and VAT (same source). | Bank or PayPal, twice a month (same source) |
| Paddle | **5% + 50¢**. Products **under $10 must contact sales** for pricing. [paddle.com/pricing](https://www.paddle.com/pricing) (checked 2026-10-22) | Merchant of record, handles tax filing (same source) | Not stated on the page |

**Cost of a $3 perk:**
- Plain Stripe: about $0.39 (13%), with the owner liable for tax.
- Lemon Squeezy: $0.65 (22%), with tax handled.

For an EU or UK seller of digital goods, a merchant of record removes VAT registration work. That matters more than the fee difference.

#### Server-side entitlement sketch

All of this fits within the existing rules: additive migration, server-side authorisation, idempotent commands.

1. The account page links to a Payment Link with the account ID attached. Stripe sends `checkout.session.completed`, which is the documented fulfilment event. [docs.stripe.com/payment-links/post-payment](https://docs.stripe.com/payment-links/post-payment?dashboard-or-api=api) (checked 2026-10-22)
   - To tie the payment to the account, append `?client_reference_id=<opaque account id>` to the link. This parameter is documented on Stripe's url-parameters page, which was not fetched in this check.
   - Lemon Squeezy and Paddle use custom checkout data the same way.
2. The Worker gets a new route, `POST /api/billing/webhook`. It:
   - verifies the HMAC signature with Web Crypto against a secret held as a Worker secret
   - rejects stale timestamps
   - stores the provider `event.id` in a `billing_events` table with a UNIQUE constraint, so retries do nothing (idempotent)
3. In the same D1 transaction it inserts an `entitlements(account_id, perk_id, source, provider_ref, granted_at, revoked_at)` row. Refund or dispute webhooks set `revoked_at`. Rows are never deleted, so history is preserved.
4. A new migration, `NNNN_entitlements.sql`, adds the tables with CREATE TABLE and is additive only.
5. `GET /api/account/entitlements` is session-authenticated. The client only *renders* themes, frames and icons that the server lists. Any shared-room cosmetic, such as a portrait frame other players can see, is validated server-side on write.
6. Perk assets are first-party static assets with credits in `resources.ts`. No third-party script is needed and the checkout is a redirect, so there is **no CSP change**. Stripe receives only the account ID and the buyer's own payment details, never campaign data.

- **Engineering:** **M**, made up of the webhook, two tables, the account UI, asset packs and tests.
- **Revenue (ESTIMATE):** $0 to $40 a month, on the same visitor basis with a $3–5 price.
- **Risks:**
  - Perks must never gate features (a hard constraint).
  - Refunds and chargebacks need handling.
  - Being merchant of record yourself creates tax obligations.

#### Google Play rules for perks (only if the app ships on Play)

- Digital items such as "add-on items, characters, or avatars" bought **inside** a Play app must use Play Billing. [support.google.com/…/10281818](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en) (checked 2026-10-22)
- A Play app may not link to a page that leads to another payment method, except through the programs below (same source).
- A Play app *may* be **consumption-only**: users log in and get content they paid for elsewhere, with no in-app purchase links (same source).
- Tips need no Play Billing **only if 100% goes to the creator and nothing is granted, not even badges** (same source). A supporter badge given for a donation would therefore break this exemption inside a Play app.
- The US alternative-billing program has been reporting and paying fees since 2026-10-01. Fees are 10% on the first $1M, otherwise 20% (new installs) or 25% (existing installs). [support.google.com/…/16497028](https://support.google.com/googleplay/android-developer/answer/16497028?hl=en) (checked 2026-10-22)
- The **sideloaded APK is not subject to Play policy.**

### 3. Google Play

**Registration and testing**
- **US$25 one-time** registration fee. Personal accounts may need a government ID, a credit card in the owner's name, and Android-device verification. [support.google.com/…/6112435](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en) (checked 2026-10-22)
- **Testing requirement** for personal accounts created after 2023-11-13: **12 testers opted in continuously for the preceding 14 days** in a closed test before applying for production. [support.google.com/…/14151465](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en) (checked 2026-10-22)

**Store requirements**
- **Data safety form** is required for every published app, including closed and open tracks, even when no data is collected. A privacy policy URL is required. [support.google.com/…/10787469](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en) (checked 2026-10-22)
- **Target API:** from 2026-08-31, new apps and updates must target **API 36 (Android 16)**. Extensions to 2026-11-01 can be requested. [developer.android.com/…/target-sdk](https://developer.android.com/google/play/requirements/target-sdk) (checked 2026-10-22)

**Fees (the 15%/30% tiers are superseded in the US)**
- From 2026-06-30 in the US, EEA and UK, service fees for new installs are:
  - 10% on the first $1M of annual earnings
  - otherwise 20% for one-off purchases and 10% for subscriptions
  - **plus a 5% Play Billing fee**
  
  [support.google.com/…/16954621](https://support.google.com/googleplay/android-developer/answer/16954621?hl=en); [Android Developers Blog 2026-03](https://android-developers.googleblog.com/2026/03/a-new-era-for-choice-and-openness.html) (both checked 2026-10-22)
- In practice a small developer pays **10% + 5% = 15%** through Play Billing, or 10% through alternative billing or external links.

**Paid app vs free with in-app purchases**
- A paid app would gate the whole app and violate the no-paywall rule.
- Free with optional cosmetic in-app purchases is the only acceptable model.

**Sideloading outlook**
- Android developer verification starts 2026-09-30 in Brazil, Indonesia, Singapore and Thailand, and expands globally to "all apps on certified Android devices" in **2027**.
- Play apps are mostly registered automatically. Apps outside Play use the Android Developer Console.
- A free "limited distribution" option allows up to 20 devices.

[developer.android.com/developer-verification](https://developer.android.com/developer-verification) (checked 2026-10-22). The sideloaded APK will need verification in 2027 either way.

**Assessment**
- **Reach:** Play discoverability and auto-updates, versus manual APK installs and "unknown sources" friction.
- **Engineering:** **M**, made up of an AAB build, target API 36, store listing, Data safety, privacy policy and recruiting 12 testers.
- **Revenue:** none directly.
- **Risk:** Play policy review applies to every update.

### 4. Ads on public pages only

| Network | Eligibility | Revenue share / CPM | Payout |
|---|---|---|---|
| EthicalAds | **At least 50,000 page views a month**, with occasional exceptions [ethicalads.io/publishers/faq](https://www.ethicalads.io/publishers/faq/). It targets developer audiences. | Publisher keeps **70%**, about **$2.50 CPM** for EU and North American traffic. One ad per page, CTR of at least 0.1%. [ethicalads.io/publisher-policy](https://www.ethicalads.io/publisher-policy/) (both checked 2026-10-22) | **$50 minimum**, monthly |
| Carbon Ads (BuySellAds) | Invitation only. Developer and designer audience. **Exclusive** (no other ads allowed). [carbonads.net/faq](https://www.carbonads.net/faq) (checked 2026-10-22) | **$1.20–$2.30 CPM** (same source) | PayPal $20 minimum |
| Google AdSense | Open | Publisher gets **80%** (about 68% for Google Ads buyers) [support.google.com/adsense/answer/180195](https://support.google.com/adsense/answer/180195?hl=en) (checked 2026-10-22) | Threshold not checked |

**Consent and child-audience rules**
- AdSense, Ad Manager and AdMob require a **Google-certified IAB TCF CMP** for personalised ads in the EEA and UK (since 2024-01-16) and Switzerland (since 2024-07-31). [support.google.com/adsense/answer/13554116](https://support.google.com/adsense/answer/13554116?hl=en) (checked 2026-10-22)
- US state privacy laws, such as opt-out of "sale/sharing", add a further layer. Not researched in depth.
- AdMob in a Play app with a child or mixed audience may use only **Families Self-Certified Ads SDKs**, with no interest-based ads or remarketing, and must comply with COPPA. [support.google.com/…/9893335](https://support.google.com/googleplay/android-developer/answer/9893335?hl=en) (checked 2026-10-22)

**CSP and privacy cost**
- AdSense adds several Google script, frame and connect origins plus a CMP script. It sets cookies and does cross-site tracking, which is a large security and privacy cost.
- EthicalAds adds one script and one API origin and does no tracking, but Lootsplit is not eligible.

**Revenue (ESTIMATE)**
- At 1,000–8,000 page views on public pages only, **$1–$20 a month** at $1–3 RPM.
- EthicalAds' $50 minimum would take months to reach even if admitted.

**Verdict: ads are not worth it at this traffic.**
- **Direct sponsorship** is the exception: a static, first-party "Sponsored by [TTRPG publisher]" image and link on the public welcome page. It has no script and no CSP change, needs an FTC-style "Sponsored" label, and could bring $20–100 a month. That figure is an ESTIMATE based on typical indie micro-sponsorships, and the basis is weak.
- **Engineering:** S for a static slot, M or more for AdSense with a CMP.

### 5. Affiliate links

- **DriveThruRPG**
  - Terms: **up to 5%** standard, up to 8% for community content and publishing partners. The purchase must happen within 15 days of the click.
  - Payment is store credit, which can be cashed out by PayPal minus $1.
  - No brand-keyword bidding, and no implying you represent the store.
  - [help.drivethrupartners.com](https://help.drivethrupartners.com/hc/en-us/articles/12780762767767-Affiliate-Program-FAQ) (checked 2026-10-22). The page does not mention DMs Guild, so that is not verified.
- **Humble Bundle:** **8%** per sale, 30-day cookie, $50 threshold, run through CJ. Source is a third-party aggregator, [getlasso.co](https://getlasso.co/affiliate/humble-bundle/) (checked 2026-10-22), because no official page was found. **Treat as unverified.**
- **Amazon Associates**
  - Sales must ship and be paid within 180 days. Links may not be used in client-side apps other than approved free store apps, and **must not render Amazon pages in WebViews**. No offline or ebook use. Sites "directed at children under 13" are excluded.
  - [affiliate-program.amazon.com/…/participation](https://affiliate-program.amazon.com/help/operating/participation/) (checked 2026-10-22)
  - The Capacitor app is a WebView, which makes Amazon a poor fit.
- **FTC disclosure:** the disclosure must be clear and **near the link**. "I get commissions for purchases made through links in this post" or "Paid link" next to the link is adequate. "Affiliate link" alone is not. [ftc.gov](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking) (checked 2026-10-22)
- **Privacy:** affiliate IDs are in the outbound URL only. No script, so no CSP impact. Never put campaign data in link parameters.
- **Revenue (ESTIMATE):** $0–$5 a month, from 0–5 sales × $10–20 × 5%.
- **Engineering:** **S**, for example a "Recommended resources" list on a public page.

### 6. Sponsored or partner content packs

- **SRD 5.1:** fully CC-BY-4.0. WotC also left **OGL 1.0a "in place, as is. Untouched"** and says it cannot revoke the CC licence. [dndbeyond.com/posts/1439](https://www.dndbeyond.com/posts/1439-ogl-1-0a-creative-commons) (checked 2026-10-22)
- **SRD 5.2.1:** CC-BY-4.0. The required attribution reads:
  > "This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode."
  - Do not add any other Wizards attribution.
  - "Compatible with fifth edition" / "5E compatible" is permitted.
  - [SRD 5.2.1 PDF](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf) (checked 2026-10-22)
- **ORC License:** perpetual, held by Azora Law, Library of Congress TX 9-307-067. It needs:
  - an ORC Notice
  - an Attribution Notice, including upstream licensors
  - a Reserved Material Notice
  - an Expressly Designated Licensed Material Notice

  Art, characters, settings and proper nouns are Reserved by default. OGL content cannot be relicensed under ORC unless the publisher released it as such. [paizo.com/orclicense](https://paizo.com/orclicense) (checked 2026-10-22)
- **What a small publisher can license to Lootsplit:**
  - Its **own** original items, shops, NPCs and loot tables, by direct written licence (exclusive or not, for a fee or revenue share), or by releasing them under CC-BY or ORC.
  - SRD-derived parts carry the SRD attribution.
  - Lootsplit must not use D&D trademarks or logos (not covered by the SRD).
- **Credit:** every pack gets an entry in `src/lib/website/resources.ts` (source, licence, attribution text).
- **Engineering:** **M**, for a pack import format, a credits display and the licence record.
- **Revenue (ESTIMATE):** $0 at first. Packs are mainly a reach and partnership tool. Paid sponsorship of a pack is possible but speculative.

---

## Part B: Marketing channels, drafts and analytics

### How this was checked

- **Shipped features** were checked against the repo clone at `/home/claude/lootsplit`: `docs/FEATURE-INVENTORY.md` (dated sections through 2026-10-22), `src/components/website/features.tsx` (the public Features tour), `src/components/website/downloads.tsx`, `src/components/website/site.tsx`, `docs/NPC-BARTER.md`, `src/lib/website/release.json` (Android 1.9.3, versionCode 16, dated 2026-10-22) and `cloudflare/release-assets.mjs` (the CSP).
- **Reddit rules.** reddit.com, old.reddit.com and Reddit mirror pages were blocked from this sandbox (HTTP 403, or the fetch was refused). Most rule text below is quoted from the ThreadFox Reddit rules index, a third-party copy of each subreddit's sidebar rules, which records the date it read each one. Each entry gives both that date and Reddit's own rules URL. Before posting, re-read the live sidebar, because moderators change rules and the live text always wins. r/DnDBehindTheScreen is not in that index, and its rules could not be read at all.
- **Blocked URLs to report:** `reddit.com/r/*/wiki/rules`, `reddit.com/r/*/about/rules`, `web.archive.org` copies of the r/rpg wiki, the `pol1.lr.ggtyler.dev` and `teddit` mirrors, `itch.io/docs/creators/faq`, and the `threadfox.vip/rules/*` pages through WebFetch (those were then read with curl).

#### Facts from the repo that limit what may be claimed

| Claim | Status | Evidence |
|---|---|---|
| Five coin denominations, party purses, player and NPC accounts, shared inventory, activity ledger with voiding | Shipped | features.tsx "Loot & money" |
| Encounter loot from guaranteed items and weighted tables, reviewed, then one transfer; a repeated request returns the existing receipt | Shipped | FEATURE-INVENTORY "DM encounter desk" (one D1 transaction, unique award receipt) |
| Shops, Trade Exchanges, player-to-player trading and barter with counteroffers, black markets, blacksmith commissions | Shipped | features.tsx "Shops, trade & barter" |
| NPC barter in conversation, with a server-rolled Charisma (Persuasion) check | Shipped 2026-10-22 | FEATURE-INVENTORY "NPC barter in conversation"; docs/NPC-BARTER.md |
| Properties, ships, shipyards and voyages during downtime | Shipped | features.tsx "NPCs, property & ships" |
| Maps with fog, pings, tokens, walls, doors, lights and vision; optional TV display | Shipped | features.tsx "Encounters & maps" |
| Downtime (a day to ten years) applied after DM preview; Review Inbox | Shipped | features.tsx "Sessions & downtime" |
| Local, Turn-based and Live modes; guests join without an account; accounts optional | Shipped | features.tsx "Play together" |
| Android app (signed APK, Android 7.0+), offline device campaigns | Shipped | downloads.tsx; site.tsx ("The DM can work offline on an owned device campaign; shared sessions need a connection") |
| Android home-screen widgets | Shipped, **owner-only** | The widgets are the owner's Field monitor and its 4×1 companion, which show server and development monitoring. They are not player features, so do not market them to players. |
| Split view at 1024 px and wider | Shipped 2026-10-21 | FEATURE-INVENTORY "Split view" |
| Price | Free; donations are optional and not yet open | donate.tsx ("You can keep using Lootsplit without donating"; "Donations aren't open yet") |
| A "split loot evenly" button | **Not shipped. Do not claim it.** | No even-split command in `src/lib/quire` |
| On Google Play | **No.** The APK is distributed from GitHub releases through /downloads. | release.json |
| Rules content | SRD 5.1 (2014) and SRD 5.2 (2024) through Open5e, with attribution | resources.ts |

**AI disclosure (OWNER DECISION).** Lootsplit is developed with an AI coding agent (the repo has CLAUDE.md, `.claude/` hooks and agent-tooling docs). This matters for Reddit:

- r/dndnext requires that projects "made with the use of AI" disclose it.
- r/DnD bans AI content and "mentions of AI tools".
- r/rpg_generators bans AI-generation *tools*. Its rule says AI in the tech stack is acceptable but content should be non-AI.

Decide on one honest disclosure line and use it wherever a rule asks for one. **Do not post to r/DnD** unless the moderators, once told about the AI-assisted development, still approve the post.

---

### 1. Reddit

#### Requested subreddits

| Subreddit | Members* | Self-promotion rule (quoted or summarized) | Rules page, and when the rule text was read | Fit for Lootsplit |
|---|---|---|---|---|
| r/DnD | 4.30M | "All promos must be Mod Approved. Any time you intend to post any self-promotion, message the mods ahead of time… whether you are charging for them or not." It also has "No AI, at all… mentions of AI tools". Media posts need [OC]/[Art] and a description of 400+ characters, and Thursdays are text-only. | [Reddit rules](https://www.reddit.com/r/DnD/about/rules); [ThreadFox copy, read 2026-10-05](https://threadfox.vip/rules/dnd) (checked 2026-10-22) | Low. Mod pre-approval is required, and the AI rule conflicts with AI-assisted development. **OWNER DECISION** whether to ask the mods at all. |
| r/DMAcademy | 712K | Rule 3: "Promotion, Advertising & External Links are restricted to active community members… All links must be described in detail. For every external link/advertisement you share, you should be participating in at least 10 other conversations… No pay walls." Rule 2: "Resources must be a completed tool… Posts for the same resource are limited to once a month." Text posts only. | [Reddit rules](https://www.reddit.com/r/DMAcademy/about/rules); [ThreadFox copy, read 2026-10-05](https://threadfox.vip/rules/dmacademy); same text in a [wiki mirror](https://axebps-redlib.hf.space/r/DMAcademy/wiki/index) (checked 2026-10-22) | Medium. Only after real participation, about 10 helpful comments per link. Write it as a "Resource" text post that explains *how* to run party money, with the link as a secondary detail. |
| r/rpg | 1.60M | "*Active* members may promote their own content once per week." Crowdfunding is limited to one announcement and one reminder. Use the **Self Promotion** flair for your own content ("makes it easier for the mods to keep eyes on excessive self-promotion"). Rule 9: you need 100+ subreddit karma to post *about* AI. Posting is limited to approved users. | [Reddit wiki rules §7](https://www.reddit.com/r/rpg/wiki/rules#wiki_7._limit_self-promotion); [ThreadFox copy, read 2026-09-26](https://threadfox.vip/rules/rpg); [flair wiki mirror](https://pol1.lr.ggtyler.dev/r/rpg/wiki/flair) (checked 2026-10-22) | Medium. Allowed weekly for active members with the flair. r/rpg is system-agnostic, so lead with campaign economy rather than D&D. |
| r/dndnext | 830K | Rule 5: "Any self-promotional external links… must be related to D&D and posted no more than once. You can post self-promotion of a different item every 14 days. Referral or affiliate links are never allowed. Projects that were made with the use of AI or use AI in the background must have this information disclosed." Use the **Self-Promotion** flair (rule 7). Text posts only, AI-written posts are banned, and link posts need commentary. | [Reddit rules](https://www.reddit.com/r/dndnext/about/rules); [subrules wiki mirror](https://r.datuan.dev/r/dndnext/wiki/subrules); [ThreadFox copy, read 2026-10-06](https://threadfox.vip/rules/dndnext) (checked 2026-10-22) | Medium. One post about Lootsplit, ever (later posts must be about a *different* item, 14 days apart). It needs the flair and the AI disclosure, and you must write the post yourself. |
| r/DnDBehindTheScreen | ~552K ([GummySearch](https://gummysearch.com/r/DnDBehindTheScreen)) | **Could not be verified.** Reddit was blocked and the ThreadFox index has no entry. The community describes itself as a place to "trade tools, guides and resources". | [Reddit rules](https://www.reddit.com/r/DnDBehindTheScreen/about/rules) (not read) | Unknown. Read the sidebar and wiki first. It historically favours full-text resources posted in the body, so a write-up like "a downtime economy you can run" would fit better than a link post. |

\*Member counts are from the ThreadFox index at the dates shown, except r/DnDBehindTheScreen, whose count is from GummySearch.

#### Suggested additional subreddits (rules from the [ThreadFox index CSV](https://threadfox.vip/rules.csv), checked 2026-10-22)

| Subreddit | Members | Rule | Why |
|---|---|---|---|
| r/rpg_generators | 9.5K | "Max of one self-promotion post per week"; "No AI-generation tools or art"; a monthly self-promo thread ([rules](https://www.reddit.com/r/rpg_generators/about/rules), read 2026-10-11; [mirror](https://redlib.groet-infra.nl/r/rpg_generators)) | Loot tables and shop stock generation fit. Lootsplit is not an AI-generation tool. |
| r/DungeonMasters | 144K | "Patreon, Kickstarter and any Advertising posts are limited to Fridays only" ([rules](https://www.reddit.com/r/DungeonMasters/about/rules), read 2026-10-12) | Post a DM-tool announcement on a Friday. |
| r/DnD5e | 110K | "No More Than One Promotional Post Without Usable Homebrew Every 14 Days"; one post per 24 h ([rules](https://www.reddit.com/r/DnD5e/about/rules), read 2026-10-12) | Medium-sized and D&D 5e specific. |
| r/digitaltabletop | 19K | "Self promotion is allowed for digital tabletop games, but generally no more than twice in a month" ([rules](https://www.reddit.com/r/digitaltabletop/about/rules), read 2026-10-13) | Explicitly allows it. |
| r/VTT | 12.5K | Only a "[commercial]" tag rule for paid items ([rules](https://www.reddit.com/r/VTT/about/rules), read 2026-10-11) | The maps, fog and online tabletop features fit. Lootsplit is free, so no tag is needed. |
| r/SideProject | 868K | No promotion rule; project posts with build detail are welcome ([rules](https://www.reddit.com/r/SideProject/about/rules), read 2026-10-12) | A developer audience rather than players. Good for a build story. |

**Avoid:**

- r/lfg and r/rpg_gamers: their promotion rules do not allow this.
- r/DungeonsAndDragons: "Self-promotion is not allowed".
- r/tabletopgamedesign: "Do not market your game here".
- r/FoundryVTT: "Do not advertise for… another VTT".
- r/dndmemes: off-topic for this.

**Ground rules for every subreddit:**

- Disclose "I'm the developer".
- Post from an account with real participation history (unpublished AutoModerator karma and age limits are common).
- Give one link only, with no referral codes.
- Answer every comment.
- Never post the same text to several subreddits on the same day (Reddit's site-wide spam filter flags this).

---

### 2. Other channels

| Channel | What it is and what applies (checked 2026-10-22) | Recommendation |
|---|---|---|
| **Discord** | The [Tabletop Tools Discord](https://discord.gg/YUGEj3xHwm) is a community for people who build TTRPG tools, templates and platforms, started for an itch.io tool jam ([announcement](https://itch.io/jam/tabletop-game-tool-jam/topic/3126666/would-you-like-a-discord)). Large servers (for example the [r/dndnext Discord](https://discord.gg/dndnext) and [Foundry VTT](https://discord.com/servers/foundry-vtt-170995199584108546)) usually have a #self-promo or #showcase channel with their own rules. Foundry's server is for Foundry, so do not advertise a competing tool there. | Join first and post only in showcase or self-promo channels. **OWNER DECISION:** whether to open an official Lootsplit Discord. There is none today, and the site links none. Running one means moderating it, and a privacy policy should cover it. |
| **itch.io** | You can list a free project. The classification "Other" accepts a custom noun such as "tool". An upload can be an HTML5 embed or "just links to external websites" ([getting started](https://itch.io/docs/creators/getting-started)). The revenue share is open, 10% by default and adjustable from 0% to 100%. PayPal and Stripe charge about $0.30 + 2.9% per paid transaction ([payments](https://itch.io/docs/creators/payments)). A free listing has no fees. | List as a free "tool" with an external link to the website, plus the signed APK as a download, or link to /downloads. Do **not** embed the app in an itch iframe: the CSP sets `frame-ancestors 'self'`, so an embed would not load anyway. Add tags such as `ttrpg`, `dnd`, `gm-tool` and `tabletop`. Enter tool jams. **OWNER DECISION** (it creates another download channel that has to stay in step with releases). |
| **Product Hunt** | Launch at 12:01 am Pacific; Tuesday or Wednesday is common. The tagline should be ≤ 60 characters. Post a maker's first comment straight away. Never ask directly for upvotes, and never buy votes (penalized or banned). You don't need a hunter if you have some account history. ([2026 guide](https://app.getlaunchlist.com/blog/how-to-launch-on-product-hunt-2026)) Image sizes change, so check the live launch form ([Screenhance, updated 2026-09-01](https://screenhance.com/blog/product-hunt-launch-visuals)). | Product Hunt's audience is general tech, so expect a modest result. Prepare 4–6 gallery images from `public/product/*.webp`, a 60–90 s demo video, a square thumbnail, and a first comment that mentions it's free and says what isn't built yet. **OWNER DECISION** (a public launch day needs you available all day to answer comments). |
| **AlternativeTo** | Anyone with an account can suggest an app ("Suggest new application"). Admins review submissions in a few days to a week, and developers can claim admin rights by proving ownership. Rejections include closed betas and "small personal sites". Do not pay or offer incentives for upvotes. Licence choice: "Free". ([FAQ](https://alternativeto.net/faq)) | List it with the platforms Online and Android. Then suggest it as an alternative on the pages of similar campaign, party-inventory and loot trackers. Low effort and long-lived. |
| **Newsletters and press** | [The Indie RPG Newsletter](https://ttrpg.substack.com/about): weekly, "thousands of subscribers". It accepts links by email but "doesn't cover new game releases", and a paid ad is the only guaranteed mention. [Rascal News](https://rascal.news/contact): TTRPG news; tips@rascal.news, press@rascal.news. [Gnome Stew](https://gnomestew.com/about/): multi-author GM blog, publishing since 2008, with a Gnomecast podcast; it has a contact page. | Send a short, factual note to press@rascal.news, and pitch Gnome Stew an article or guest post on running campaign economies rather than a product plug. These outlets mostly cover games, not tools, so expect low odds. |
| **Podcasts** | GM-advice shows (Gnomecast, and smaller independent "DM tools" shows) sometimes interview tool makers. | Offer to talk about running a downtime economy, not about the app. Low priority. |
| **YouTube and short video** | Google Play uses a YouTube preview video and autoplays only its first 30 s, and it recommends showing the real app within 10 s ([Play asset specs](https://support.google.com/googleplay/android-developer/answer/9866151)). | Make one 2–3 minute "how a session's loot flows" walkthrough: encounter → loot review → award once → party purse → shop. Then cut 3–5 vertical 15–30 s clips (Shorts/TikTok/Reels) on single moments: NPC barter roll, fog reveal, map ping, the DM approving downtime. Use real UI only; no mock data in a real-looking campaign. |
| **Google Play** (future) | App icon 512×512 32-bit PNG. Feature graphic 1024×500 JPEG or 24-bit PNG with no alpha. Screenshots: 2–8 per device, 320–3840 px, long side ≤ 2× the short side. To be eligible for promotion, provide ≥ 4 screenshots at ≥ 1080 px (portrait ≥ 1080×1920). Tablets need ≥ 4 screenshots at 16:9 or 9:16, 1080–7680 px ([specs](https://support.google.com/googleplay/android-developer/answer/9866151)). Personal developer accounts created after 2023-11-13 must run a closed test with ≥ 12 testers opted in for 14 consecutive days before production ([testing requirement](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB)). | **OWNER DECISION:** whether to publish on Play. It needs a Play developer account, a closed test with 12 testers for 14 days, Data safety and privacy-policy pages, and a decision on signing (Play App Signing compared with the permanent key in `android-release.yml`; CLAUDE.md forbids generating new keys). Prepare 4 portrait 1080×1920 shots, 4 tablet-landscape shots (split view is a good one), and a 1024×500 feature graphic. |
| **SEO landing pages** | Facts from the live site: every public page currently uses the same meta description (APP_DESCRIPTION in `src/lib/help/content.ts`), /welcome's title is just "Lootsplit", `/sitemap.xml` returns 404, and robots.txt is Cloudflare's managed content-signals file. | See below. |

#### SEO: one landing page per search intent

Each page should answer the searcher's actual question and show a real screenshot (`public/product/*.webp`). It needs its own `<title>`, a meta description, an H1 and a single CTA to /welcome. **OWNER DECISION** for every new public page, and each one needs the help-content review that CLAUDE.md requires.

| Page (suggested path) | Target searches | Why | Content from shipped features |
|---|---|---|---|
| `/features/loot-tracker` | "dnd loot tracker", "party inventory tracker", "track party gold dnd", "shared party inventory app" | This is the core use case and the name says it. People search these terms while setting up a campaign. | Five denominations, party purse, shared inventory, ledger with voiding, encounter loot tables, award transferred once with a receipt. **Avoid "split loot evenly".** |
| `/features/npc-barter` | "dnd bartering rules", "haggling 5e persuasion", "npc haggle mechanic" | DMs search for haggling *rules*, so a page explaining the mechanic (DC from fairness, Persuasion with advantage at CHA 16+) is useful on its own and then shows the tool. | NPC conversation, server-rolled Persuasion, counter-offers, DM confirm modes, anti-exploit caps (from docs/NPC-BARTER.md). |
| `/features/shops` | "dnd shop generator", "5e magic shop inventory", "fantasy shop prices" | These terms have high search volume, and shop generation and restock are shipped. | Shops with keepers, stock generation, restocks, buy/sell rates, Charisma pricing, black markets, blacksmith. |
| `/features/downtime` (optional) | "5e downtime tracker", "dnd property income", "dnd ship rules downtime" | Few apps cover this niche, so it's a differentiator. | Downtime from a day to ten years with DM preview, properties, ships and voyages, loans. |

**Technical SEO (OWNER DECISION):**

- Give each public page its own title and description.
- Add a canonical link and `sitemap.xml` covering /welcome, /features, /downloads, /help, /updates and /resources.
- Keep campaign and account routes `noindex`.

---

### 3. Ready-to-post drafts (shipped features only)

These drafts use the new name and address. Post them only after the rename and the domain cutover are live; until then, the current address is https://lootsplit.oliverstorie2017.workers.dev/welcome.

Before posting, replace `[AI line]` with the owner-approved disclosure (**OWNER DECISION**), for example: *"I build it with an AI coding assistant; all the design and every release are reviewed by me."* Post the Reddit draft yourself: r/dndnext bans AI-written posts, so rewrite it in your own words.

#### (a) Reddit post: r/rpg ("Self Promotion" flair), or r/dndnext (once, with "Self-Promotion" flair)

**Title:** I made a free campaign ledger for party gold, loot and trading. Looking for feedback from DMs who run money-heavy games

**Body:**

> Hi all, I'm the developer of Lootsplitter, a free web app (plus an Android APK) for tracking the money side of a campaign. I'm posting because I'd like feedback from people who actually run economies at their table.
>
> What it does today:
>
> - **Coins and a party purse:** five denominations (cp/sp/ep/gp/pp), player, party and NPC accounts, shared inventory, and a ledger where mistakes are voided rather than erased.
> - **Encounter loot:** guaranteed items and weighted loot tables. The DM reviews the haul and transfers it once; a repeated click or a retry on a bad connection returns the same receipt instead of paying out twice.
> - **Shops and trade:** shops with stock and restocks, player-to-player trades with counteroffers, and NPC barter. The player makes an offer, the server rolls the character's Persuasion against a DC based on how fair the deal is, and the DM can choose to confirm results first.
> - **Between sessions:** properties, ships and downtime, applied only after the DM previews and approves it.
> - **Ways to play:** on one device, turn-based, or live in a shared room. Players can join as guests; accounts are optional. Maps with fog of war and pings are in there too.
>
> What it doesn't do yet: there's no one-click "split this evenly" button. You divide coins with transfers. It isn't on Google Play; the Android app is a signed APK from the website. Rules content is limited to the SRD.
>
> [AI line]
>
> Link: https://lootsplitter.com/welcome
>
> I'd especially like to hear how you handle party funds now, and what would make you drop your spreadsheet. Happy to answer questions.

(For r/rpg, which is system-agnostic, change the coin line to "five coin denominations" and mention that the SRD content is D&D 5e.)

#### (b) Discord announcement (short, for a #showcase or #self-promo channel)

> **Lootsplitter: a free campaign ledger for party gold, loot and trade** (I'm the developer)
> Party purses in five coin types, encounter loot tables that pay out exactly once, shops, player trades, and NPC barter with a server-rolled Persuasion check. Properties, ships, DM-approved downtime, and maps with fog and pings. Play on one device, turn-based or live; guests don't need an account. Browser plus an Android APK.
> Not yet: no auto even-split, not on Google Play.
> https://lootsplitter.com/welcome. Feedback very welcome!
> [AI line]

#### (c) Product Hunt

**Tagline (55 chars):** `Shared party gold, loot and trade for your RPG campaign`

Alternative (54 chars): `A shared ledger for your party's gold, loot and trades`

**Description:**

> Lootsplitter is a free campaign manager for tabletop RPG groups that track the money. Each campaign has party and player purses in five coin denominations, a shared inventory and a ledger that voids mistakes instead of erasing them. DMs build encounter loot from tables and award it once, with a receipt. Shops, player trades and NPC barter (with a server-rolled Persuasion check) post straight to the ledger. Properties, ships and downtime are applied only after the DM approves them. Play on one device, turn-based or live in a shared room; players can join as guests. It runs in the browser and as an Android app with offline device campaigns.

---

### 4. Privacy-friendly analytics

#### Current state (from the repo)

- The CSP in `cloudflare/release-assets.mjs` is `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; script-src-attr 'none'; worker-src 'self' blob:`. The comment states that it "blocks every third-party or injected external script".
- The CSP sets no `connect-src`, so `connect-src` falls back to nothing, and fetches to other hosts are currently allowed.
- `scripts/csp-browser-audit.mjs`, `scripts/security-headers.test.mjs` and `scripts/live-release-audit.mjs` check this CSP, so any third-party script means changing these tests.
- The existing `/api/account/site-analytics` endpoint is only the public "gold spent" aggregate, not visitor analytics.
- There is no privacy-policy page.

#### Comparison (all checked 2026-10-22)

| | Cloudflare Web Analytics | Plausible | Umami |
|---|---|---|---|
| **Cost** | Free ([blog](https://blog.cloudflare.com/free-privacy-first-analytics-for-a-better-web/); [docs](https://developers.cloudflare.com/web-analytics/about/)) | Cloud from $9/month for 10k pageviews (Starter; Growth $14, Business $19; $19–39 at 100k), 30-day trial ([pricing data on plausible.io](https://plausible.io/), [plans](https://plausible.io/docs/subscription-plans)). Community Edition self-hosting is free under AGPLv3 ([self-hosting](https://plausible.io/docs/self-hosting)). | Cloud Hobby is $0 for up to 100K events/month with 6-month retention; Pro is $20/month ([pricing](https://umami.is/pricing)). Self-hosting is free (MIT). |
| **Cookies and identifiers** | "We don't use any client-side state, like cookies or localStorage, for the purposes of tracking users", and no fingerprinting ([Cloudflare blog](https://blog.cloudflare.com/free-privacy-first-analytics-for-a-better-web/)). An older independent review found a cookie in 2020, which Cloudflare later deprecated ([ctrl.blog](https://www.ctrl.blog/entry/review-cloudflare-analytics/)). | "We do not use cookies, browser cache or local storage"; "you do not need cookie banners" ([data policy](https://plausible.io/data-policy)). Data is hosted in the EU (Germany). | "Umami's web tracker does not use cookies"; GDPR compliance "depends on how you configure and use it" ([FAQ](https://docs.umami.is/docs/faq)). Cloud data is stored in the US or EU depending on the account region ([cloud FAQ](https://docs.umami.is/docs/cloud/faq)). |
| **Consent under GDPR and ePrivacy** | Probably no consent banner needed, because nothing is stored on the device. A privacy notice is still required, and Cloudflare is a processor. **OWNER DECISION, or legal advice.** | Same. Plausible publishes a legal assessment. | Same. Self-hosting keeps the data in-house. |
| **Script / CSP impact** | Manual JS beacon: `script-src https://static.cloudflareinsights.com` and `connect-src https://cloudflareinsights.com` (`/cdn-cgi/rum`). With automatic injection on a proxied zone it posts to the site's own `/cdn-cgi/rum` (`connect-src 'self'`) ([FAQ](https://developers.cloudflare.com/web-analytics/faq/); [data collection](https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/)). | Cloud: `script-src https://plausible.io` and `connect-src https://plausible.io` (`/api/event`). The script is per site (`/js/pa-….js`) ([script update guide](https://plausible.io/docs/script-update-guide)). It can be proxied through the Worker so both are `'self'`. | Cloud: `script-src https://cloud.umami.is` (script.js), and `connect-src` to the cloud collection host (by default the script's host; check the snippet). Self-hosted, or proxied through the Worker: `'self'` ([tracker config](https://umami.is/docs/tracker-configuration)). |
| **Limit to public pages** | Manual snippet: only pages that render it report. Automatic injection covers every page by default, with dashboard Rules to include or exclude paths ([Rules](https://developers.cloudflare.com/web-analytics/configuration-options/rules/)). The SPA mode reports route changes automatically: History API patching, Navigation API and Soft Navigations. Turning that off needs the manual snippet with `"spa": false` ([SPA](https://developers.cloudflare.com/web-analytics/get-started/web-analytics-spa/)). | Path include/exclude attributes were removed from the script; there is a separate excluding guide. Best done by loading the script only on public routes, with manual pageviews. | `data-before-send` hook (v2.18+) can cancel any event whose path is not on an allowlist. `data-auto-track="false"` / `data-auto-pageview="false"` enable manual pageviews. `data-domains` restricts hosts. |
| **workers.dev host** | The site is served on `*.workers.dev`, not a custom zone, so automatic injection and dashboard Rules (proxied zones only) probably don't apply. Use the manual snippet. | n/a | n/a |

#### Recommendation

**OWNER DECISION: Cloudflare Web Analytics with the manual beacon, loaded only by the public website shell.** Use it for /welcome, /features, /downloads, /help, /updates, /resources and /donate. Never use it on `/`, campaign routes, /account, /share, /player-display or the Android bundle (`VITE_MOBILE`).

Why this one:

- It's free, and Lootsplit already runs on Cloudflare.
- It doesn't store cookies or use localStorage, and has no user-level tracking.
- There's no new vendor account.
- Data stays with a processor Lootsplit already uses.

Constraints for building it:

1. **Leave the SPA patching off.** The Lootsplit SPA moves from public pages into the app without reloading, and the beacon's automatic SPA mode (History or Navigation API) would report in-app route changes. Pass `"spa": false` and inject the script only on a hard load of a public route. Better still, inject it from the `Website` component (`src/components/website/site.tsx`) and remove it when the user leaves for the app shell. This needs an audit that proves no beacon request fires on `/`, `/account` or campaign routes (add it to `csp-browser-audit.mjs`).
2. **Use a route-scoped CSP.** Add `https://static.cloudflareinsights.com` to `script-src` and `https://cloudflareinsights.com` to `connect-src` **only on the public website routes' responses**, if the Worker can set headers per route. Keep the current strict policy for the app and account routes. That way a stray beacon could not run inside campaigns even through a bug.
3. **Update the security tests.** The `security-headers.test.mjs` and live release audit need to allow exactly this host on public routes only.
4. **Publish a short privacy notice page** (what's collected, by whom, how long), and review the help content as CLAUDE.md requires.
5. **Fallback:** if a third-party script is unacceptable, use Umami self-hosted or Plausible CE, proxied through the Worker so the CSP stays `'self'`. The cost is running a server. A zero-script option is the Worker's own request counts, which the owner Field monitor already reads ("Cloudflare plan usage"). That gives totals per route but not referrers.

Consent inside campaigns or account pages: no analytics there unless the owner later adds an explicit opt-in. That needs its own **OWNER DECISION**.
