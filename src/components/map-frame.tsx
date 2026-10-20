import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize, Minimize } from "lucide-react";
import { Button } from "./ui";
/** Native modal focus/escape handling, with the same mounted editor/viewport/draft. */
export function MapFrame({
  children,
  editor = false,
  title,
  actions,
  onFullChange,
  navigation,
}: {
  children: ReactNode;
  navigation?: ReactNode;
  editor?: boolean;
  title?: string;
  actions?: ReactNode;
  onFullChange?: (full: boolean) => void;
}) {
  const [full, setFull] = useState(false),
    root = useRef<HTMLDialogElement>(null),
    toggle = useRef<HTMLButtonElement>(null),
    ownsFullscreen = useRef(false),
    active = useRef(false);
  function changeFull(next: boolean) {
    active.current = next;
    setFull(next);
    onFullChange?.(next);
  }
  function exit() {
    changeFull(false);
    if (ownsFullscreen.current && document.fullscreenElement) {
      ownsFullscreen.current = false;
      void document.exitFullscreen().catch(() => {});
    }
    requestAnimationFrame(() => toggle.current?.focus());
  }
  function enter() {
    changeFull(true);
    // Dialogs cannot themselves request browser fullscreen. The document hosts
    // the same top-layer dialog; unsupported/embedded browsers keep viewport mode.
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      ownsFullscreen.current = true;
      void document.documentElement.requestFullscreen().then(
        () => {
          if (active.current && root.current) {
            // Browser fullscreen is added to the top layer after our dialog.
            // Raise the dialog again so the map stays above the document.
            root.current.close();
            root.current.showModal();
          } else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        },
        () => {
          ownsFullscreen.current = false;
        },
      );
    }
  }
  useEffect(() => {
    const changed = () => {
      if (ownsFullscreen.current && !document.fullscreenElement) {
        ownsFullscreen.current = false;
        exit();
      }
    };
    document.addEventListener("fullscreenchange", changed);
    return () => {
      active.current = false;
      document.removeEventListener("fullscreenchange", changed);
      if (ownsFullscreen.current && document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
    };
    // The exit callback only notifies this mounted frame's stable consumer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
        {full && title && <strong className="map-frame-title">{title}</strong>}
        {full && actions}
        <Button ref={toggle} onClick={() => (full ? exit() : enter())} aria-pressed={full}>
          {full ? (
            <Minimize size={16} aria-hidden="true" />
          ) : (
            <Maximize size={16} aria-hidden="true" />
          )}
          {full ? "Exit fullscreen" : editor ? "Fullscreen editor" : "Fullscreen map"}
        </Button>
      </div>
      {navigation}
      {children}
    </dialog>
  );
}
