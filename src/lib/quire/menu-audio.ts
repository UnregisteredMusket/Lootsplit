/** Locally bundled, optional scene loops. Audio never participates in campaign commands. */
export const MENU_AUDIO_FILES = {
  town: "/audio/scenes/town.mp3",
  study: "/audio/scenes/study.mp3",
  mystery: "/audio/scenes/mystery.mp3",
  fire: "/audio/scenes/fire.mp3",
  water: "/audio/scenes/water.mp3",
  crickets: "/audio/scenes/crickets.mp3",
  dungeon: "/audio/scenes/dungeon.mp3",
} as const;

export function sceneAudio(scene: string | undefined, appearance: string) {
  if (!scene) return {};
  const outdoor = appearance === "light" ? "water" : "crickets";
  const scenes = {
    "market-street": ["town", outdoor],
    "village-square": ["town", outdoor],
    tavern: ["town", "fire"],
    blacksmith: ["town", "fire"],
    "ancient-library": ["study", "fire"],
    "throne-room": ["study", "fire"],
    "mage-tower-study": ["mystery", "dungeon"],
    "dungeon-corridor": ["mystery", "dungeon"],
  } as const;
  const pair = scenes[scene as keyof typeof scenes];
  return pair ? { music: MENU_AUDIO_FILES[pair[0]], ambience: MENU_AUDIO_FILES[pair[1]] } : {};
}

export type MenuAudioOptions = {
  scene?: string;
  appearance: string;
  musicEnabled: boolean;
  musicVolume: number;
  ambienceEnabled: boolean;
  ambienceVolume: number;
};
type Layer = {
  file?: string;
  volume: number;
  version: number;
  pending: boolean;
  source?: AudioBufferSourceNode;
  gain?: GainNode;
};
type AudioEnvironment = {
  open: () => AudioContext | undefined;
  load: (file: string) => Promise<ArrayBuffer>;
  visible: () => boolean;
};

/** Two independent layers, bounded decoded cache, and cancellation of obsolete downloads. */
export class MenuAudioController {
  private context?: AudioContext;
  private unlocked = false;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private layers: Layer[] = [
    { volume: 0, version: 0, pending: false },
    { volume: 0, version: 0, pending: false },
  ];
  private environment: AudioEnvironment;
  constructor(environment: AudioEnvironment) {
    this.environment = environment;
  }

  configure(options: MenuAudioOptions) {
    const files = sceneAudio(options.scene, options.appearance);
    const values = [
      [options.musicEnabled ? files.music : undefined, options.musicVolume],
      [options.ambienceEnabled ? files.ambience : undefined, options.ambienceVolume],
    ] as const;
    values.forEach(([file, volume], index) => {
      const layer = this.layers[index];
      const level = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
      if (layer.file !== file || level === 0) this.stop(layer);
      layer.file = file;
      layer.volume = level;
      if (layer.gain && this.context) {
        layer.gain.gain.cancelScheduledValues(this.context.currentTime);
        layer.gain.gain.setTargetAtTime(level, this.context.currentTime, 0.08);
      }
    });
    this.refresh();
  }

  /** Only invoke from a real user gesture; loading/configuration never opens audio. */
  async unlock(enabling = false): Promise<boolean> {
    if (!this.environment.visible()) return false;
    if (!enabling && !this.layers.some((layer) => layer.file && layer.volume > 0)) return false;
    try {
      this.context ??= this.environment.open();
      if (!this.context) return false;
      this.unlocked = true;
      if (this.context.state === "suspended") await this.context.resume();
      if (this.context.state !== "running") return false;
      this.refresh();
      return true;
    } catch {
      this.unlocked = false;
      return false;
    }
  }

  refresh() {
    const context = this.context;
    for (const layer of this.layers) {
      if (!this.environment.visible()) {
        this.stop(layer);
        continue;
      }
      if (
        !this.unlocked ||
        !context ||
        context.state !== "running" ||
        !layer.file ||
        layer.volume === 0 ||
        layer.source ||
        layer.pending
      )
        continue;
      const file = layer.file;
      const version = ++layer.version;
      layer.pending = true;
      let buffer = this.buffers.get(file);
      if (!buffer) {
        buffer = this.environment.load(file).then((bytes) => context.decodeAudioData(bytes));
        this.buffers.set(file, buffer);
        // A rejected asset is retried only on a later interaction/configuration.
        void buffer.catch(() => {
          if (this.buffers.get(file) === buffer) this.buffers.delete(file);
        });
        // Two current loops plus one recently used loop, rather than every visited scene.
        while (this.buffers.size > 3) this.buffers.delete(this.buffers.keys().next().value!);
      }
      void buffer
        .then((decoded) => {
          if (
            version !== layer.version ||
            !this.unlocked ||
            !this.environment.visible() ||
            context.state !== "running" ||
            layer.volume === 0 ||
            layer.file !== file
          )
            return;
          layer.gain ??= context.createGain();
          layer.gain.disconnect();
          layer.gain.connect(context.destination);
          layer.gain.gain.setValueAtTime(0, context.currentTime);
          layer.gain.gain.linearRampToValueAtTime(layer.volume, context.currentTime + 0.2);
          const source = context.createBufferSource();
          source.buffer = decoded;
          source.loop = true;
          source.connect(layer.gain);
          layer.source = source;
          source.start();
        })
        .catch(() => {
          // Missing assets, offline downloads and unsupported decoding remain optional.
          if (version === layer.version) this.stop(layer);
        })
        .finally(() => {
          if (version === layer.version) layer.pending = false;
        });
    }
  }

  private stop(layer: Layer) {
    layer.version++;
    layer.pending = false;
    if (layer.source) {
      try {
        layer.source.stop();
      } catch {
        /* Already stopped by the browser. */
      }
      layer.source.disconnect();
      layer.source = undefined;
    }
  }

  dispose() {
    this.unlocked = false;
    for (const layer of this.layers) {
      this.stop(layer);
      layer.gain?.disconnect();
      layer.gain = undefined;
    }
    this.buffers.clear();
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }
}

export const menuAudio = new MenuAudioController({
  open: () =>
    typeof window !== "undefined" && window.AudioContext ? new window.AudioContext() : undefined,
  load: async (file) => {
    const response = await fetch(file);
    if (!response.ok) throw new Error("Menu audio unavailable");
    return response.arrayBuffer();
  },
  visible: () => typeof document !== "undefined" && !document.hidden,
});
