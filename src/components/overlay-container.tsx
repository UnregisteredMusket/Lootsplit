import { createContext } from "react";

/** Fullscreen native dialogs own their descendants' portalled overlays. */
export const OverlayContainer = createContext<HTMLElement | null>(null);
