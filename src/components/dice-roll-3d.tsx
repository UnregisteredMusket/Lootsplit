/**
 * 3D dice on screen when an in-app roll is made (owner request 2026-11-06).
 *
 * The roll is already decided and saved when this runs (server dice in shared campaigns, device
 * dice offline); the dice are thrown forced to land on those values (src/lib/dice/three-d-dice.ts),
 * so the animation can only show the real result. The library (@3d-dice/dice-box-threejs with
 * three.js and cannon-es, all MIT) is loaded the first time dice are thrown, never on page load.
 * Plain colours only: no third-party textures or sounds are loaded.
 *
 * Off when the device's 3D dice setting is off or the system asks for reduced motion; the written
 * result next to the roll button is unchanged either way.
 */
import { useEffect, useRef, useState } from "react";
import type DiceBoxType from "@3d-dice/dice-box-threejs";
import { onDice } from "@/lib/dice/dice-events";
import { DEFAULT_PREFS } from "@/lib/quire/prefs";
import { diceCaption, diceThrow, shownValues, type DiceThrow, type RecordedRoll } from "@/lib/dice/three-d-dice";
import { usePrefs } from "@/lib/quire/prefs";

export const DICE_COLORS = [
  { id: "ivory", name: "Ivory", background: "#f3ead7", foreground: "#2b2118", outline: "#f3ead7" },
  { id: "obsidian", name: "Obsidian", background: "#1d1d22", foreground: "#e9d8a6", outline: "#1d1d22" },
  { id: "crimson", name: "Crimson", background: "#8e1b24", foreground: "#fbe9d0", outline: "#5c0f15" },
  { id: "sapphire", name: "Sapphire", background: "#1f4e8c", foreground: "#f4f1e8", outline: "#12305a" },
  { id: "emerald", name: "Emerald", background: "#1e6b46", foreground: "#f6efd9", outline: "#114029" },
  { id: "gold", name: "Gold", background: "#c99a2e", foreground: "#2a1b05", outline: "#8a6514" },
  { id: "amethyst", name: "Amethyst", background: "#5b3a8c", foreground: "#f3ecff", outline: "#3a2360" },
] as const;

const BOX_ID = "lootsplitter-dice-box";
const SETTLED_MS = 2600;

function colorset(id: string) {
  const c = DICE_COLORS.find((d) => d.id === id) ?? DICE_COLORS[0];
  return { name: `lootsplitter-${c.id}`, foreground: c.foreground, background: c.background, outline: c.outline, texture: "none", material: "plastic" };
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** The app's dice host: follows the device's 3D dice settings. */
export function DiceRollHost() {
  const { prefs } = usePrefs();
  return <DiceStage enabled={prefs.diceAnimation} colorId={prefs.diceColor} />;
}

/**
 * The TV display's dice host (its route mounts no settings provider): the DM's window sends the
 * rolls; the display throws them in the default colour, and still not under reduced motion.
 */
export function DisplayDiceHost() {
  return <DiceStage enabled colorId={DEFAULT_PREFS.diceColor} />;
}

function DiceStage({ enabled: on, colorId }: { enabled: boolean; colorId: string }) {
  const prefs = { diceAnimation: on, diceColor: colorId };
  const box = useRef<DiceBoxType | null>(null);
  const boxReady = useRef<Promise<DiceBoxType> | null>(null);
  const color = useRef(prefs.diceColor);
  const enabled = useRef(prefs.diceAnimation);
  const generation = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [shown, setShown] = useState<{ caption: string; settled: boolean } | null>(null);
  color.current = prefs.diceColor;
  enabled.current = prefs.diceAnimation;

  function dismiss() {
    generation.current++;
    clearTimeout(hideTimer.current);
    setShown(null);
    try {
      box.current?.clearDice();
    } catch {
      /* Not started yet. */
    }
  }

  async function ready(): Promise<DiceBoxType> {
    boxReady.current ??= (async () => {
      const { default: DiceBox } = await import("@3d-dice/dice-box-threejs");
      const instance = new DiceBox(`#${BOX_ID}`, {
        sounds: false,
        shadows: true,
        theme_surface: "green-felt",
        theme_customColorset: colorset(color.current),
        theme_material: "plastic",
        gravity_multiplier: 400,
        // Larger dice on wider screens; phones keep the library's size so several dice fit.
        baseScale: window.innerWidth >= 700 ? 150 : 110,
        strength: 1.4,
      });
      await instance.initialize();
      box.current = instance;
      return instance;
    })();
    return boxReady.current;
  }

  async function throwRoll(roll: RecordedRoll, t: DiceThrow) {
    const gen = ++generation.current;
    clearTimeout(hideTimer.current);
    setShown({ caption: diceCaption(roll, t), settled: false });
    try {
      const instance = await ready();
      if (gen !== generation.current) return;
      await instance.updateConfig({ theme_customColorset: colorset(color.current) });
      let result = await instance.roll(t.notation);
      if (gen !== generation.current) return;
      // The library relabels a d4 to land on its forced value but keeps reporting the value it
      // read before relabelling (every other die is read again). Read d4s again so the check
      // below compares what is actually showing.
      if (instance.diceList.some((d) => d.shape === "d4")) {
        for (const d of instance.diceList)
          if (d.shape === "d4") {
            d.result = [];
            d.storeRolledValue("forced");
          }
        result = instance.getDiceResults();
      }
      const faces = result.sets.flatMap((set) => set.rolls.map((r) => r.value));
      const showing = shownValues(t, faces);
      if (showing.join() !== t.results.map((r) => r.value).join())
        // The caption always shows the recorded roll; a mismatch is a display fault only.
        console.warn(`[dice] The 3D dice did not land on the recorded values: ${t.notation} showed ${JSON.stringify(faces)}`);
    } catch (error) {
      if (gen !== generation.current) return;
      console.warn("[dice] 3D dice unavailable", error);
    }
    if (gen !== generation.current) return;
    setShown((s) => (s ? { ...s, settled: true } : s));
    hideTimer.current = setTimeout(() => {
      if (gen === generation.current) dismiss();
    }, SETTLED_MS);
  }

  useEffect(
    () =>
      onDice((roll) => {
        if (!enabled.current || reducedMotion()) return;
        const t = diceThrow(roll);
        if (t) void throwRoll(roll, t);
      }),
    [],
  );

  useEffect(() => {
    if (!shown) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [shown]);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  return (
    <div className="dice-roll-overlay" data-open={shown ? "true" : "false"} data-settled={shown?.settled ? "true" : "false"}>
      <div id={BOX_ID} className="dice-roll-box" aria-hidden="true" />
      {shown && (
        <div className="dice-roll-caption">
          <span>{shown.caption}</span>
          <button type="button" onClick={dismiss}>
            Close dice
          </button>
        </div>
      )}
    </div>
  );
}
