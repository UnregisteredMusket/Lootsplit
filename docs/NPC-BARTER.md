# NPC barter in conversation

Players can barter with location NPCs that the DM does not control directly. The NPC values each offer, and a Charisma (Persuasion) check rolled by the server decides close deals. The exchange is presented as a video-game conversation.

The owner approved the dialogue mockups on 2026-10-22. The owner's decisions are under [Owner decisions](#owner-decisions-2026-10-22).

## Who it applies to

- **Covered:** NPCs with **Bartering allowed** and **no player controller**. These are the NPCs that "answer barter on their own" (`npcAnswersBarter`).
- **Not covered:** NPCs with a controller keep the existing Trading & Barter table. Their controller decides, with no roll.
- **Unchanged:** party-to-party barter, Give, shops and exchanges.

## The conversation (`src/components/npc-conversation.tsx`)

`NpcConversation` is a reusable component. It appears under **People & NPCs → View & interact** (and on map NPC panels, which reuse that interaction) whenever the NPC is nearby.

The screen has three parts:

- **Portrait stage:** the NPC's portrait, a name plate and the "Speaking as" character choice.
- **Transcript:** NPC lines, the player's tagged replies, roll cards and receipts.
- **Numbered replies:** see below.

The top-level replies form a hub:

| Reply | What it does |
| --- | --- |
| Barter | Fully implemented here. |
| Shop | Opens the Market's shops. |
| Services | Lists every service provider the NPC runs (`service-hub.ts`, docs/SERVICES.md), each with the order command's availability check as its lock reason. One provider opens directly; several open a numbered sub-list. Locked with "offers no services" when there are none. |
| Talk | Opens the existing message thread, `#npc-messages`. |
| Farewell | Ends the conversation. |

Shop, Services and Talk navigate with `AppLink`. New branches add an entry to the replies list without changing the shell.

Barter replies keep fixed positions:

1. Show/hide my goods
2. The main reply, one of:
   - `[PERSUASION · DC n · odds · advantage]`
   - `[Offer · no roll needed]`
   - `[Too low · refused without a roll]`
   - `[DM decides · reason]`
   - a red `[Locked · until …]`
3. `[Sweeten · add n]`, when adding coins would avoid the roll
4. `[DM decides]`
5. Never mind

Odds appear in plain words with a percentage, and the fairness bar appears inside the reply.

Accessibility:

- Number keys 1–9 choose replies.
- Replies are at least 48px tall and span the full width on phones.
- The newest NPC line types out, and any key or tap shows it in full.
- Screen readers always get the full text.
- Reduced motion turns off typing and the dice spin.
- There is no horizontal scroll at 320px.

The roll card shows the DC, one die or two (the kept die highlighted), the arithmetic and the result. The client only replays the result it receives.

## Valuation and DC (`src/lib/quire/npc-barter.ts`, `quoteNpcBarter`)

One pure function serves the DM/offline preview and the authoritative command. A player in a shared room gets the same quote from the room server (`quoteCloudNpcBarter`), stripped of valuation.

**What the NPC gives** is its offered lots at full recorded value (`unitCopper`), plus coins.

**What the NPC receives** is the coins, plus each offered lot at `floor(value × units × receivePercent / 100)`. Three exceptions apply:

- **Unwanted category:** a lot in a category outside the NPC's `wants` counts 0.
- **Daily unit cap:** units beyond the cap per good (`unitCap` per 24 in-game hours) count 0. The count includes accepted trades in the window.
- **No reference price:** a lot with `valueSource: "player"` counts 0 and sends the offer to the DM, unless the DM supplies a value for that deal.

**Fairness** is received ÷ given, stored in thousandths.

**DC:**

```
DC = clamp(5, 25, round(10 + 25 × (1 − fairness)) + stance + repeatDc × failedTries)
```

Stance adds −2 (Generous), 0 (Fair) or +2 (Shrewd). `failedTries` counts failed tries in the last 24 in-game hours.

**Kind** is decided in this order:

1. DM queue, when any of these holds:
   - the offer includes goods without a reference price;
   - the NPC would give more than `offerCapCopper`;
   - the party's 24-hour total from this NPC would exceed `dailyCapCopper`;
   - there are already `attemptsBeforeQueue` failed tries.
2. Accept without a roll, at `acceptPercent` or more.
3. Refuse without a roll, below `refusePercent`.
4. Otherwise, a check.

**Roll:** d20 + the sheet's Persuasion bonus (`rollSpec(sheet, "skill", "Persuasion")`). The bonus is +0 with no sheet.

- Advantage applies at Charisma 16 or more, disadvantage at 8 or less.
- A natural 20 is not an automatic success.
- The odds come from the exact d20 distribution.

**Counter:** a miss by `counterMargin` or less produces a counter-offer. The NPC asks for the coins that reach the accept-without-a-roll level, rounded up to the next silver. The counter is stored on the attempt. Accepting it needs no roll and uses the same atomic exchange. The counter lapses when the cooldown ends or when any lot changes.

## Anti-exploit rules

- **Re-rolls:** a failed try (a refusal, or a declined counter after a missed roll) locks equal or worse offers until `cooldownMinutes` of campaign time have passed. "Equal or worse" means less than 10 fairness points better than the failed try. A clearly better offer may try at once, at the higher DC. Memory is kept per NPC and per player account (`account:userId`, or `character:purseId` when the DM acts). Optional party memory covers everyone. The DM can clear a wait.
- **Junk at inflated values:** received goods count at 50%, so a buy-and-return loop loses value. Unwanted categories and units beyond the cap count nothing. Values a player set count nothing. `editCharacter` marks any value or quantity a player sets with `valueSource: "player"`; a DM edit removes the mark.
- **Splitting:** with `combineTrades` on, accepted trades with the same NPC in the last 24 in-game hours are added to the new offer, so small slices meet the same DC as the whole deal. The caps use the same window.
- **Retries:** command IDs make a retried action a no-op. In shared rooms, receipts in `room.commands` skip a repeated ID before the engine runs. Offline, the IndexedDB action receipt does the same. Because the roll lives on the stored attempt, a retry can never roll again.

## Modes

| Mode | Behaviour |
| --- | --- |
| DM decides (default) | Every offer is stored as `queued`. In the queue, the DM can roll on the server, accept, counter (extra copper), or decline. |
| Server rolls, DM confirms | The server rolls at once and the attempt waits in `confirm`. The DM confirms the result or overrules it with a reason, optionally shown to the player. |
| Automatic | The NPC accepts, counters or refuses at once. |

Each mode can be set per NPC (`npc.barter.mode`), or follow the campaign rules.

## Commands and storage

- **Schema:** `src/lib/quire/npc-barter-schema.ts` defines `npc-barter-rules`, `npc-barter-npc`, `npc-barter-offer`, `npc-barter-decide`, `npc-barter-resolve` and `npc-barter-clear-wait`. They are part of `commandSchema` and are applied by `applyNpcBarterCommand` from `commands.ts`, so offline (`executeLocalCommand`) and shared rooms run the same engine.
- **Storage:** state lives in the campaign journal, under `world.npcBarter` (rules, revision and every attempt) and an optional `npc.barter` per NPC. **No migration** is needed, and old saves load unchanged. History is never pruned; the activity list pages by 50.
- **Settlement:** `settleExchange` in `world.ts` is shared with player barter's `trade-decision`. It rechecks presence, lots, custody, deeds and both purses. It moves coins and lots once and writes one ledger line per side, keyed by the command ID.
- **Rolls:**
  - Shared rooms: the room server rolls through the existing authoritative random source (`TradeExecution.random`). Two unbiased d100 draws map to d20.
  - Offline: the DM's device rolls locally.
  - Refused: a player-link device, or any client preview without the room's authority.
- **Submission:** `npc-barter-*` commands are submitted directly to the room, like seasonal plans, and are never staged as turn drafts. They require no other pending actions.

## Privacy

`projectNpcBarter` (called from `projectRecord`) gives players:

- only their own attempts, with `received`, `given` and `ratio` zeroed, the account key replaced, and DM values and reasons removed (unless shown);
- default rules in place of the campaign's rules;
- for each NPC, only the greeting, barter and farewell lines.

Stance, mode, wanted goods and unused lines stay DM-only. NPC purses were already private. The quote endpoint returns `publicQuote` to players. Untouched campaigns project exactly as before.

## Owner decisions (2026-10-22)

- Hybrid system: fairness sets the DC, the server rolls Charisma (Persuasion) with advantage at CHA 16+ and disadvantage at CHA ≤ 8, and the odds are shown in plain language before sending.
- Simple counters on narrow misses.
- New DM setting, default **DM decides**. **Server rolls, DM confirms** is kept as a third mode, and **Automatic** is available.
- Defaults, all DM-adjustable:
  - 50% value for received goods
  - accept without a roll at 110% or more
  - refuse below 60%
  - 50 gp per offer and 200 gp per day
  - 5 units per good
- Refusal memory is per player account by default. Party-wide memory is an option.
- Stance lines are the defaults. The DM can edit each NPC's ten lines.
- Dialogue presentation approved: "The dialog looks good".

## Development and verification rules

When changing this feature, run the following and keep the `/money-command` checklist:

- `npc-barter.test.ts`
- `npc-barter-offline.test.ts`
- the NPC barter case in `player-view-privacy.test.ts`
- the browser audit `scripts/npc-barter-browser-audit.mjs` (`npm run verify:focus -- npc-barter`; CI step `dev-npc-barter`)

Keep the quote function shared between preview and command. Never roll on a player's device. Never add NPC valuation, rules or purse to a player projection.
