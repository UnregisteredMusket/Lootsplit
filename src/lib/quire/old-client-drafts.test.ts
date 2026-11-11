/**
 * Older apps and a turn-based seat's staged draft (audit 2026-11-10, C1). A seat's draft reaches
 * every device on that seat, and released Android apps parse it with a strict command schema: a
 * kind they don't know fails the whole poll ("The shared campaign response was incomplete…")
 * instead of asking them to finish on the updated website. So every command kind a released app
 * cannot parse must be refused at that app's protocol by `tabletopResponse`.
 *
 * The kinds each app parses are checked in (old-client-command-kinds.json); everything else in the
 * current command schema is unknown to it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { commandSchema } from "./commands.ts";
import { emptyCloudTable } from "./cloud.ts";
import { CURRENT_TABLETOP_PROTOCOL, tabletopResponse } from "./tabletop-protocol.ts";

type Client = { app: string; protocol: number; kinds: string[] };
const clients: Client[] = JSON.parse(
  readFileSync(new URL("./old-client-command-kinds.json", import.meta.url), "utf8"),
).clients;

const currentKinds: string[] = (commandSchema.options as unknown as { shape: { kind: { value: string } } }[]).map(
  (option) => option.shape.kind.value,
);

function respond(kind: string, protocol: number) {
  return tabletopResponse(
    { table: emptyCloudTable(), draft: JSON.stringify([{ id: `draft-${kind}`, kind }]) },
    protocol,
  );
}

test("the checked-in client lists name only kinds the current schema has", () => {
  assert.ok(currentKinds.length > 150);
  for (const client of clients) {
    assert.ok(client.protocol < CURRENT_TABLETOP_PROTOCOL, client.app);
    for (const kind of client.kinds) assert.ok(currentKinds.includes(kind), `${client.app}: ${kind}`);
  }
});

for (const client of clients) {
  test(`${client.app} (protocol ${client.protocol}) is asked to finish every draft kind it cannot parse`, () => {
    const known = new Set(client.kinds);
    const unknown = currentKinds.filter((kind) => !known.has(kind));
    assert.ok(unknown.length > 0);
    const passed = unknown.filter((kind) => {
      try {
        respond(kind, client.protocol);
        return true;
      } catch (error) {
        assert.match(String(error), /updated website/);
        return false;
      }
    });
    assert.deepEqual(passed, [], `kinds sent to ${client.app} although it cannot parse them`);
  });
}

test("the eight coin and item kinds reach the clients that know them", () => {
  for (const kind of ["post", "set-coins", "coin-exchange", "sale-split", "item-use", "item-recharge"]) {
    assert.throws(() => respond(kind, 19), /unfinished actions/);
    assert.doesNotThrow(() => respond(kind, 21));
  }
  for (const kind of ["item-attune", "attunement-limit"]) {
    assert.throws(() => respond(kind, 21), /unfinished actions/);
    assert.doesNotThrow(() => respond(kind, 24));
  }
  for (const kind of currentKinds) assert.doesNotThrow(() => respond(kind, CURRENT_TABLETOP_PROTOCOL));
});
