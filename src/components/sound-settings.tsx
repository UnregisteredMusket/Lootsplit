import { useState } from "react";
import { usePrefs } from "@/lib/quire/prefs";
import { configureSound, playSound, type SoundCue } from "@/lib/quire/sound";
import { Button } from "./ui";

export function SoundSettings() {
  const { prefs, setPrefs } = usePrefs();
  const [message, setMessage] = useState("");
  return (
    <fieldset className="grid gap-3" aria-label="Sound effects">
      <legend className="font-medium">Fantasy sound effects</legend>
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={prefs.soundEnabled}
          onChange={(e) => {
            configureSound(e.target.checked, prefs.soundVolume);
            setPrefs({ soundEnabled: e.target.checked });
          }}
        />{" "}
        Enable sound effects
      </label>
      <label className="grid gap-2">
        Sound volume · {Math.round(prefs.soundVolume * 100)}%
        <input
          aria-label="Sound volume"
          type="range"
          min="0"
          max="100"
          value={Math.round(prefs.soundVolume * 100)}
          onChange={(e) => {
            const soundVolume = Number(e.target.value) / 100;
            configureSound(prefs.soundEnabled, soundVolume);
            setPrefs({ soundVolume });
          }}
        />
      </label>
      <p className="text-sm text-muted">
        Optional feedback on this device. Preview a sound even while effects are off; volume still
        applies.
      </p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["coins", "Coins"],
            ["loot", "Loot"],
            ["page", "Page turn"],
          ] as [SoundCue, string][]
        ).map(([cue, label]) => (
          <Button
            key={cue}
            variant="secondary"
            onClick={() => {
              configureSound(prefs.soundEnabled, prefs.soundVolume);
              void playSound(cue, true).then((played) =>
                setMessage(
                  played ? `Preview: ${label}` : "Sound could not play. Check volume or try again.",
                ),
              );
            }}
          >
            Preview {label.toLowerCase()}
          </Button>
        ))}
      </div>
      <p role="status" className="text-sm text-muted">
        {message}
      </p>
      <p className="text-xs text-muted">CC0 sounds by rubberduck. Credits in Resources.</p>
    </fieldset>
  );
}
