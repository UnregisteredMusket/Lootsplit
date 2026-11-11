// A player can't use an error message to learn whether a guessed NPC ID is a hidden NPC (privacy
// review of PR 479). For a player seat, an NPC that doesn't exist and one that is hidden or not
// here give the very same refusal, in conversation (npc-message) and in barter (trade-offer); the
// DM keeps the detailed reasons.
import test from "node:test";
import assert from "node:assert/strict";
import type { CloudSeat } from "./cloud.ts";
import { dm, partyFixture, run, sam } from "./test-fixtures/party-groups.ts";

// Sister Maud is a hidden NPC at the party's place (Harbour ward); "npc-guess" doesn't exist.
const HIDDEN = "maud",
  UNKNOWN = "npc-guess";

function refusal(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  assert.fail("expected the command to be refused");
}
const message = (npcId: string, seat: CloudSeat, asNpc = false) =>
  refusal(() =>
    run(
      partyFixture(),
      { kind: "npc-message", npcId, purseId: "brannoc", asNpc, text: "Hello" } as never,
      seat,
    ),
  );
const offer = (npcId: string, seat: CloudSeat, quoted = false) =>
  refusal(() =>
    run(
      partyFixture(),
      {
        kind: "trade-offer",
        tradeId: "trade-guess",
        revision: null,
        actorId: "brannoc",
        left: { purseId: "brannoc", copper: 10, items: [] },
        right: {
          purseId: npcId,
          copper: 0,
          items: quoted ? [{ holdingId: "guessed-lot", quantity: 1, before: "{}" }] : [],
        },
        note: "",
      } as never,
      seat,
    ),
  );

test("a player gets one answer for a hidden NPC and an unknown ID in conversation", () => {
  assert.equal(message(HIDDEN, sam), "This NPC is not available at the current location.");
  assert.equal(message(UNKNOWN, sam), message(HIDDEN, sam));
  // Speaking as the NPC: a player who doesn't control it learns nothing more.
  assert.equal(message(UNKNOWN, sam, true), message(HIDDEN, sam, true));
});

test("a player gets one answer for a hidden NPC and an unknown ID in barter", () => {
  assert.equal(
    offer(HIDDEN, sam),
    "This NPC is not available for bartering at the current location.",
  );
  assert.equal(offer(UNKNOWN, sam), offer(HIDDEN, sam));
  // Quoting goods the player can't see changes nothing either.
  assert.equal(offer(UNKNOWN, sam, true), offer(HIDDEN, sam, true));
});

test("the DM keeps the detailed reasons", () => {
  assert.equal(message(UNKNOWN, dm), "NPC no longer exists.");
  assert.equal(offer(UNKNOWN, dm), "Trade account no longer exists.");
});

test("a player still reaches a visible NPC and gets the old texts for a visible one away", () => {
  const t = partyFixture();
  run(
    t,
    {
      kind: "npc-message",
      npcId: "ilse",
      purseId: "brannoc",
      asNpc: false,
      text: "Hello",
    } as never,
    sam,
  );
  assert.equal(message("durra", sam), "This NPC is not available at the current location.");
  assert.equal(message("ilse", sam, true), "Only the configured NPC controller can respond.");
});

test("a player acting as a guessed ID gets one answer for a hidden NPC and an unknown ID", () => {
  const actAs = (actorId: string, seat: CloudSeat) =>
    refusal(() =>
      run(
        partyFixture(),
        {
          kind: "trade-offer",
          tradeId: "trade-act-as",
          revision: null,
          actorId,
          left: { purseId: actorId, copper: 10, items: [] },
          right: { purseId: "brannoc", copper: 0, items: [] },
          note: "",
        } as never,
        seat,
      ),
    );
  assert.equal(
    actAs(HIDDEN, sam),
    "Only this participant or the DM can decide their side of the trade.",
  );
  assert.equal(actAs(UNKNOWN, sam), actAs(HIDDEN, sam));
  assert.equal(actAs(UNKNOWN, dm), "This trade account no longer exists.");
});

// Check order (privacy review of PR 489): the NPC check comes before any check of the character.
test("a player gets one answer whatever character a message to a guessed ID names", () => {
  const as = (npcId: string, purseId: string) =>
    refusal(() =>
      run(
        partyFixture(),
        { kind: "npc-message", npcId, purseId, asNpc: false, text: "Hello" } as never,
        sam,
      ),
    );
  for (const purseId of ["zzz", "tamsin"])
    assert.equal(as(UNKNOWN, purseId), as(HIDDEN, purseId), purseId);
  assert.equal(as(HIDDEN, "zzz"), "This NPC is not available at the current location.");
});

test("an NPC barter offer naming a guessed account gets one answer on either side", () => {
  const barter = (side: "give" | "ask", purseId: string) =>
    refusal(() =>
      run(
        partyFixture(),
        {
          kind: "npc-barter-offer",
          npcId: "ilse",
          purseId: "brannoc",
          give: { purseId: side === "give" ? purseId : "brannoc", copper: 10, items: [] },
          ask: { purseId: side === "ask" ? purseId : "ilse", copper: 0, items: [] },
          reply: "persuade",
        } as never,
        sam,
      ),
    );
  for (const side of ["give", "ask"] as const)
    assert.equal(barter(side, UNKNOWN), barter(side, HIDDEN), side);
  assert.equal(barter("ask", HIDDEN), "The offer's sides don't match this conversation.");
});
