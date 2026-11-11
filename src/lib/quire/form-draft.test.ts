import assert from "node:assert/strict";
import test from "node:test";
import {
  editFormDraft,
  formDraftView,
  idleFormDraft,
  settleFormDraft,
  type FormDraftState,
} from "./form-draft.ts";

// Audit 2026-11-10 D5/D6: edit forms keyed by their record's content remounted on every save and
// reload (section closed, notice gone), and forms that copied props into state in an effect put
// back the saved value over what the DM was typing. These pin the draft rules the forms now use.

/** One render: what the form shows, with the state React would hold after it. */
function render<D>(state: FormDraftState<D>, source: D) {
  const view = formDraftView(state, source);
  return { ...view, state: view.reset ? idleFormDraft(source) : state };
}

test("an untouched form follows the saved record at once", () => {
  let state = idleFormDraft({ hours: 8 });
  assert.deepEqual(render(state, { hours: 8 }).value, { hours: 8 });
  // Another seat (or a reload) changes the record: the form shows it, with no stale render.
  const after = render(state, { hours: 6 });
  assert.deepEqual(after.value, { hours: 6 });
  assert.equal(after.dirty, false);
  state = after.state;
  assert.deepEqual(render(state, { hours: 6 }).value, { hours: 6 });
});

test("a reload or another seat's change never replaces what is being typed", () => {
  let state = idleFormDraft({ name: "Rope", notes: "" });
  state = editFormDraft(state, { name: "Rope", notes: "" }, (d) => ({ ...d, notes: "Frayed" }));
  // Window focus reloads the campaign: same content, new object.
  let view = render(state, { name: "Rope", notes: "" });
  assert.deepEqual(view.value, { name: "Rope", notes: "Frayed" });
  assert.equal(view.dirty, true);
  // Another seat renames the record while the DM edits: the DM's draft stays.
  view = render(view.state, { name: "Silk rope", notes: "" });
  assert.deepEqual(view.value, { name: "Rope", notes: "Frayed" });
  assert.equal(view.dirty, true);
});

test("the draft ends when the saved record matches it", () => {
  let state = idleFormDraft({ gp: 176 });
  state = editFormDraft(state, { gp: 176 }, { gp: 4321 });
  const view = render(state, { gp: 4321 });
  assert.equal(view.dirty, false);
  assert.equal(view.reset, true);
  // From then on outside changes show again.
  assert.deepEqual(render(view.state, { gp: 10 }).value, { gp: 10 });
});

test("updaters build on what the form shows", () => {
  let state = idleFormDraft({ a: 1, b: 1 });
  state = editFormDraft(state, { a: 1, b: 1 }, (d) => ({ ...d, a: 2 }));
  state = editFormDraft(state, { a: 1, b: 1 }, (d) => ({ ...d, b: 3 }));
  assert.deepEqual(render(state, { a: 1, b: 1 }).value, { a: 2, b: 3 });
});

test("after a save the form shows what was saved until the record changes, then follows it", () => {
  const before = { lines: { greet: "Hello", bye: "" } };
  let state = editFormDraft(idleFormDraft(before), before, {
    lines: { greet: "Well met", bye: "" },
  });
  state = settleFormDraft(state, before);
  // A queued room command: the record has not changed yet. No flash of the old text.
  let view = render(state, before);
  assert.deepEqual(view.value, { lines: { greet: "Well met", bye: "" } });
  assert.equal(view.dirty, false);
  // The server stores a normalized record (empty line dropped): the form follows it, no stale
  // draft and no unsaved-changes guard.
  const saved = { lines: { greet: "Well met" } } as typeof before;
  view = render(view.state, saved);
  assert.deepEqual(view.value, saved);
  assert.equal(view.reset, true);
  assert.deepEqual(render(view.state, { lines: { greet: "Hi" } } as typeof before).value, {
    lines: { greet: "Hi" },
  });
});

test("settling an untouched form changes nothing", () => {
  const state = idleFormDraft({ x: 1 });
  assert.equal(settleFormDraft(state, { x: 1 }), state);
});
