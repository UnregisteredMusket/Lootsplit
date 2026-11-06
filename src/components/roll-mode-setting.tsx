import { usePrefs } from "@/lib/quire/prefs";
import { DICE_COLORS } from "@/components/dice-roll-3d";

export function RollModeSetting() {
  const { prefs, setPrefs } = usePrefs();
  return (
    <div className="setting-preferences">
      <label>
        Roll mode
        <select aria-label="Roll mode" value={prefs.rollMode}
          onChange={(e) => setPrefs({ rollMode: e.target.value === "manual" ? "manual" : "virtual" })}>
          <option value="manual">Pen &amp; Paper mode</option>
          <option value="virtual">Virtual Mode</option>
        </select>
      </label>
      <p>Pen &amp; Paper mode records your physical dice totals. Virtual Mode rolls dice in the app. Applies to character actions, custom dice, encounters and loot tables; saved on this device.</p>
      <p>Shared campaigns still follow the DM’s manual-roll permission. Enter final totals including modifiers; the app does not add them twice.</p>
      <label>
        <input type="checkbox" checked={prefs.diceAnimation}
          onChange={(e) => setPrefs({ diceAnimation: e.target.checked })} />
        Show 3D dice
      </label>
      <label>
        Dice colour
        <select aria-label="Dice colour" value={prefs.diceColor} disabled={!prefs.diceAnimation}
          onChange={(e) => setPrefs({ diceColor: e.target.value })}>
          {DICE_COLORS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <p>Character rolls throw 3D dice that land on the result the app recorded, so the dice always match the roll log. Saved on this device; off when your system asks for reduced motion. Pen &amp; Paper totals have no dice to show.</p>
    </div>
  );
}
