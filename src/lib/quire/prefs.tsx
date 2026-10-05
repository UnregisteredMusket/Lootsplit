import { configureSound, unlockSound, playSound } from "./sound.ts";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useEconomy } from "./economy-context.tsx";
import { formatDollars } from "./money.ts";
import { applyTheme, DEFAULT_ACCENT, DEFAULT_GROUND, type Appearance } from "./theme.ts";
import type { Wealth } from "./types.ts";

export type AppPrefs = {
  soundEnabled: boolean;
  soundVolume: number;
  rollMode: "manual" | "virtual";
  showDollars: boolean;
  confirmRemoves: boolean;
  repriceOnRealm: boolean;
  nightReading: boolean;
  ledgerRows: number;
  readScale: number;
  inventCount: number;
  defaultWealth: Wealth;
  defaultSell: number;
  defaultBuy: number;
  defaultScale: number;
  defaultDepth: number;
  carryCommon: boolean;
  carryUncommon: boolean;
  carryRare: boolean;
  carryMagic: boolean;
  appearance: Appearance;
  accent: string;
  ground: string;
};

export const DEFAULT_PREFS: AppPrefs = {
  soundEnabled: false,
  soundVolume: 0.35,
  rollMode: "virtual",
  showDollars: true,
  confirmRemoves: false,
  repriceOnRealm: false,
  nightReading: false,
  ledgerRows: 8,
  readScale: 1,
  inventCount: 4,
  defaultWealth: "modest",
  defaultSell: 1,
  defaultBuy: 0.5,
  defaultScale: 1,
  defaultDepth: 1,
  carryCommon: true,
  carryUncommon: true,
  carryRare: false,
  carryMagic: false,
  appearance: "dark",
  accent: DEFAULT_ACCENT,
  ground: DEFAULT_GROUND,
};

const KEY = "quire.prefs.v1";
const WEALTHS: Wealth[] = ["poor", "modest", "rich", "princely"];

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

function hexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

export function normalizePrefs(input: Partial<AppPrefs> | null | undefined): AppPrefs {
  const wealth = WEALTHS.includes(input?.defaultWealth as Wealth) ? (input?.defaultWealth as Wealth) : DEFAULT_PREFS.defaultWealth;
  return {
    soundEnabled: flag(input?.soundEnabled, false),
    soundVolume: num(input?.soundVolume, 0, 1, 0.35),
    rollMode: input?.rollMode === "manual" ? "manual" : "virtual",
    showDollars: flag(input?.showDollars, DEFAULT_PREFS.showDollars),
    confirmRemoves: flag(input?.confirmRemoves, DEFAULT_PREFS.confirmRemoves),
    repriceOnRealm: flag(input?.repriceOnRealm, DEFAULT_PREFS.repriceOnRealm),
    nightReading: flag(input?.nightReading, DEFAULT_PREFS.nightReading),
    ledgerRows: Math.round(num(input?.ledgerRows, 4, 24, DEFAULT_PREFS.ledgerRows)),
    readScale: Math.round(num(input?.readScale, 0, 3, DEFAULT_PREFS.readScale)),
    inventCount: Math.round(num(input?.inventCount, 1, 12, DEFAULT_PREFS.inventCount)),
    defaultWealth: wealth,
    defaultSell: num(input?.defaultSell, 0.5, 2, DEFAULT_PREFS.defaultSell),
    defaultBuy: num(input?.defaultBuy, 0.1, 1, DEFAULT_PREFS.defaultBuy),
    defaultScale: num(input?.defaultScale, 0.5, 2.5, DEFAULT_PREFS.defaultScale),
    defaultDepth: num(input?.defaultDepth, 0.4, 1.6, DEFAULT_PREFS.defaultDepth),
    carryCommon: flag(input?.carryCommon, DEFAULT_PREFS.carryCommon),
    carryUncommon: flag(input?.carryUncommon, DEFAULT_PREFS.carryUncommon),
    carryRare: flag(input?.carryRare, DEFAULT_PREFS.carryRare),
    carryMagic: flag(input?.carryMagic, DEFAULT_PREFS.carryMagic),
    appearance: input?.appearance === "light" ? "light" : "dark",
    accent: hexColor(input?.accent, DEFAULT_PREFS.accent),
    ground: hexColor(input?.ground, DEFAULT_PREFS.ground),
  };
}

export function loadPrefs(): AppPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    return normalizePrefs(JSON.parse(raw) as Partial<AppPrefs>);
  } catch {
    return DEFAULT_PREFS;
  }
}

function storePrefs(prefs: AppPrefs) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(prefs));
}

type PrefsApi = {
  ready: boolean;
  prefs: AppPrefs;
  setPrefs: (patch: Partial<AppPrefs>) => void;
  resetPrefs: () => void;
};

const PrefsContext = createContext<PrefsApi | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<AppPrefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPrefsState(loadPrefs());
    setReady(true);
  }, []);

  useEffect(() => {
    applyTheme(prefs.appearance, prefs.accent, prefs.ground);
  }, [prefs.appearance, prefs.accent, prefs.ground]);

  useEffect(() => {
    configureSound(prefs.soundEnabled, prefs.soundVolume);
    if (!ready || !prefs.soundEnabled) return;
    const gesture = () => unlockSound();
    const navigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;
      const target = new URL(link.href);
      if (target.origin === location.origin && !target.pathname.startsWith("/api/") && !target.pathname.startsWith("/assets/") && target.pathname !== location.pathname)
        void playSound("page");
    };
    window.addEventListener("pointerdown", gesture);
    window.addEventListener("keydown", gesture);
    document.addEventListener("click", navigation, true);
    return () => {
      configureSound(false, prefs.soundVolume);
      window.removeEventListener("pointerdown", gesture);
      window.removeEventListener("keydown", gesture);
      document.removeEventListener("click", navigation, true);
    };
  }, [ready, prefs.soundEnabled, prefs.soundVolume]);

  const api = useMemo<PrefsApi>(
    () => ({
      ready,
      prefs,
      setPrefs: (patch) => {
        setPrefsState((current) => {
          const next = normalizePrefs({ ...current, ...patch });
          storePrefs(next);
          return next;
        });
      },
      resetPrefs: () => {
        storePrefs(DEFAULT_PREFS);
        setPrefsState(DEFAULT_PREFS);
      },
    }),
    [prefs, ready],
  );

  return <PrefsContext.Provider value={api}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const value = useContext(PrefsContext);
  if (!value) throw new Error("Preferences are unavailable.");
  return value;
}

export function useDollarText() {
  const { prefs } = usePrefs();
  const { realm } = useEconomy();
  return (copper: number) => (prefs.showDollars ? formatDollars(copper, realm.gpDollars) : null);
}
