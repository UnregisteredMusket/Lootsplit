import { useEffect } from "react";
import { useBlocker } from "@tanstack/react-router";

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
      if (
        current.pathname === next.pathname &&
        JSON.stringify(current.search) === JSON.stringify(next.search)
      )
        return false;
      return !window.confirm(`Discard unsaved ${subject} changes and leave this view?`);
    },
  });
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
