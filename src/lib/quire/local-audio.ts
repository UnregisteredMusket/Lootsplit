import {
  AudioLibraryStorage,
  type LocalAudioLibrary,
  type LocalTrack,
} from "./local-audio-library.ts";
import { LocalAudioPlayer } from "./local-audio-player.ts";
import { MENU_AUDIO_FILES, menuAudio } from "./menu-audio.ts";
import { getSeat } from "./table.ts";
type LibraryState = { library?: LocalAudioLibrary; loading: boolean; error: string };
const EMPTY: LibraryState = { loading: false, error: "" };
let state = EMPTY,
  storage: AudioLibraryStorage | undefined,
  generation = 0;
const listeners = new Set<() => void>();
export function localAudioAllowed() {
  if (typeof window === "undefined" || getSeat().role !== "dm") return false;
  try {
    const account = sessionStorage.getItem("lootsplit.verified-account");
    const campaign = localStorage.getItem("quire.campaign.v1") || "main";
    return !!account && localStorage.getItem(`quire.owner.${campaign}`) === account;
  } catch {
    return false;
  }
}
function notify(next: LibraryState) {
  state = next;
  for (const listener of listeners) listener();
}
function deviceStorage() {
  if (typeof indexedDB === "undefined")
    throw Error("Local audio storage is unavailable on this device.");
  return (storage ??= new AudioLibraryStorage(indexedDB, localAudioAllowed));
}
export const localAudioPlayer = new LocalAudioPlayer({
  open: () => {
    const audio = new Audio();
    audio.preload = "metadata";
    return audio;
  },
  source: async (track: LocalTrack) =>
    track.bundled
      ? MENU_AUDIO_FILES[track.bundled]
      : URL.createObjectURL(await deviceStorage().file(track.id)),
  revoke: (source) => {
    if (source.startsWith("blob:")) URL.revokeObjectURL(source);
  },
  own: (active, ambience) =>
    menuAudio.setLocalPlayback(
      active,
      ambience ? MENU_AUDIO_FILES[ambience as keyof typeof MENU_AUDIO_FILES] : undefined,
    ),
  allowed: localAudioAllowed,
  visible: () => typeof document !== "undefined" && !document.hidden,
});
export const localAudioLibrary = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => state,
  getServerSnapshot: () => EMPTY,
  async load() {
    const version = ++generation;
    notify({ ...state, loading: true, error: "" });
    try {
      const library = await deviceStorage().read();
      if (version === generation) {
        notify({ library, loading: false, error: "" });
        localAudioPlayer.configure(library);
      }
    } catch (error) {
      if (version === generation)
        notify({
          ...state,
          loading: false,
          error: error instanceof Error ? error.message : "Audio storage is unavailable.",
        });
    }
  },
  async save(edit: Parameters<AudioLibraryStorage["change"]>[0]) {
    const version = generation;
    const library = await deviceStorage().change(edit);
    if (version === generation) {
      notify({ library, loading: false, error: "" });
      localAudioPlayer.configure(library);
    }
  },
  async import(
    file: File,
    metadata: Omit<LocalTrack, "id" | "bytes" | "bundled">,
    playlistId: string,
  ) {
    const version = generation;
    const library = await deviceStorage().import(file, metadata, playlistId);
    if (version === generation) {
      notify({ library, loading: false, error: "" });
      localAudioPlayer.configure(library);
    }
  },
  clearMemory() {
    generation++;
    localAudioPlayer.dispose();
    notify(EMPTY);
  },
};
