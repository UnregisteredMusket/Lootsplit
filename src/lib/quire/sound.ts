/** Optional, device-local feedback. Never queues gameplay or delays a mutation. */
export const SOUND_FILES = {
  coins: "/audio/cc0/coins.wav",
  loot: "/audio/cc0/loot.wav",
  page: "/audio/cc0/page.wav",
} as const;
export type SoundCue = keyof typeof SOUND_FILES;
let enabled = false;
let volume = 0.35;
let context: AudioContext | undefined;
let gain: GainNode | undefined;
let generation = 0;
let lastPlayed = -Infinity;
const buffers = new Map<SoundCue, Promise<AudioBuffer>>();
const playing = new Set<AudioBufferSourceNode>();

export function configureSound(on: boolean, level: number) {
  enabled = on;
  volume = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0.35;
  if (gain && context) gain.gain.setValueAtTime(volume, context.currentTime);
  if (!on || volume === 0) {
    generation++;
    for (const source of playing) source.stop();
    playing.clear();
  }
}

/** Called only from user interaction; browsers may refuse automatic audio. */
export function unlockSound() {
  if (typeof window === "undefined" || !window.AudioContext) return;
  try {
    context ??= new window.AudioContext();
    if (!gain) {
      gain = context.createGain();
      gain.gain.value = volume;
      gain.connect(context.destination);
    }
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch {
    /* Audio is optional on unsupported devices. */
  }
}

export async function playSound(cue: SoundCue, preview = false): Promise<boolean> {
  if ((!enabled && !preview) || volume === 0 || typeof document === "undefined" || document.hidden)
    return false;
  // Preview is itself a user action; normal cues require a prior gesture.
  if (preview) unlockSound();
  const audio = context;
  if (!audio || !gain) return false;
  if (preview && audio.state === "suspended") {
    try {
      await audio.resume();
    } catch {
      return false;
    }
  }
  if (audio.state !== "running") return false;
  const now = performance.now();
  if (!preview && now - lastPlayed < 100) return false;
  lastPlayed = now;
  const version = ++generation;
  try {
    let buffer = buffers.get(cue);
    if (!buffer) {
      buffer = fetch(SOUND_FILES[cue]).then(async (r) => {
        if (!r.ok) throw new Error("Sound unavailable");
        return audio.decodeAudioData(await r.arrayBuffer());
      });
      buffers.set(cue, buffer);
      void buffer.catch(() => buffers.delete(cue));
    }
    const decoded = await buffer;
    if (
      version !== generation ||
      (!enabled && !preview) ||
      volume === 0 ||
      document.hidden ||
      audio.state !== "running"
    )
      return false;
    // Keep fast navigation and repeated clicks from stacking loud effects.
    for (const old of playing) old.stop();
    playing.clear();
    const source = audio.createBufferSource();
    source.buffer = decoded;
    source.connect(gain);
    source.onended = () => {
      playing.delete(source);
      source.disconnect();
    };
    playing.add(source);
    source.start();
    return true;
  } catch {
    return false;
  }
}
