/** Device-only audio. Never included in campaign saves, backups, commands or account sync. */
export const AUDIO_DB = "lootsplit.local-audio.v1";
export const MAX_AUDIO_FILE = 50 * 1024 * 1024;
export const MAX_AUDIO_LIBRARY = 200 * 1024 * 1024;
export const AUDIO_LICENSES = [
  "CC0-1.0",
  "CC-BY-4.0",
  "Original work",
  "Permission / other license",
] as const;
export type AudioLicense = (typeof AUDIO_LICENSES)[number];
export type LocalTrack = {
  id: string;
  title: string;
  creator: string;
  source: string;
  license: AudioLicense;
  notes: string;
  bytes: number;
  bundled?: "town" | "study" | "mystery";
};
export type LocalPlaylist = { id: string; name: string; tracks: string[] };
export const AUDIO_SCENES = {
  tavern: "Tavern / characters",
  "market-street": "Market",
  "village-square": "Village / campaign",
  blacksmith: "Blacksmith / catalog",
  "ancient-library": "Library / journal",
  "throne-room": "Throne room / bank",
  "mage-tower-study": "Mage tower / settings",
  "dungeon-corridor": "Dungeon / encounters",
} as const;
export type AudioScene = keyof typeof AUDIO_SCENES;
export type LocalAudioLibrary = {
  version: 1;
  tracks: LocalTrack[];
  playlists: LocalPlaylist[];
  assignments: Partial<Record<AudioScene, string>>;
  volume: number;
  shuffle: boolean;
  repeat: boolean;
  followScenes: boolean;
  ambience: "scene" | "fire" | "water" | "crickets" | "dungeon";
};
export function starterAudioLibrary(): LocalAudioLibrary {
  const north = {
    creator: "North Fantasy Music",
    source: "https://opengameart.org/content/fantasy-music-and-drum-loops-pack",
    license: "CC-BY-4.0" as const,
    notes:
      "Full-length MP3 conversion, metadata removed, 60 ms edge fades. License: https://creativecommons.org/licenses/by/4.0/",
  };
  return {
    version: 1,
    tracks: [
      {
        id: "town",
        title: "Town Theme RPG",
        creator: "cynicmusic",
        source: "https://opengameart.org/content/town-theme-rpg",
        license: "CC0-1.0",
        notes: "Full-length MP3 conversion, metadata removed, 60 ms edge fades.",
        bytes: 1170226,
        bundled: "town",
      },
      { id: "study", title: "Soft Strings and Flutes", ...north, bytes: 708799, bundled: "study" },
      { id: "mystery", title: "Dark and Mysterious", ...north, bytes: 864907, bundled: "mystery" },
    ],
    playlists: [
      { id: "exploration", name: "Exploration", tracks: ["town", "study"] },
      { id: "combat", name: "Combat", tracks: ["mystery"] },
      { id: "tavern", name: "Tavern", tracks: ["town"] },
    ],
    assignments: {},
    volume: 0.4,
    shuffle: false,
    repeat: true,
    followScenes: false,
    ambience: "scene",
  };
}
export function audioSource(value: string): string {
  const text = value.trim();
  if (!text) return "";
  const url = new URL(text);
  if (url.protocol !== "https:" || url.username || url.password || text.length > 1000)
    throw Error("Use an HTTPS source link without credentials.");
  return url.href;
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}
export function validateAudioLibrary(value: unknown): LocalAudioLibrary {
  const lib = value as LocalAudioLibrary;
  if (
    !lib ||
    lib.version !== 1 ||
    !Array.isArray(lib.tracks) ||
    lib.tracks.length > 200 ||
    !Array.isArray(lib.playlists) ||
    lib.playlists.length > 50 ||
    !lib.assignments ||
    typeof lib.assignments !== "object" ||
    Array.isArray(lib.assignments)
  )
    throw Error("Saved audio library is unreadable. Your files have not been changed.");
  const ids = new Set<string>(),
    playlists = new Set<string>();
  for (const track of lib.tracks) {
    if (
      !track ||
      !text(track.id, 100) ||
      !track.id ||
      ids.has(track.id) ||
      !text(track.title, 160) ||
      !track.title.trim() ||
      !text(track.creator, 160) ||
      !track.creator.trim() ||
      !text(track.source, 1000) ||
      !text(track.notes, 2000) ||
      !AUDIO_LICENSES.includes(track.license) ||
      !Number.isSafeInteger(track.bytes) ||
      track.bytes <= 0 ||
      track.bytes > MAX_AUDIO_FILE ||
      (track.bundled !== undefined && !["town", "study", "mystery"].includes(track.bundled))
    )
      throw Error("Saved audio track is unreadable. Your files have not been changed.");
    if (audioSource(track.source) !== track.source) throw Error("Saved audio source is invalid.");
    ids.add(track.id);
  }
  for (const playlist of lib.playlists) {
    if (
      !playlist ||
      !text(playlist.id, 100) ||
      !playlist.id ||
      playlists.has(playlist.id) ||
      !text(playlist.name, 80) ||
      !playlist.name.trim() ||
      !Array.isArray(playlist.tracks) ||
      playlist.tracks.length > 200 ||
      new Set(playlist.tracks).size !== playlist.tracks.length ||
      playlist.tracks.some((id) => !ids.has(id))
    )
      throw Error("Saved playlist is unreadable. Your files have not been changed.");
    playlists.add(playlist.id);
  }
  if (
    Object.entries(lib.assignments).some(
      ([scene, id]) => !Object.hasOwn(AUDIO_SCENES, scene) || !playlists.has(id),
    ) ||
    !Number.isFinite(lib.volume) ||
    lib.volume < 0 ||
    lib.volume > 1 ||
    [lib.shuffle, lib.repeat, lib.followScenes].some((x) => typeof x !== "boolean") ||
    !["scene", "fire", "water", "crickets", "dungeon"].includes(lib.ambience) ||
    lib.tracks.filter((x) => !x.bundled).reduce((sum, x) => sum + x.bytes, 0) > MAX_AUDIO_LIBRARY
  )
    throw Error("Saved audio settings are unreadable. Your files have not been changed.");
  return lib;
}

export class AudioLibraryStorage {
  private database?: Promise<IDBDatabase>;
  private readonly factory: IDBFactory;
  private readonly allowed: () => boolean;
  constructor(factory: IDBFactory, allowed: () => boolean) {
    this.factory = factory;
    this.allowed = allowed;
  }
  private permit() {
    if (!this.allowed()) throw Error("Local playlists are available to the DM.");
  }
  private open() {
    this.permit();
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(AUDIO_DB, 1);
      let settled = false;
      const fail = (message: string) => {
        if (!settled) {
          settled = true;
          reject(Error(message));
        }
      };
      const timer = setTimeout(
        () => fail("Audio storage did not open. Close other Lootsplit tabs and retry."),
        5000,
      );
      request.onupgradeneeded = () => {
        request.result.createObjectStore("library");
        request.result.createObjectStore("files");
      };
      request.onerror = () => {
        clearTimeout(timer);
        fail("Audio storage is unavailable on this device.");
      };
      request.onblocked = () => {
        clearTimeout(timer);
        fail("Close other Lootsplit tabs and retry audio storage.");
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        request.result.onversionchange = () => {
          request.result.close();
          this.database = undefined;
        };
        resolve(request.result);
      };
    });
    return this.database.catch((error) => {
      this.database = undefined;
      throw error;
    });
  }
  async read(): Promise<LocalAudioLibrary> {
    const db = await this.open();
    this.permit();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("library", "readonly"),
        request = tx.objectStore("library").get("current");
      let library: LocalAudioLibrary;
      request.onsuccess = () => {
        try {
          this.permit();
          library =
            request.result === undefined
              ? starterAudioLibrary()
              : validateAudioLibrary(request.result);
        } catch (error) {
          reject(error);
        }
      };
      tx.oncomplete = () => resolve(library);
      tx.onabort = tx.onerror = () => reject(Error("Audio library could not be read."));
    });
  }
  /** Read-modify-write with files in the same transaction; quota failures retain the old library. */
  async change(
    edit: (library: LocalAudioLibrary, files: IDBObjectStore) => void,
  ): Promise<LocalAudioLibrary> {
    const db = await this.open();
    this.permit();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["library", "files"], "readwrite"),
        store = tx.objectStore("library"),
        request = store.get("current");
      let library: LocalAudioLibrary, failure: unknown;
      request.onsuccess = () => {
        try {
          this.permit();
          library =
            request.result === undefined
              ? starterAudioLibrary()
              : validateAudioLibrary(request.result);
          edit(library, tx.objectStore("files"));
          validateAudioLibrary(library);
          store.put(library, "current");
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(library);
      tx.onabort = () =>
        reject(
          failure ||
            Error(
              tx.error?.name === "QuotaExceededError"
                ? "Device storage is full. No audio files were added."
                : "Audio library could not be saved. Your previous library is unchanged.",
            ),
        );
      tx.onerror = () => {}; // onabort reports the final atomic outcome.
    });
  }
  async file(id: string): Promise<Blob> {
    const db = await this.open();
    this.permit();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readonly"),
        request = tx.objectStore("files").get(id);
      request.onsuccess = () => {
        try {
          this.permit();
          if (!(request.result instanceof Blob))
            throw Error("This audio file is missing. Import it again.");
          resolve(request.result);
        } catch (error) {
          reject(error);
        }
      };
      tx.onabort = tx.onerror = () => reject(Error("Audio file could not be read."));
    });
  }
  async import(
    file: File,
    metadata: Omit<LocalTrack, "id" | "bytes" | "bundled">,
    playlistId: string,
  ) {
    if (
      !file.size ||
      file.size > MAX_AUDIO_FILE ||
      !/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name)
    )
      throw Error("Choose an MP3, WAV, OGG, M4A, AAC, FLAC or WebM file up to 50 MB.");
    const track: LocalTrack = {
      ...metadata,
      source: audioSource(metadata.source),
      id: crypto.randomUUID(),
      bytes: file.size,
    };
    return this.change((library, files) => {
      const playlist = library.playlists.find((x) => x.id === playlistId);
      if (!playlist) throw Error("Select a playlist before adding audio.");
      library.tracks.push(track);
      playlist.tracks.push(track.id);
      files.put(file, track.id);
    });
  }
}
