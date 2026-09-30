export type Appearance = "dark" | "light";

export type Look = {
  id: string;
  label: string;
  appearance: Appearance;
  accent: string;
  ground: string;
};

export const LOOKS: Look[] = [
  { id: "glass", label: "Glass", appearance: "dark", accent: "#e0a04a", ground: "#10182c" },
  { id: "ink", label: "Ink", appearance: "dark", accent: "#c4a574", ground: "#14120e" },
  { id: "grove", label: "Grove", appearance: "dark", accent: "#7dcea0", ground: "#10241c" },
  { id: "wine", label: "Wine", appearance: "dark", accent: "#e07a8a", ground: "#2a1218" },
  { id: "day", label: "Day", appearance: "light", accent: "#8d2436", ground: "#f6f1e6" },
  { id: "ledger", label: "Ledger", appearance: "light", accent: "#8a5a12", ground: "#f3ead7" },
];

export const DEFAULT_ACCENT = "#e0a04a";
export const DEFAULT_GROUND = "#10182c";

export function themeVars(appearance: Appearance, accent: string, ground: string): Record<string, string> {
  const dark = appearance === "dark";
  const fg = dark ? "#f6f1e6" : "#1c1422";
  const elevated = mix(ground, dark ? "#ffffff" : "#000000", dark ? 0.08 : 0.045);
  const subtle = mix(ground, dark ? "#ffffff" : "#000000", dark ? 0.14 : 0.07);
  const border = mix(ground, accent, dark ? 0.42 : 0.34);
  const muted = mix(fg, ground, 0.34);
  const faint = mix(fg, ground, 0.55);
  const paper = dark ? "#f7f1e4" : "#fffaf3";
  return {
    "--color-bg": ground,
    "--color-elevated": elevated,
    "--color-subtle": subtle,
    "--color-border": border,
    "--color-lead": accent,
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
