import { useEffect } from "react";

const CONTEXT_CHANGE = "lootsplit:before-context-change";
export function allowContextChange() {
  return window.dispatchEvent(new Event(CONTEXT_CHANGE, { cancelable: true }));
}

/** Keep character/encounter drafts safe when using the shared navigation. */
export function useDraftGuard(dirty: boolean, subject: string) {
  useEffect(() => {
    if (!dirty) return;
    const confirm = () => window.confirm(`Discard unsaved ${subject} changes and leave this view?`);
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const context = (e: Event) => {
      if (!confirm()) e.preventDefault();
    };
    const navigate = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const link = target?.closest<HTMLAnchorElement>("a[href]");
      if (!link) return;
      const destination = new URL(link.href, location.href);
      if (
        destination.pathname === location.pathname &&
        destination.search === location.search &&
        destination.hash
      )
        return;
      if (!confirm()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener(CONTEXT_CHANGE, context);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener(CONTEXT_CHANGE, context);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty, subject]);
}
