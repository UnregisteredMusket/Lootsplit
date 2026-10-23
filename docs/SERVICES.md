# NPC services

Services are paid work an NPC does for the party at a place: the blacksmith's commissions today,
and, in the owner-approved first wave (2026-10-23), temple spellcasting, workshop commissions
(scribe and alchemist) and the inn. The forge keeps its own engine (`docs/BLACKSMITH-SERVICES.md`);
the new kinds share the helpers below. Design and mockups: the services proposal and design note
approved "as shown" on 2026-10-23.

## Status

| Phase | What | State |
| --- | --- | --- |
| 0 | Shared helpers lifted from the forge (`service-core.ts`); hub Services runs the real availability check and lists every provider | Shipped |
| 1 | Temple, with DM review (charged on approval) | This change |
| 2 | Workshop: scribe and alchemist presets | Planned |
| 3 | Inn: booked stays, meals, rumours into the buyer's private NPC thread | Planned |

## Shared helpers (`src/lib/quire/service-core.ts`)

Lifted out of the forge with no behaviour change; the forge imports them and its tests and
browser audit pass unchanged.

| Helper | Was | Rule |
| --- | --- | --- |
| `presentAt(t, locationId, purseId)` | `smithHere` (kept as an alias) | The purse is at the location or inside it; individual downtime or a sailing ship means away |
| `npcAtShop(t, npcId, locationId)` | inline in `smithAvailability` | The provider NPC is visible, not on downtime and at the shop |
| `money(n, message)` | `money` in `blacksmith.ts` | Whole copper: `Math.ceil`, safe integer, 0..1e12 |
| `quoteFingerprint(parts)` | the `before` builder | Canonical JSON; the command recomputes it and refuses a stale quote |
| `assertContribution(t, holdingId, purseId, rule)` | the material checks | Owned item, not a service, matching material key and minimum unit value, carried (`assertCarried`), not equipped |
| `controlOrder(order, action, reason, open)` | `smith-control` | Pause, resume or cancel with a reason; never refunds |
| `previewDays(orders, days, clock, rule)` | `previewSmith` | Only approved downtime advances work; completion day is the day work finished |
| `downtimePending(t)` | the smith command guard | A pending downtime quote freezes service commands |

## Conversation hub (`src/lib/quire/service-hub.ts`)

`npcServices(table, npcId, purseId)` lists every provider the NPC runs, each with the lock reason
from the same check the order command runs, in this order: pending downtime, no character, then
the provider's own availability (permission, shop open and visible, NPC present, payer present).
`servicesReply` turns the list into the hub's Services reply:

- no provider: locked, "{name} offers no services.";
- one provider: its own reply (the forge links to its shop page);
- several: "Services · {kinds}" opens a numbered sub-list (keys still work, Never mind returns),
  enabled while at least one provider is usable.

The People & NPCs page shows the conversation for an NPC who runs a service even when they don't
barter. Player-controlled NPCs keep their usual interaction.

## Data (`services-schema.ts`)

Optional `journal.services = { providers ≤500, orders ≤5000 }`; old saves have none. No D1
migration: the state lives in room JSON and IndexedDB. The NPC permission is the optional
`npc.services: ("temple" | "workshop" | "inn")[]`; the forge keeps `blacksmithServices`.

- **Provider**: kind, preset (`srd-5.2.1`, `srd-5.1`, `blank`), optional specialty ("Scribe"),
  shop and NPC, name, description, optional pause reason, review threshold and settlement override,
  offers, and (inn) rumours.
- **Offer**: key, name, description, approved, whole-copper price, spell level, time model
  (temple `instant` with a casting time noted on the receipt; workshop `downtime-days`; inn
  `per-night` — validated per kind), review `auto` or `dm`, max units, components (label, material
  key, minimum value, quantity, consumed, supplied by `party`, `provider` or `either` at a price),
  output (`record` or a collected `holding`), inn tiers.
- **Order**: the command ID, provider, offer, payer, the original request (beneficiaries, units,
  contributed lots, inn choice), immutable terms (names, place, offer snapshot, price lines,
  components), status `requested | active | paused | ready | claimed | completed | denied |
  cancelled`, paid and completed dates, a message and its history.

## Commands (`services-command.ts`, dispatched beside `smith-*`)

| Kind | Who | Effect |
| --- | --- | --- |
| `service-provider` | DM | Create, update or remove with a `before` compare. Remove is refused while orders are open. Event is DM-only. |
| `service-order` | Payer or DM | Reruns `serviceQuote` and refuses a stale `before`. Automatic: one `financeMove(-price, id+"-payment")`, consumes components, `completed` (or `active` for downtime work). Review: stored as `requested`; **no money or items move**. |
| `service-cancel` | Payer | Only while `requested`; nothing to refund. |
| `service-review` | DM | Approve reruns every check and refuses if the price changed, then pays once; deny needs a reason and moves nothing. |
| `service-control` | DM | Pause, resume or cancel open work with a reason; never refunds. |
| `service-claim` | Payer | A `ready` holding output, at the provider's location: one holding `id+"-crafted"`. |

All are refused while a downtime quote is pending; `validateServices` runs after each. Events carry
the payer's purse. Offline play runs the same commands through `executeLocalCommand`.

**Availability** (`providerLock`, same text in the hub and the command): pending downtime → no
character → NPC permission off → shop closed or hidden → NPC away → payer away → paused. Then per
offer: settlement too small for the spell level (levels 0–2 anywhere, 3–5 town or city, 6–9 city).
Beneficiaries must be party characters at the place; paying for one grants no control.

**Components** match by material key, or by name when the lot has no material key ("Diamond
(500 gp)"); a lot with another key never matches. The forge's held-item rule applies.

**Privacy** (`session-records.ts`): players get providers at visible shops with readable NPCs and
at least one approved offer, only approved offers, rumours as teaser and price only (`boughtBy`
lists only their own characters), and only their own orders. Provider events are DM-only.

**Older clients**: tabletop protocol 8 strips `npc.services` for protocols 0–7; their NPC saves and
journal writes keep the stored list and `journal.services`, and their pending drafts with service
commands are refused with the usual "finish on the updated website" message.

## Screens

- Conversation (`service-talk.tsx`): offers as numbered replies with price, time, component and
  review flags; settlement locks; a drawer for the beneficiary, the component (bring your own or
  supplied) and the total; receipts that say "Recorded only"; open requests rejoin the conversation
  with Cancel request.
- Shop page → Services (`service-providers.tsx`): offers, the viewer's orders, and for the DM the
  provider editor, Add a service provider and Remove.
- People & NPCs: Offers temple/workshop/inn services in Configure NPC, and a permissions form with
  links to each provider.
- Review Inbox → Service requests: live rechecks, approve (disabled while a check fails), deny with
  a reason; players see their requests and can withdraw them. The Desk's Review inbox count includes
  them.
- Map: a shop's place card shows a "Services: Temple" chip and the shop's Services section; the
  Here sheet lists one row per provider (opening the provider NPC), disabled with the reason when
  closed or paused.

## Development rules

- Money only through authoritative `service-*` commands (from Phase 1) with idempotent command IDs
  and a quote fingerprint; one `financeMove` per paid order; reviewed orders move nothing until
  approval. Follow `/money-command`.
- Effects are record only: no service changes hit points, conditions, curses or death on a sheet.
- The forge (`journal.blacksmith`, `blacksmithServices`, `smith-*`) stays exactly as it is.
- Offline play uses the same commands through `executeLocalCommand`; no device-only code.
- Players see only approved offers of visible providers at readable NPCs, and only their own orders.

## Verification

`services-temple.test.ts` (command IDs, stale quotes, charge on approval, components, every lock
reason, whole copper, authorization, privacy, deletion guards, old saves and protocol 8, presets,
offline parity, Here rows), `service-hub.test.ts`, the unchanged `blacksmith.test.ts`, `npc-barter*.test.ts` and
`room-store.test.ts`; browser audits `scripts/services-browser-audit.mjs`
(`npm run verify:focus -- services`, CI step `dev-services`, 1280/390/320: hub, temple offers and
locks, Remove Curse paid at once, Raise Dead requested then approved in Review Inbox, shop Services
section) with the unchanged
`blacksmith-browser-audit.mjs` and `npc-barter-browser-audit.mjs`.
