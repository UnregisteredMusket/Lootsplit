# Reviewed DM resource packs

Library → Resource packs imports `lootsplit.resource-pack` JSON, schema version 1. Existing character, encounter, name-list, PDF and picture imports remain available. The synthetic [example](examples/resource-pack.json) and [JSON schema](examples/resource-pack.schema.json) describe the format; book contents are not bundled with Lootsplit.

Each pack has a stable ID, revision, attribution and source-page records. Entries are creatures, items, NPC references, locations, shops or general source references. Optional related IDs associate a creature with shared lore, salvage and lair rules without duplicating the book text. IDs and hierarchy must resolve within the same pack. Unknown fields, malformed numbers and ambiguous identities fail before any mutation. Files are limited to 1.5 MB and 1,500 records; split large books between complete source sections.

Upload the file, inspect its references and warnings, choose Review resource pack, then Apply resource pack. The preview is tied to the current campaign and private library state. Reimporting the same ID/revision/content reuses the existing pack. Different contents under that identity require a new revision; previous references are retained. Failed imports retain the review draft. Shared pending commands use the existing submit/retry controls.

Importing stores DM reference definitions. It creates no purses, inventory, stock, wealth, deeds or NPC accounts. Imported campaign creatures appear in the encounter builder beside the existing Open5e and picture controls. Adding or generating creates editable copies with independent IDs, original traits/actions/notes and source pages. All required encounter values must be present; missing values remain null and block direct encounter use. Generation uses the existing CR/difficulty estimator and never awards XP automatically.

Items enter the device catalogue only through a separate Add to catalogue action with a reviewed whole-number copper price. A missing source price stays unknown; crafting costs do not become sale prices. A separate location/shop preview reuses the canonical name/type/parent matching command; new shops start closed with empty stock. NPC records remain references until the DM deliberately creates and places a campaign NPC through the existing world controls.

Packs are private DM campaign data and survive saved campaigns, full device exports and archived reports. Player projections remove the private library, including nested archives. Raw PDFs remain device-local. Shared packs use campaign-scoped immutable D1 documents, hydrated for authorized reads and complete exports. Document inserts and room revision updates share an atomic batch, so a losing writer creates no documents. There is no public document URL. Existing complete-recovery limits still apply; an oversized complete recovery must fail before deletion rather than truncate the pack.

Keep source attribution and copyright terms with privately imported material. The importer does not supply book content or grant redistribution rights.

Local focused check: `node scripts/world-local-check.mjs resource-packs`. The resource browser scenario also runs within the existing development and immutable Worker Library navigation preservation gates.
