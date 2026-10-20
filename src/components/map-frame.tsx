import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OverlayContainer } from "./overlay-container";
import { Button } from "./ui";

type Props = {
  children: ReactNode;
  editor?: boolean;
  title?: string;
  actions?: ReactNode;
  navigation?: ReactNode;
  onClose?: () => void;
  interfaceHidden?: boolean;
};
/** Maps is a route-sized workspace. Native browser fullscreen is optional, never its layout state. */
export function MapFrame(props: Props) {
  return props.editor ? <EditorFrame {...props} /> : <WorkspaceFrame {...props} />;
}
function WorkspaceFrame({ children, title, actions, navigation, interfaceHidden }: Props) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () =>
      container?.style.setProperty(
        "--map-usable-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
    resize();
    viewport?.addEventListener("resize", resize);
    return () => viewport?.removeEventListener("resize", resize);
  }, [container]);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  return (
    <div
      ref={setContainer}
      className="map-frame map-view-frame map-fullscreen map-workspace"
      role="region"
      aria-label="Map workspace"
      data-interface-hidden={interfaceHidden || undefined}
    >
      {title && <h1 className="sr-only">{title}</h1>}
      {navigation}
      {actions}
      <OverlayContainer.Provider value={container}>{children}</OverlayContainer.Provider>
    </div>
  );
}
function EditorFrame({ children, onClose }: Props) {
  const root = useRef<HTMLDialogElement>(null);
  const [container, setContainer] = useState<HTMLDialogElement | null>(null);
  const attach = useCallback((node: HTMLDialogElement | null) => {
    root.current = node;
    setContainer(node);
  }, []);
  useEffect(() => {
    const dialog = root.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={attach}
      className="map-frame map-editor-frame map-fullscreen"
      aria-label="Map editor"
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
    >
      <div className="map-editor-header">
        <strong>Map editor</strong>
        <Button onClick={onClose}>Close editor</Button>
      </div>
      <OverlayContainer.Provider value={container}>{children}</OverlayContainer.Provider>
    </dialog>
  );
}
