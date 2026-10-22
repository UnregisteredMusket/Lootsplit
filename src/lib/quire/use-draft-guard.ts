import { useEffect } from "react";
import { useBlocker } from "@tanstack/react-router";
import { onPaneClose, usePane } from "@/components/split-view";

const CONTEXT_CHANGE = "lootsplit:before-context-change";
export function allowContextChange() {
  return window.dispatchEvent(new Event(CONTEXT_CHANGE, { cancelable: true }));
}

/** Keep character/encounter drafts safe when using the shared navigation. */
export function useDraftGuard(dirty: boolean, subject: string) {
  // Router history covers Link, programmatic navigation, and native Back/Forward.
  // A document click listener misses history changes and can prompt twice for Link.
  useBlocker({
    disabled: !dirty,
    enableBeforeUnload: dirty,
    shouldBlockFn: ({ current, next }) => {
      // Hash-only scrolling and links to this same view do not discard its draft.
      // Opening, resizing or closing the split-view pane beside this view is not leaving it.
      if (
        current.pathname === next.pathname &&
        JSON.stringify(withoutPane(current.search)) === JSON.stringify(withoutPane(next.search))
      )
        return false;
      return !window.confirm(`Discard unsaved ${subject} changes and leave this view?`);
    },
  });
  const pane = usePane()?.side;
  useEffect(() => {
    // Closing, swapping or replacing a split-view pane asks before discarding its draft.
    if (!dirty || !pane) return;
    return onPaneClose(pane, (e) => {
      if (!window.confirm(`Discard unsaved ${subject} changes and leave this view?`)) e.preventDefault();
    });
  }, [dirty, subject, pane]);
  useEffect(() => {
    if (!dirty) return;
    const confirm = () => window.confirm(`Discard unsaved ${subject} changes and leave this view?`);
    const context = (e: Event) => {
      if (!confirm()) e.preventDefault();
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
