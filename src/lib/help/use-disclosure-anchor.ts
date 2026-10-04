import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";

/** Open only the explicitly addressed native disclosure, retaining its normal toggle behavior. */
export function useDisclosureAnchor(id: string) {
  const ref = useRef<HTMLDetailsElement>(null);
  const hash = useRouterState({ select: (s) => s.location.hash });
  useEffect(() => {
    if (hash === id && ref.current) {
      ref.current.open = true;
      ref.current.scrollIntoView({ block: "start" });
    }
  }, [hash, id]);
  return ref;
}
