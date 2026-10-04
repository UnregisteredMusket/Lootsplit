export type Appearance = "dark" | "light";

export type Look = {
  id: string;
  label: string;
  appearance: Appearance;
  accent: string;
  ground: string;
};

export const FANTASY_LOOKS: Record<Appearance, Look> = {
  light: { id: "adventurers-ledger", label: "Adventurer’s Ledger", appearance: "light", accent: "#7c3224", ground: "#dfcca2" },
  dark: { id: "ironbound-dragon", label: "Ironbound Dragon", appearance: "dark", accent: "#d4ac67", ground: "#26221e" },
};

export function fantasyLook(appearance: Appearance, accent: string, ground: string): Look | undefined {
  const look = FANTASY_LOOKS[appearance];
  return accent.toLowerCase() === look.accent && ground.toLowerCase() === look.ground ? look : undefined;
}

export const LOOKS: Look[] = [
  FANTASY_LOOKS.light,
  FANTASY_LOOKS.dark,
  { id: "glass", label: "Glass", appearance: "dark", accent: "#e0a04a", ground: "#10182c" },
  { id: "ink", label: "Ink", appearance: "dark", accent: "#c4a574", ground: "#14120e" },
  { id: "grove", label: "Grove", appearance: "dark", accent: "#7dcea0", ground: "#10241c" },
  { id: "wine", label: "Wine", appearance: "dark", accent: "#e07a8a", ground: "#2a1218" },
  { id: "day", label: "Day", appearance: "light", accent: "#8d2436", ground: "#f6f1e6" },
  { id: "ledger", label: "Ledger", appearance: "light", accent: "#8a5a12", ground: "#f3ead7" },
];

export const DEFAULT_ACCENT = FANTASY_LOOKS.dark.accent;
export const DEFAULT_GROUND = FANTASY_LOOKS.dark.ground;

export function themeVars(appearance: Appearance, accent: string, ground: string): Record<string, string> {
  const dark = appearance === "dark";
  const fantasy = fantasyLook(appearance, accent, ground);
  const fg = fantasy ? (dark ? "#eee0c4" : "#382719") : dark ? "#f6f1e6" : "#1c1422";
  const elevated = fantasy ? (dark ? "#3b3227" : "#edddba") : mix(ground, dark ? "#ffffff" : "#000000", dark ? 0.08 : 0.045);
  const subtle = mix(ground, dark ? "#ffffff" : "#000000", dark ? 0.14 : 0.07);
  const border = mix(ground, accent, dark ? 0.42 : 0.34);
  const muted = fantasy ? (dark ? "#bdab8e" : "#60462f") : mix(fg, ground, 0.34);
  const faint = fantasy ? muted : mix(fg, ground, 0.32);
  const paper = dark ? "#f7f1e4" : "#fffaf3";
  // Keep the chosen accent while adapting text and primary controls to the page.
  const target = luminance(ground) > 0.3 ? "#000000" : "#ffffff";
  const contrast = (a: string, b: string) => {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  let lead = accent;
  for (let step = 1; step <= 20 && Math.min(contrast(lead, ground), contrast(lead, elevated), contrast(lead, subtle)) < 4.5; step++) {
    lead = mix(accent, target, step / 20);
  }
  return {
    "--color-bg": ground,
    "--color-elevated": elevated,
    "--color-subtle": subtle,
    "--color-border": border,
    "--color-lead": lead,
    "--color-fg": fg,
    "--color-muted": muted,
    "--color-faint": faint,
    "--color-accent": accent,
    "--color-paper": paper,
    "--color-paper-sunk": mix(paper, "#000000", dark ? 0.045 : 0.03),
    "--color-paper-line": mix(paper, accent, 0.38),
    "--color-ink": "#1a1422",
    "--color-paper-muted": "#5e564c",
    "--color-danger": "#9a3044",
  };
}

export function applyTheme(appearance: Appearance, accent: string, ground: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(themeVars(appearance, accent, ground))) {
    root.style.setProperty(key, value);
  }
  root.dataset.appearance = appearance;
  root.dataset.fantasyTheme = fantasyLook(appearance, accent, ground)?.id ?? "";
  root.style.colorScheme = appearance === "light" ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", ground);
}

export function luminance(hex: string): number {
  const [red, green, blue] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

export function mix(from: string, to: string, amount: number): string {
  const [ar, ag, ab] = hexToRgb(from);
  const [br, bg, bb] = hexToRgb(to);
  return rgbToHex(ar + (br - ar) * amount, ag + (bg - ag) * amount, ab + (bb - ab) * amount);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [parseInt(clean.slice(0, 2), 16) || 0, parseInt(clean.slice(2, 4), 16) || 0, parseInt(clean.slice(4, 6), 16) || 0];
}

function rgbToHex(red: number, green: number, blue: number): string {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}
