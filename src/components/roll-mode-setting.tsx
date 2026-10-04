import { usePrefs } from "@/lib/quire/prefs";

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
    </div>
  );
}
