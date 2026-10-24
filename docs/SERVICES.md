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
| 1 | Temple, with DM review (charged on approval) | Shipped |
| 2 | Workshop: scribe and alchemist presets | Shipped |
| 3 | Inn: booked stays, meals, rumours into the buyer's private NPC thread | Shipped |
| 4a | Wave 2: new kinds, tabletop protocol 9, Fence/Bank/Hire links, Tailor preset | Shipped |
| 4b | Wave 2: Sage (Identify, record only) | Shipped |
| 4c | Wave 2: Stable and coach | Planned |
| 4d | Wave 2: Trainer (paid lessons) | Shipped |
| 4e | Wave 2: Courier (letters to NPCs) | This change |

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

## Workshop (phase 2)

- **Presets** (`services-presets.ts`, specialty Scribe or Alchemist): scrolls from SRD 5.2.1 Spell
  Scroll Costs (price = twice the cost = the scroll's value, days per level), one per order; brews
  with SRD 5.2.1 brewing (Potion of Healing: 1 day, herbs for half the price, bring your own or
  supplied) and the crafting rule (gp ÷ 10 days), up to 5 per order. SRD 5.1: scrolls are unpriced
  drafts; brews at 5 gp of work a day. Blank: none.
- **Progress** (`services-time.ts`): `previewServices` is the forge's `previewDays` over active
  workshop orders, added to `quoteSchema.services` beside `blacksmith`; only approved downtime
  advances it, never session hours. A pending quote saved before this existed is approved as saved.
  Approval writes the state and one event per order for the payer.
- **Collecting**: `service-claim` at the workshop by the payer: one holding `id+"-crafted"` with
  the units, value, weight and a provenance note.
- **Screens**: workshop order cards with a progress bar, Collect, and DM pause/resume/cancel;
  Market → Service commission register; the Downtime preview's single **Commissions** fold holds
  the forge's lines ("Blacksmith commissions", unchanged) and the workshop's.

## Inn (phase 3)

- **Preset**: one "Rooms and meals" offer, per night, up to 14 nights, six tiers with SRD 5.2.1
  night and meal prices (SRD 5.1: food per day). The price is guests × nights × night price plus
  guests × days × meals × meal price, each factor shown; paid once up front, recorded only (no rest
  granted). Leaving early refunds nothing automatically; downtime charges nothing for stays (the
  Downtime preview says so). Open stays are not offered (owner decision: not now).
- **Rumours** (`service-rumour`): the provider's `rumours` hold teaser, DM-only text, price and
  `once: "character" | "party"`. One command pays once (`id+"-payment"`), records the buyer and
  appends an NPC message `id+"-rumour"` to the buyer's private thread with the innkeeper, so it
  follows that thread's privacy. `rumourLock` refuses a second purchase per character (or any after
  the first for once-per-party); a stale fingerprint or a race is refused, never charged twice.
  Players see teaser and price only, plus `boughtBy` for their own characters. The buyer may share
  the text in party chat (owner decision).

## Wave 2 (owner-approved mockups, 2026-10-24)

Design: the wave-2 design note and mockups (hub, training, stable, courier, identify, DM setup),
approved "as shown". Wave-1 rules carry over: record only, SRD 5.2.1 defaults with SRD 5.1 and Blank
presets, a per-provider pause, reviewed orders charged on approval. Moneychanger skipped (coins
already make change); bank deposits, travelling hirelings, alterations, ship passage and a
stolen-goods flag are deferred.

### Kinds and protocol 9 (phase 4a)

`serviceKinds` adds `trainer`, `stable`, `courier`, `sage` (engines) and `fence`, `bank`, `hire`
(links). Engine kinds are refused by `validateServices` until their phase ships. `npc.services`
takes the same values.

**Tabletop protocol 9** (`SERVICES_WAVE2_PROTOCOL`): protocols 0-8 receive `journal.services`
without wave-2 providers, without offers carrying wave-2 fields or time models, and without
orders whose terms or fields are wave 2 (`wave1Services`, by key whitelist); NPC lists without
wave-2 kinds; the same for a pending downtime quote's `services.state` and archived reports.
Their NPC saves compare against the stripped list and keep the stored wave-2 kinds (`world.ts`
npc-save), whole-journal writes keep them (`journal.ts`), account backups with wave-2 data are
refused for restore on those clients, and their pending drafts with wave-2 service data ask them
to finish on the updated website.

### Links (phase 4a): no new money path

Link providers have no offers (validated) and an optional `link`:

| Kind | Opens | Settings | Lock (after the shared reasons) |
| --- | --- | --- | --- |
| Fence | The provider shop's Sell tab (`/shop/ID#sell`); selling is the existing `sell` at the shop's buy rate | Shop preset button: black market on, premium 1.5, buy rate 30% (house default) | "{NPC} isn't dealing right now." while the black market is hidden (checked before the shop) |
| Bank | Bank → Apply for a loan (`/features/bank?bank=ID`), note "Loan from {bank} ({NPC}). " | `link.loan`: rate, period, simple/compound, largest loan; prefills the DM's Track existing debt form for a request whose note names the bank | — |
| Hire | Conversation: choose a role and a party property, then the ordinary `estate-staff` proposal (status proposed; DM approves in Property proposals) | `link.roles`: name, wage, period, optional NPC (SRD hirelings: guard 2 gp, porter 2 sp a day) | "has no one for hire"; "The party owns no property to staff." |

Projection: a fence only while `world.blackMarketActive`; a role's NPC only when the player can
read that NPC; provider events stay DM-only. Here rows: Sell, Borrow, Hire. Hub replies are
marked ↗. Deleting an NPC a hire role names is refused.

**Tailor** is a third workshop specialty: common, traveler's, costume and fine clothes (SRD 5.1
prices and weights), SRD 5.2.1 crafting days (gp ÷ 10, rounded up; SRD 5.1: 5 gp a day), half the
price as cloth the party may bring or the tailor supplies.

### Sage: Identify (phase 4b)

- **Offer**: `target: "held-item"`, instant, spell level 1, 50 gp in both presets, DM review (the
  DM writes the answer), no components (the pearl is the sage's own and not consumed), one item per
  order. A `sage` provider's offers must have a target; a temple may carry the same offer (the temple
  preset adds it as a draft); no other kind may.
- **Request**: `itemHoldingId`, an item the payer owns and carries (`assertHeldItem`: owned, not a
  service, `assertCarried`; equipped allowed). No beneficiaries. Terms snapshot `item` (name and
  notes at the time). Lock in the conversation: "Carry the item you want identified."
- **Approval** (`service-review` with `reveal: { text, appendToNotes, rename? }`, required for an
  Identify approval and refused otherwise): reruns the quote (the item still carried, funds), pays
  once (`id-payment`), posts one NPC message `id-answer` to the payer's private thread with the
  NPC, appends `Day N · identified by {NPC}: {text}` to the item's notes when ticked (old notes
  stay) and renames it when asked, all in one command; `order.reveal` records it. Deny or withdraw
  moves nothing.
- **Phase 5 hook**: `revealIdentify` in `services-command.ts` is where the item-identification
  reveal will be called, so payment and reveal stay atomic.
- **Privacy**: other players never receive the order or the thread; the answer exists only after
  approval. Protocol 8 clients never receive Identify offers or orders (key whitelist).

### Trainer: paid lessons (phase 4d)

Paid lessons reverse NPC training (`downtime-activities.ts`): the NPC teaches a character, with the
same form, hour pool, Review Inbox, counters, resets and milestone notes.

- **Offer** (`time: { kind: "training" }`): a subject with `category` (martial, academic,
  profession), `priceCopper` = rate per training day, `maxDays` (1–250). Preset (SRD 5.2.1 and 5.1):
  Thieves' tools, A language, Weapon drills at 2 gp a training day (SRD skilled hireling pay; the SRD
  has no training price). Blank: none.
- **Agreement** (`service-order`): one pupil (a party character here, the beneficiary; the payer
  may pay for another), `units` = training days booked. Terms `lessons` (pupil, category, topic,
  day rate, max days). **No payment and no coin re-count**; `active` (or `requested` → `active` with
  DM review). One open agreement per pupil, provider and subject.
- **Session** (`downtime-training` with `lessonOrderId`): the character (pupil) is `trainerId`,
  the teacher NPC `npcId`; category and subject must match the agreement; the automatic level checks
  are skipped (the DM confirms the teacher in review), presence still applies; hours are reserved
  for both; it may not exceed the agreement's remaining days (approved + pending). The fee
  `ceil(minutes × rate ÷ (training hours per day × 60))` is stored on the request (`feeCopper`).
  No money moves.
- **Approval** (`downtime-training-review`): rechecks the agreement (active), presence, hours and
  the fee, then `chargeLesson` (`services-lessons.ts`, a hook so `downtime-activities.ts` doesn't
  import finance) makes one `financeMove(-fee, requestId+"-fee")` to the lesson payer at the
  teacher's shop, appends the session to `order.sessions` and completes the agreement when its days
  are taken. Deny or cancel releases the hours and moves nothing. A short payer is refused.
- **End lessons** (`service-cancel` on an active agreement, payer or DM): closes it; pending sessions
  can no longer be approved; nothing is charged or refunded.
- **Screens**: Services · Trainer (sub shows the pupil's open lessons), subjects with the rate and
  "Paid per session", a booking drawer (pupil, up to N days, worked fees, Pay now: nothing),
  Agreed receipt, Log a session ↗ to Downtime; Downtime → Learn from a paid teacher (lessons,
  period, hours, fee, teacher's hours "checked when the DM reviews") and lessons cards with
  sessions and End lessons (also on the shop's Services section); Review Inbox rows tagged Paid
  lesson with the fee.
- **Privacy**: the teacher's hour budget is never projected (existing budget projection); players
  see their own agreements and sessions only. Training requests are a non-strict schema, so older
  clients drop `lessonOrderId`/`feeCopper` when reading; their review `before` then differs and the
  server refuses it, never charges.

### Courier: letters (phase 4e)

- **Provider**: `destinations: [{ locationId, deciMiles, days }]` (DM's distance in tenths of a mile
  and delivery days, 1–3650; locations must exist). Offer "Letter" (`time: { kind: "delivery" }`),
  `priceCopper` = rate per mile, 2 cp in both presets (SRD Messenger). A separate provider kind: post
  offices don't get it automatically; their property letters (`estate-letter`) are unchanged and
  linked from the conversation (Property letter ↗). Parcels: locked, not carried.
- **Recipients** (`courierRecipients`): visible NPCs the sender already has a thread with ("knows"),
  each under the destination containing the NPC's location; blocked when the NPC is at the
  courier's place ("talk instead") or nowhere the courier serves. Hidden NPCs are never listed.
  Players receive their characters' list as the projection-only `provider.recipients` (never
  stored, refused by validation outside a projection), so a far-away NPC needs no other projection.
- **Order** (`request.letter: { recipientNpcId, text ≤ 2000 }`, the NPC message limit): one payment
  `id-payment` = `ceil(deciMiles × rate ÷ 10)`, status `active` with `workDays` = the destination's
  days, terms `letter` (recipient, place, distance, text).
- **Delivery**: `previewServices` advances letters like workshop work (approved downtime only).
  On arrival the preview marks it `completed` ("Delivered campaign day N") or, when the recipient
  is hidden or gone, `paused` ("Held at … The DM decides."). Approving the downtime runs
  `deliverLetters`: each completed letter appends one message `orderId-letter` (author: the
  character) to the sender's own thread with the recipient; repeats add nothing.
- **Held letters**: `service-control` `deliver` (completed, delivered once) or `return` (cancelled,
  nothing refunded), DM only, held letters only.
- **Privacy**: the text is in the sender's order and thread only; other players get neither, and
  their recipient lists are their own. Guards: a recipient with a letter in transit and a
  destination's location can't be deleted.

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

`services-courier.test.ts` (preset and fee rounding, recipient rules, one payment, downtime-only
progress, one delivery message, held letters delivered or returned, privacy and matching
fingerprints, deletion guards, protocol 8, offline parity through `executeFinanceCommand`),
`services-trainer.test.ts` (presets, booking moves nothing, one open agreement, hours reserved
for both, level check skipped only for lessons, matching and days cap, fee rounding, one charge
per approval, retries, deny/cancel, short payer, cap completes, End lessons, privacy, protocol 8,
offline parity), `services-identify.test.ts` (presets, held-item rule, request moves nothing, answer required, one
payment and one message, notes and rename in the same command, recheck refusals, privacy, protocol
8, offline parity), `service-links.test.ts` (link validation, no orders on links, fence projection and lock, bank note
and terms, hire lock and proposal moving nothing, role NPC privacy, protocol 8 stripping and older
writes, Tailor and link presets, Here rows, offline parity), `services-temple.test.ts` (command IDs, stale quotes, charge on approval, components, every lock
reason, whole copper, authorization, privacy, deletion guards, old saves and protocol 8, presets,
offline parity, Here rows), `services-workshop.test.ts` (presets, herbs, downtime-only progress,
pause, collect once at the workshop, cancel without refund, privacy, offline parity through
`executeLocalCommand` and `executeFinanceCommand`), `services-inn.test.ts` (presets, stay price
and overflow, rumour text never projected before purchase and only in the buyer's thread after,
once per character and per party, retries and races never charged twice, offline parity),
`service-hub.test.ts`, the unchanged `blacksmith.test.ts`, `npc-barter*.test.ts` and
`room-store.test.ts`; browser audits `scripts/services-browser-audit.mjs`
(`npm run verify:focus -- services`, CI step `dev-services`, 1280/390/320: hub, temple offers and
locks, Remove Curse paid at once, Raise Dead requested then approved in Review Inbox, shop Services
section, DM editor, an alchemist order with brought herbs through approved downtime to collection,
Market register, Commissions fold, an inn booking and a rumour shared in party chat; Ironbound and
Parchment) with the unchanged
`blacksmith-browser-audit.mjs` and `npc-barter-browser-audit.mjs`.
