import assert from "node:assert/strict";
import test from "node:test";
import { readNotes } from "./chat.ts";
import { unreadMessages, readThrough } from "./chat-read.ts";
import { canReadNote, conversationFor } from "./chat-visibility.ts";
const a = { role: "player" as const, purseIds: ["a"] };
const b = { role: "player" as const, purseIds: ["b"] };
const dm = { role: "dm" as const, purseIds: [] };
const notes = readNotes([
  { id: "1", at: 10, from: "player", to: "party", purseId: "b", text: "Hello" },
  {
    id: "2",
    at: 10,
    from: "player",
    to: "player",
    purseId: "b",
    recipientId: "a",
    text: "Private",
  },
]);
test("private recipients survive serialization without exposing them to other seats", () => {
  assert.equal(notes[1]?.recipientId, "a");
  assert.equal(canReadNote(notes[1]!, a), true);
  assert.equal(canReadNote(notes[1]!, b), true);
  assert.equal(canReadNote(notes[1]!, dm), false);
  assert.equal(conversationFor(notes[1]!, a), "b");
  assert.equal(conversationFor(notes[1]!, b), "a");
});
test("reading one thread leaves other threads unread and handles tied timestamps", () => {
  assert.equal(unreadMessages(notes, a, {}).length, 2);
  const cursor = readThrough([notes[0]!]);
  assert.deepEqual(
    unreadMessages(notes, a, { party: cursor }).map((n) => n.id),
    ["2"],
  );
  const later = { ...notes[0]!, id: "0" };
  assert.equal(unreadMessages([later], a, { party: cursor }).length, 1);
  assert.equal(unreadMessages([later], a, { party: readThrough([later], cursor) }).length, 0);
  assert.equal(unreadMessages(notes, b, {}).length, 0);
});
