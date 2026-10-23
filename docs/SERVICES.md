# NPC services

Services are paid work an NPC does for the party at a place: the blacksmith's commissions today,
and, in the owner-approved first wave (2026-10-23), temple spellcasting, workshop commissions
(scribe and alchemist) and the inn. The forge keeps its own engine (`docs/BLACKSMITH-SERVICES.md`);
the new kinds share the helpers below. Design and mockups: the services proposal and design note
approved "as shown" on 2026-10-23.

## Status

| Phase | What | State |
| --- | --- | --- |
| 0 | Shared helpers lifted from the forge (`service-core.ts`); hub Services runs the real availability check and lists every provider | This change |
| 1 | Temple, with DM review (charged on approval) | Planned |
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

## Development rules

- Money only through authoritative `service-*` commands (from Phase 1) with idempotent command IDs
  and a quote fingerprint; one `financeMove` per paid order; reviewed orders move nothing until
  approval. Follow `/money-command`.
- Effects are record only: no service changes hit points, conditions, curses or death on a sheet.
- The forge (`journal.blacksmith`, `blacksmithServices`, `smith-*`) stays exactly as it is.
- Offline play uses the same commands through `executeLocalCommand`; no device-only code.
- Players see only approved offers of visible providers at readable NPCs, and only their own orders.

## Verification

`service-hub.test.ts`, the unchanged `blacksmith.test.ts`, `npc-barter*.test.ts` and
`room-store.test.ts`; browser audits `scripts/services-browser-audit.mjs`
(`npm run verify:focus -- services`, CI step `dev-services`, 1280/390/320) with the unchanged
`blacksmith-browser-audit.mjs` and `npc-barter-browser-audit.mjs`.
