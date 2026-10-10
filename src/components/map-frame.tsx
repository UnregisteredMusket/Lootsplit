import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize, Minimize } from "lucide-react";
import { Button } from "./ui";
/** Native modal focus/escape handling, with the same mounted editor/viewport/draft. */
export function MapFrame({ children, editor = false }: { children: ReactNode; editor?: boolean }) {
  const [full, setFull] = useState(false),
    root = useRef<HTMLDialogElement>(null),
    toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = root.current!;
    dialog.close();
    if (full) dialog.showModal();
    else dialog.show();
    if (!full) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      dialog.close();
    };
  }, [full]);
  function exit() {
    setFull(false);
    requestAnimationFrame(() => toggle.current?.focus());
  }
  return (
    <dialog
      ref={root}
      open
      className={`map-frame ${editor ? "map-editor-frame" : "map-view-frame"} ${full ? "map-fullscreen" : ""}`}
      aria-label={editor ? "Map editor" : "Map viewer"}
      aria-modal={full}
      onCancel={(e) => {
        e.preventDefault();
        exit();
      }}
    >
      <div className="map-frame-bar">
        <Button ref={toggle} onClick={() => (full ? exit() : setFull(true))} aria-pressed={full}>
          {full ? (
            <Minimize size={16} aria-hidden="true" />
          ) : (
            <Maximize size={16} aria-hidden="true" />
          )}
          {full ? "Exit fullscreen" : editor ? "Fullscreen editor" : "Fullscreen map"}
        </Button>
      </div>
      {children}
    </dialog>
  );
}
