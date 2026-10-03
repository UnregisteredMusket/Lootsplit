import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { APP_VERSION } from "@/lib/quire/version";
import { APP_DESCRIPTION } from "@/lib/help/content";
import { HelpContent } from "./help-content";

const OFFER = "quire.guide.offer.v3";

export function Guide() {
  const [ask, setAsk] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(OFFER)) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dawn = window.sessionStorage.getItem("quire.dawn.v1");
    const wait = !reduced && !dawn ? 1500 : 250;
    const handle = window.setTimeout(() => {
      if (!window.localStorage.getItem(OFFER)) setAsk(true);
    }, wait);
    return () => window.clearTimeout(handle);
  }, []);

  const choosing = useRef(false);

  function answer(view: boolean) {
    choosing.current = true;
    window.localStorage.setItem(OFFER, view ? "yes" : "no");
    setAsk(false);
    if (view) setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        className="mt-3 inline-flex min-h-11 items-center text-sm text-muted"
        onClick={() => setOpen(true)}
      >
        Help
      </button>
      <Modal
        open={ask}
        onOpenChange={(next) => {
          if (next || choosing.current) {
            choosing.current = false;
            return;
          }
          answer(false);
        }}
        title="View the instructions?"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">View the setup guide now, or open Help anytime.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => answer(false)}>
              Not now
            </Button>
            <Button onClick={() => answer(true)}>View guide</Button>
          </div>
        </div>
      </Modal>
      <Modal open={open} onOpenChange={setOpen} title="How Lootsplit works">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Lootsplit {APP_VERSION} · {APP_DESCRIPTION}
          </p>
          <HelpContent embedded onNavigate={() => setOpen(false)} />
          <Button onClick={() => setOpen(false)}>Close</Button>
        </div>
      </Modal>
    </>
  );
}
