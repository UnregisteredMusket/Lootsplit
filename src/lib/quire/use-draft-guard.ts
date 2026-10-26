import { useEffect } from "react";
import { useBlocker } from "@tanstack/react-router";
import { onPaneClose, usePane } from "@/components/split-view";
import { confirmDiscard } from "@/lib/quire/confirm-store";

export { confirmDiscard };

const CONTEXT_CHANGE = "lootsplit:before-context-change";
type GuardEvent = CustomEvent<{ subjects: string[] }>;
let passing = false;

/** Run `retry` once while the guards stand aside (the person already chose to discard). */
export function runDiscarded(retry: () => void) {
  passing = true;
  try {
    retry();
  } finally {
    passing = false;
  }
}

/**
 * Ask open drafts whether the campaign, role or workspace may change. Returns true when nothing
 * is unsaved. Otherwise it returns false and asks in a themed dialog; if the person chooses
 * "Discard changes", `retry` runs (the same action again, with the guards standing aside).
 */
export function allowContextChange(retry?: () => void) {
  const unsaved = unsavedSubjects();
  if (!unsaved) return true;
  void confirmDiscard(unsaved).then((discard) => {
    if (discard && retry) runDiscarded(retry);
  });
  return false;
}

/** The async form for async actions: true when nothing is unsaved or the person discards it. */
export async function confirmContextChange() {
  const unsaved = unsavedSubjects();
  return !unsaved || (await confirmDiscard(unsaved));
}

/** The drafts that object to a context change, or null when none do. */
function unsavedSubjects() {
  if (passing) return null;
  const detail = { subjects: [] as string[] };
  if (window.dispatchEvent(new CustomEvent(CONTEXT_CHANGE, { cancelable: true, detail })))
    return null;
  return detail.subjects;
}

/** Run `action` now when no draft is unsaved, or after the person chooses "Discard changes". */
export function afterContextChange(action: () => void) {
  if (allowContextChange(action)) action();
}

/** Keep character/encounter drafts safe when using the shared navigation. */
export function useDraftGuard(dirty: boolean, subject: string) {
  // Router history covers Link, programmatic navigation, and native Back/Forward.
  // A document click listener misses history changes and can prompt twice for Link.
  useBlocker({
    disabled: !dirty,
    enableBeforeUnload: dirty,
    shouldBlockFn: async ({ current, next }) => {
      // Hash-only scrolling and links to this same view do not discard its draft.
      // Opening, resizing or closing the split-view pane beside this view is not leaving it.
      if (
        current.pathname === next.pathname &&
        JSON.stringify(withoutPane(current.search)) === JSON.stringify(withoutPane(next.search))
      )
        return false;
      return !(await confirmDiscard([subject]));
    },
  });
  const pane = usePane()?.side;
  useEffect(() => {
    // Closing, swapping or replacing a split-view pane asks before discarding its draft.
    if (!dirty || !pane) return;
    return onPaneClose(pane, (e) => {
      e.preventDefault();
      e.detail.subjects.push(subject);
    });
  }, [dirty, subject, pane]);
  useEffect(() => {
    if (!dirty) return;
    const context = (e: Event) => {
      e.preventDefault();
      (e as GuardEvent).detail.subjects.push(subject);
    };
    window.addEventListener(CONTEXT_CHANGE, context);
    return () => {
      window.removeEventListener(CONTEXT_CHANGE, context);
    };
  }, [dirty, subject]);
}

function withoutPane(search: unknown) {
  if (!search || typeof search !== "object") return search;
  const rest = { ...(search as Record<string, unknown>) };
  delete rest.beside;
  return rest;
}
