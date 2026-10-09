import { useState } from "react";
import { usePrefs } from "@/lib/quire/prefs";
import { menuAudio } from "@/lib/quire/menu-audio";
import { Button } from "./ui";

export function MenuAudioSettings() {
  const { prefs, setPrefs } = usePrefs();
  const [message, setMessage] = useState("");
  return (
    <fieldset className="grid gap-3 mt-5" aria-label="Menu music and ambience">
      <legend className="font-medium">Menu music & ambience</legend>
      <p className="text-sm text-muted">
        Music and atmosphere follow the submenu scenes, including day and night outdoor sounds.
        Saved on this device. Pauses in background tabs and outside these menus.
      </p>
      {(["music", "ambience"] as const).map((layer) => {
        const enabledKey = layer === "music" ? "musicEnabled" : "ambienceEnabled";
        const volumeKey = layer === "music" ? "musicVolume" : "ambienceVolume";
        const label = layer === "music" ? "Menu music" : "Ambient sound";
        return (
          <div className="grid gap-2" key={layer}>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={prefs[enabledKey]}
                onChange={(e) => {
                  setPrefs({ [enabledKey]: e.target.checked });
                  if (e.target.checked) void menuAudio.unlock(true);
                }}
              />
              Enable {label.toLowerCase()}
            </label>
            <label className="grid gap-2">
              {label} volume · {Math.round(prefs[volumeKey] * 100)}%
              <input
                aria-label={`${label} volume`}
                type="range"
                min="0"
                max="100"
                value={Math.round(prefs[volumeKey] * 100)}
                onChange={(e) => setPrefs({ [volumeKey]: Number(e.target.value) / 100 })}
              />
            </label>
          </div>
        );
      })}
      <Button
        variant="secondary"
        disabled={!prefs.musicEnabled && !prefs.ambienceEnabled}
        onClick={() =>
          void menuAudio
            .unlock()
            .then((ready) =>
              setMessage(
                ready
                  ? "Menu audio ready. Enabled layers play at their chosen volume in submenus."
                  : "Audio could not start. Check your device volume, then try again.",
              ),
            )
        }
      >
        Start / resume menu audio
      </Button>
      <p role="status" className="text-sm text-muted">
        {message}
      </p>
      <p className="text-xs text-muted">Free licensed music and ambience. Credits in Resources.</p>
    </fieldset>
  );
}
