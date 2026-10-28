# Quest log

Owner approval: 2026-10-25 (design and mockups; decisions D1–D12 at their recommended defaults; map links and radius markers in v1).

The DM writes quests; players read the ones revealed to them. Quests never move coins or items: a reward is words plus read-only links to receipts that already exist.

## Data

- `journal.quests` (`src/lib/quire/quests-schema.ts`), beside `journal.services` and `journal.lootClaims`. No D1 migration: rooms are JSON and device campaigns keep the journal in IndexedDB `meta.journal`, so backups, exports and session archives carry quests automatically.
- Quests sit outside every strict room schema, so **no tabletop protocol bump**: older clients' journal parser drops `quests`, and `preserveJournalMetadata` keeps the stored log when they write the journal back. Stored quest records are parsed with unknown keys stripped (not strict), so a later quest field never breaks an older client's journal.
- A quest has a title, Main flag, status (active, completed, failed), audience, summary, giver NPC, places (market locations, map pins, radius markers), objectives (open, done, failed; hidden; optional; each with its own place and pin), promised reward text, reward links, a chronicle and DM notes.
- Radius markers (`areas`) are DM-drawn circles on one map (normalized centre, radius as a fraction of the image width, optional label). An area with `objectiveId` follows that objective's visibility. Areas live in the quest, not in the map's strict placement schema.
- Caps refuse new writes with a message; nothing is pruned: 300 quests, 30 objectives, 500 chronicle lines, 20 reward links, 10 locations, 10 pins, 30 areas.

## Commands (`src/lib/quire/quests.ts`)

`quest-save`, `quest-reveal`, `quest-objective`, `quest-log`, `quest-close`, `quest-link-reward`, `quest-archive`, `quest-delete`.

- DM only, checked on the server. Each carries the quest `revision` the DM saw ("Quest changed on another device. Nothing was saved.") and a command ID (a new quest's ID is its command ID, so a retry cannot create it twice). Each writes one DM-only Activity event.
- The room and the device run the same engine (`applyCommand`; the device through `executeLocalCommand`).
- Shared rooms: sent directly, outside the turn, never staged (`cloud.server.ts`, `cloud-client.ts`).
- Every chronicle line and objective change is stamped with the active session and the campaign day.
- A never-revealed draft can be deleted; a revealed quest is archived (kept in data and reports). A revealed, visible objective cannot be removed; mark it done or failed.
- `updatedAt` moves only on changes players can see (reveal, new or revealed objective, shared entry, objective or status change, ); `editedAt` records any change and is DM only.
- `message: true` also posts existing chat notes: one private DM message per character who can read the quest (party chat is not used, because every seat, including seats whose characters are hidden, reads it).
- `quest-link-reward` stores a reference to an existing ledger line, encounter award receipt or treasure-pool resolution (current records or archived sessions), with the DM's label (summary and total). It never pays. A player's label is rebuilt at projection from only the receipt lines that seat can read, so no other purse's amount reaches them. Linking is not counted as a player-visible update.
- Players' private notes are private journal entries (`journal-note`, visibility `player`) with an optional `questId`; a player may link only a quest in their own log. Older clients' journal writes keep the link.

## Who sees what (`projectQuests`, from `projectRecord`, also inside archived reports)

- DM: everything.
- Party audience: every visible party player character, including characters away from the party (knowledge is not lost by walking off), not NPC companions or non-party characters.
- Character audience: the listed characters, stored at reveal time (a group reveal stores its members). Co-recipients' names are shown (owner decision D3).
- Never sent to players: drafts, DM notes, `editedAt`, revision, hidden objectives (and their chronicle lines, pins and areas), DM-only chronicle lines, a giver NPC the seat cannot read, places of hidden groups the seat is not in, map pins and areas on maps or pins the seat cannot see, and reward links to receipts the seat could not already read (own lines; party lines for seats travelling with the party; pool resolutions for party seats).
- Linked places are added to the player's market projection so their names resolve.

## Screens (`src/components/quests.tsx`, `quest-view.ts`, `quest-toasts.tsx`)

- `/features/quests` (`?quest=<id>` opens one): DM list with In play / Drafts / Done / Failed / Archived and search, editor, Reveal sheet ("Who knows about it?"), Close sheet, Add entry, Link a receipt, View as player. Players: Active / Done / Failed, detail, Follow, My notes.
- Desk → Current session: Quests in play (`DeskQuestsGlance`). Player Home: the followed quest and a Quest log link (the six fixed shortcuts are unchanged, owner decision D9). Journal links to Quests. NPC cards: Quests from <NPC> (the DM also gets New quest from <NPC>). Map Here sheet: Quests here when an open visible objective's place, the quest's place or its giver's place is on the path of the viewer's group place.
- Follow and the Updated/New marks are per device (`localStorage` key per campaign and seat, wrapped in try/catch; an in-memory copy keeps working when storage is blocked). Guests get the same.
- "Quest updated": a toast when a synced table brings a newer `updatedAt` for a quest the seat can read; primed on first load, never on the DM's device. Background push uses the existing chat notes when the DM ticks "Also send them a message".

## Map (`src/components/quests-map.tsx`, `quest-view.ts` `questsOnMap`)

- The map's Quests slot (`MapQuestsSlot`, `campaign-map.tsx`): a **Quests (Q)** tool, the `#map-quests` panel, Layers › Quest markers / Quest areas, and the quest layer. The DM always has the tool; a player only when a quest they know has something on this map.
- **Pins** (accent diamonds) sit beside: the quest's linked map pins (markers or record placements), open visible objectives' map pins, and the places (market locations) of the quest and its open objectives where this map shows that location (its placement, else its anchor or nearest anchored parent, like other records). Tapping one opens the panel on that quest.
- **Radius areas** (dashed accent circles): `areas` in the quest, a general area the DM may place off the real target. The DM drags the centre or the edge handle (arrow keys on a focused handle), or edits label, radius and objective in the panel; the radius is typed in the map's units when it has a grid (feet) or a scale bar (mi, km, ft), else as a percentage of the width (`areaRadiusUnits` / `areaRadiusFromUnits`). An area tied to an objective shows only while that objective is open (and, for players, revealed).
- **Panel:** Show all / Only followed / None (which quests the map draws; a picked quest is always drawn), the quests on this map, and the picked quest's open objectives with Open the quest log. Picking a quest highlights it and frames its pins and areas (zooming in as far as 3×). DM: choose any active quest, Link a pin on this map / unlink, Add radius area, edit and delete areas. Places stay linked in the quest editor (Where, each objective's place), which also has a Map pin field for the quest and each objective.
- **Links:** `/maps?quest=<id>` opens the first map where the quest has something, with the panel on that quest. The quest log's Show on map uses it, falling back to `?record=` for a place or giver.
- **Fog and vision (approved):** an area reaches a player only on a map they can open with its centre outside concealed fog and within vision, the rule pins and templates follow; a pin link (map + marker ID, in the quest or an objective) only when that pin would: an accessible map, a party-visible marker or placement, its point visible (`mapPointVisibleTo`, `tabletop.ts`). On a joined player's device the maps are already projected, so the device does not judge sight again (`tabletopProjected`). Pins follow their map pin's own projection.
- **No tabletop protocol bump (approved):** areas and pin links live in `journal.quests`, outside every strict map schema; older apps drop them without error and cannot overwrite them.
