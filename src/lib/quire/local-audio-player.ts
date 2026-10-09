import type { LocalAudioLibrary, LocalTrack, AudioScene } from "./local-audio-library.ts";
export type PlayerState = {
  playlistId?: string;
  trackId?: string;
  status: "stopped" | "loading" | "playing" | "paused";
  error: string;
};
type AudioOutput = Pick<
  HTMLAudioElement,
  | "src"
  | "volume"
  | "currentTime"
  | "play"
  | "pause"
  | "load"
  | "removeAttribute"
  | "onended"
  | "onerror"
>;
type Environment = {
  open: () => AudioOutput;
  source: (track: LocalTrack) => Promise<string>;
  revoke: (source: string) => void;
  own: (active: boolean, ambience?: string) => void;
  allowed: () => boolean;
  visible: () => boolean;
  random?: () => number;
};
const STOPPED: PlayerState = { status: "stopped", error: "" };
/** One streaming media element; imported files are never decoded into an unbounded RAM cache. */
export class LocalAudioPlayer {
  private output?: AudioOutput;
  private library?: LocalAudioLibrary;
  private state: PlayerState = STOPPED;
  private listeners = new Set<() => void>();
  private version = 0;
  private source?: string;
  private scene?: string;
  private visited = new Set<string>();
  private readonly environment: Environment;
  constructor(environment: Environment) {
    this.environment = environment;
  }
  getSnapshot = () => this.state;
  getServerSnapshot = () => STOPPED;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(state: PlayerState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  configure(library: LocalAudioLibrary, scene = this.scene) {
    this.library = library;
    if (!this.environment.allowed()) {
      this.stop();
      return;
    }
    if (
      this.state.trackId &&
      (!library.tracks.some((x) => x.id === this.state.trackId) ||
        !library.playlists
          .find((x) => x.id === this.state.playlistId)
          ?.tracks.includes(this.state.trackId))
    ) {
      this.stop();
      return;
    }
    if (this.output) this.output.volume = library.volume;
    if (this.state.status !== "stopped") this.own(true);
    const changed = scene !== this.scene;
    this.scene = scene;
    const assigned = scene && library.assignments[scene as AudioScene];
    if (
      changed &&
      assigned &&
      library.followScenes &&
      this.state.status === "playing" &&
      assigned !== this.state.playlistId
    )
      void this.play(assigned);
  }
  private own(active: boolean) {
    this.environment.own(
      active,
      active && this.library?.ambience !== "scene" ? this.library?.ambience : undefined,
    );
  }
  private clear() {
    this.version++;
    if (this.output) {
      this.output.pause();
      this.output.onended = null;
      this.output.onerror = null;
      this.output.removeAttribute("src");
      this.output.load();
    }
    if (this.source) this.environment.revoke(this.source);
    this.source = undefined;
  }
  async play(playlistId: string, trackId?: string, continuing = false) {
    if (!this.environment.allowed() || !this.environment.visible() || !this.library) {
      this.stop();
      return;
    }
    const playlist = this.library.playlists.find((x) => x.id === playlistId);
    const id = trackId || playlist?.tracks[0],
      track = this.library.tracks.find((x) => x.id === id);
    if (!playlist?.tracks.includes(id || "") || !track) {
      this.stop("This playlist has no audio. Add a track first.");
      return;
    }
    if (
      this.state.status === "paused" &&
      this.state.trackId === id &&
      this.state.playlistId === playlistId &&
      this.source &&
      this.output
    ) {
      const version = ++this.version;
      this.events(version);
      this.set({ ...this.state, status: "loading" });
      try {
        await this.output.play();
        if (version === this.version)
          this.set({ playlistId, trackId: id, status: "playing", error: "" });
      } catch {
        if (version === this.version)
          this.stop("Playback could not resume. Press Play to try again.");
      }
      return;
    }
    if (!continuing) this.visited.clear();
    this.visited.add(id!);
    this.clear();
    const version = this.version;
    this.set({ playlistId, trackId: id, status: "loading", error: "" });
    this.own(true);
    try {
      const source = await this.environment.source(track);
      if (version !== this.version || !this.environment.allowed() || !this.environment.visible()) {
        this.environment.revoke(source);
        return;
      }
      this.source = source;
      this.output ??= this.environment.open();
      const output = this.output;
      output.volume = this.library.volume;
      output.src = source;
      this.events(version);
      await output.play();
      if (version === this.version && this.environment.allowed() && this.environment.visible())
        this.set({ playlistId, trackId: id, status: "playing", error: "" });
    } catch (error) {
      if (version === this.version)
        this.stop(
          error instanceof Error && /missing|read/.test(error.message)
            ? error.message
            : "Audio could not start. Check the file and device volume, then press Play.",
        );
    }
  }
  private events(version: number) {
    if (!this.output) return;
    this.output.onended = () => {
      if (version === this.version && this.state.status === "playing") this.next(true);
    };
    this.output.onerror = () => {
      if (version === this.version)
        this.stop("This file could not play on this device. Try another audio format.");
    };
  }
  pause() {
    if (this.state.status === "loading") {
      this.clear();
      this.own(false);
      this.set({ ...this.state, status: "stopped" });
      return;
    }
    if (this.state.status !== "playing") return;
    this.version++;
    this.output?.pause();
    this.set({ ...this.state, status: "paused" });
  }
  next(ended = false) {
    const playlist = this.library?.playlists.find((x) => x.id === this.state.playlistId);
    if (!playlist?.tracks.length) {
      this.stop();
      return;
    }
    const index = playlist.tracks.indexOf(this.state.trackId || ""),
      last = index === playlist.tracks.length - 1;
    if (ended && last && !this.library?.repeat && !this.library?.shuffle) {
      this.stop();
      return;
    }
    let candidates = playlist.tracks.filter((id) => !this.visited.has(id));
    if (this.library?.shuffle && !candidates.length) {
      if (ended && !this.library.repeat) {
        this.stop();
        return;
      }
      this.visited.clear();
      if (this.state.trackId) this.visited.add(this.state.trackId);
      candidates = playlist.tracks.filter((id) => id !== this.state.trackId);
    }
    const id =
      this.library?.shuffle && candidates.length
        ? candidates[
            Math.min(
              candidates.length - 1,
              Math.floor((this.environment.random?.() ?? Math.random()) * candidates.length),
            )
          ]
        : playlist.tracks[(index + 1) % playlist.tracks.length];
    void this.play(playlist.id, id, true);
  }
  stop(error = "") {
    this.visited.clear();
    this.clear();
    this.own(false);
    this.set({ ...STOPPED, error });
  }
  visibility() {
    if (!this.environment.visible()) this.pause();
  }
  dispose() {
    this.stop();
    this.output = undefined;
    this.library = undefined;
    this.scene = undefined;
  }
}
