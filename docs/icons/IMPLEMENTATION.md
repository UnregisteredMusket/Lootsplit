# Fantasy icons

Source catalogs: official Open5e SRD 2014 and SRD 2024 fixtures. Pinned commits and
counts are in coverage.json. The live API returned HTTP 403 during research; this
is a source-snapshot cross-reference, not a claim about current live API totals.

352 SVG assets from Game-icons.net are bundled under public/icons/game-icons.
The uniform black square background was removed from each SVG for CSS alpha-mask
rendering. Artist geometry remains intact. Attribution, original license and
per-icon author/source URLs are public beside the assets and linked from Resources.

src/lib/icons/catalog.json contains records, visual name aliases, generic categories,
UI symbols and family rules. src/lib/icons/resolve.ts selects artwork without any
state writes. Known source identity wins, followed by visual name/family matching,
then generic category/kind fallback. Name matching never claims a source identity.

Existing Open5e imported catalog IDs, spell source URLs and combatant sourceKey
already survive saves. Existing notes may also retain URLs. No data migration is
needed. Custom item artwork retains priority in LedgerArt, with a fantasy fallback
if it fails to load. Property, portrait and shop illustrations retain their handling.

Every matched asset reference is checked by scripts/fantasy-icons.test.mjs. All
3,013 entries have an icon. This includes intentionally shared category/family
artwork. The mapping is curated plus rule-based; not every semantic pairing has
been individually reviewed. Generic icons are explicitly accepted by the user.

Affected preservation surfaces: both role navigation sets and all existing routes;
shortcut customization; item custom images; old/imported inventory; spell imports;
encounter roster and loot review; source/license display; shared web/Android assets.
Financial rules, permission checks, database schema and release pipeline unchanged.

## Verification for this change

- 414 automated tests passed; four existing template tests skipped. Includes source
  identity precedence, all mapped asset paths, unknown/custom/category defaults,
  safe dictionary keys and name matching that leaves records untouched.
- TypeScript and lint passed (existing lint warnings remain).
- Cloudflare build and mobile client build passed; all icon files are bundled.
- Desktop layout audit passed at 1024–2560px; role navigation/settings/customization
  audit passed at 320/390/768/1440px, including light/dark and focus restoration.
- Character browser audit passed editing/reload, inventory, spells/slots, attacks,
  manual-roll policy and permissions. Encounter audit passed generator, manual
  rolls, loot review, award retry/idempotency and denied player access.
- Desktop/mobile dev and built-output screenshots inspected; built output matches
  development with no runtime page errors or horizontal overflow. Generic smoke
  logs include the existing guest-account 401 and external template-script TLS
  failure in this local browser, plus the existing template share-card note.
  Targeted application audits report no runtime errors.
- Published APK metadata is unchanged; this is shared source and website work.
