import assert from "node:assert/strict";
import test from "node:test";
import {
  activeDialog,
  confirmDiscard,
  dismissDialog,
  registerDialogHost,
  requestConfirm,
  requestPrompt,
  settleDialog,
  subscribeDialog,
} from "./confirm-store.ts";

function withWindow<T>(fake: Record<string, unknown>, run: () => Promise<T>) {
  const previous = (globalThis as any).window;
  (globalThis as any).window = fake;
  return run().finally(() => {
    if (previous === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previous;
  });
}

test("themed confirm resolves once, from the confirm button only", () =>
  withWindow({}, async () => {
    const unregister = registerDialogHost();
    let changes = 0;
    const stop = subscribeDialog(() => changes++);
    try {
      const answer = requestConfirm({ title: "Delete it?", tone: "danger" });
      const open = activeDialog();
      assert.equal(open?.kind, "confirm");
      assert.equal(open?.options.tone, "danger");
      settleDialog(open!.id, true);
      settleDialog(open!.id, false); // a late Cancel/close after confirming changes nothing
      assert.equal(await answer, true);
      assert.equal(activeDialog(), null);
      assert.equal(changes, 2);

      const cancelled = requestConfirm({ title: "Again?" });
      assert.equal(dismissDialog(), true); // Android back / Escape
      assert.equal(await cancelled, false);
      assert.equal(dismissDialog(), false);
    } finally {
      stop();
      unregister();
    }
  }));

test("a second question while one is open is cancelled, so nothing runs twice", () =>
  withWindow({}, async () => {
    const unregister = registerDialogHost();
    try {
      const first = requestConfirm({ title: "Transfer loot?" });
      assert.equal(await requestConfirm({ title: "Transfer loot?" }), false);
      assert.equal(await requestPrompt({ title: "Name", label: "Name" }), null);
      settleDialog(activeDialog()!.id, true);
      assert.equal(await first, true);
    } finally {
      unregister();
    }
  }));

test("themed prompt returns the typed text or null", () =>
  withWindow({}, async () => {
    const unregister = registerDialogHost();
    try {
      const typed = requestPrompt({ title: "Rename", label: "Name", defaultValue: "Old" });
      assert.equal(activeDialog()?.kind, "prompt");
      settleDialog(activeDialog()!.id, "New name");
      assert.equal(await typed, "New name");
      const cancelled = requestPrompt({ title: "Rename", label: "Name" });
      settleDialog(activeDialog()!.id, null);
      assert.equal(await cancelled, null);
    } finally {
      unregister();
    }
  }));

test("discard questions use the standard wording and tone", () =>
  withWindow({}, async () => {
    const unregister = registerDialogHost();
    try {
      const answer = confirmDiscard(["character", "map tool draft", "character"]);
      const open = activeDialog();
      assert.equal(open?.kind, "confirm");
      if (open?.kind !== "confirm") return;
      assert.equal(open.options.tone, "discard");
      assert.equal(open.options.title, "Discard unsaved changes?");
      assert.equal(
        open.options.body,
        "Discard unsaved character and map tool draft changes and leave this view?",
      );
      settleDialog(open.id, false);
      assert.equal(await answer, false);
    } finally {
      unregister();
    }
  }));

test("without a mounted host the question still reaches the person", async () => {
  let asked = "";
  await withWindow(
    {
      confirm: (text: string) => ((asked = text), true),
      prompt: (_text: string, value: string) => `${value}!`,
    },
    async () => {
      assert.equal(await requestConfirm({ title: "Approve?", body: "Details" }), true);
      assert.equal(asked, "Approve?\n\nDetails");
      assert.equal(await requestPrompt({ title: "Name", label: "Name", defaultValue: "A" }), "A!");
    },
  );
  // Server rendering never shows a dialog and never approves.
  assert.equal(await requestConfirm({ title: "Approve?" }), false);
  assert.equal(await requestPrompt({ title: "Name", label: "Name" }), null);
});
