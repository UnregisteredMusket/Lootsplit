import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  AudioLibraryStorage,
  AUDIO_DB,
  starterAudioLibrary,
  validateAudioLibrary,
  audioSource,
  MAX_AUDIO_FILE,
} from "../src/lib/quire/local-audio-library.ts";
import { LocalAudioPlayer } from "../src/lib/quire/local-audio-player.ts";
const metadata = {
  title: "Test track",
  creator: "Test creator",
  source: "",
  license: "Original work",
  notes: "Written for the test.",
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const file = () => new File(["audio test bytes"], "test.wav", { type: "audio/wav" });

test("atomic local imports survive fresh storage readers, concurrent edits retain both changes", async () => {
  const factory = new IDBFactory(),
    storage = new AudioLibraryStorage(factory, () => true);
  const saved = await storage.import(file(), metadata, "exploration"),
    id = saved.tracks.at(-1).id;
  assert.equal(await (await storage.file(id)).text(), "audio test bytes");
  const second = new AudioLibraryStorage(factory, () => true);
  await Promise.all([
    storage.change((lib) => {
      lib.playlists[0].name = "Journeys";
    }),
    second.change((lib) => {
      lib.volume = 0.17;
    }),
  ]);
  const reloaded = await second.read();
  assert.equal(reloaded.playlists[0].name, "Journeys");
  assert.equal(reloaded.volume, 0.17);
  assert.ok(reloaded.playlists[0].tracks.includes(id));
  await second.change((lib, files) => {
    lib.tracks = lib.tracks.filter((x) => x.id !== id);
    for (const playlist of lib.playlists) playlist.tracks = playlist.tracks.filter((x) => x !== id);
    files.delete(id);
  });
  await assert.rejects(storage.file(id), /missing/);
});

test("invalid edits, quota errors and invalid imports preserve both metadata and files", async () => {
  const factory = new IDBFactory(),
    storage = new AudioLibraryStorage(factory, () => true);
  const before = await storage.change(() => {});
  await assert.rejects(
    storage.change((lib, files) => {
      files.put(file(), "orphan");
      lib.playlists[0].tracks.push("missing");
    }),
    /unreadable/,
  );
  await assert.rejects(storage.file("orphan"), /missing/);
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === "library") throw new DOMException("Full", "QuotaExceededError");
    return original.apply(this, args);
  };
  try {
    await assert.rejects(storage.import(file(), metadata, "exploration"), /Full/);
  } finally {
    IDBObjectStore.prototype.put = original;
  }
  assert.deepEqual(await storage.read(), before);
  await assert.rejects(
    storage.import(new File(["bad"], "track.exe"), metadata, "exploration"),
    /Choose/,
  );
  const large = file();
  Object.defineProperty(large, "size", { value: MAX_AUDIO_FILE + 1 });
  await assert.rejects(storage.import(large, metadata, "exploration"), /50 MB/);
  await assert.rejects(
    storage.import(file(), { ...metadata, source: "javascript:alert(1)" }, "exploration"),
    /HTTPS/,
  );
  await assert.rejects(storage.import(file(), metadata, "deleted-playlist"), /Select/);
  assert.deepEqual(await storage.read(), before);
});

test("player role cannot open audio storage and revocation during an open does not write", async () => {
  const factory = new IDBFactory();
  let allowed = false;
  const storage = new AudioLibraryStorage(factory, () => allowed);
  await assert.rejects(storage.read(), /DM/);
  assert.deepEqual(await factory.databases(), []);
  allowed = true;
  const pending = storage.import(file(), metadata, "exploration");
  allowed = false;
  await assert.rejects(pending, /DM/);
  allowed = true;
  assert.deepEqual(await storage.read(), starterAudioLibrary());
});

test("corrupt saved records are reported without replacement; source links reject unsafe protocols", async () => {
  const factory = new IDBFactory(),
    request = factory.open(AUDIO_DB, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore("library");
    request.result.createObjectStore("files");
  };
  const db = await new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
  });
  const tx = db.transaction("library", "readwrite");
  tx.objectStore("library").put({ version: 99 }, "current");
  await new Promise((resolve) => {
    tx.oncomplete = resolve;
  });
  const storage = new AudioLibraryStorage(factory, () => true);
  await assert.rejects(storage.read(), /unreadable/);
  await assert.rejects(
    storage.change(() => {}),
    /unreadable/,
  );
  const r = db.transaction("library").objectStore("library").get("current");
  assert.deepEqual(
    await new Promise((resolve) => {
      r.onsuccess = () => resolve(r.result);
    }),
    { version: 99 },
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/plain,hello",
    "https://user:password@example.com",
  ])
    assert.throws(() => audioSource(url));
  assert.equal(audioSource(" https://example.com/audio "), "https://example.com/audio");
  assert.throws(
    () => validateAudioLibrary({ ...starterAudioLibrary(), tracks: [null] }),
    /unreadable/,
  );
});

function playerFixture() {
  const requests = [],
    revoked = [],
    ownership = [];
  let hidden = false,
    allowed = true,
    opened = 0;
  const output = {
    src: "",
    volume: 0,
    currentTime: 0,
    onended: null,
    onerror: null,
    plays: 0,
    pauses: 0,
    async play() {
      this.plays++;
    },
    pause() {
      this.pauses++;
    },
    load() {},
    removeAttribute() {
      this.src = "";
    },
  };
  const player = new LocalAudioPlayer({
    open: () => {
      opened++;
      return output;
    },
    source: (track) =>
      new Promise((resolve, reject) => requests.push({ id: track.id, resolve, reject })),
    revoke: (source) => revoked.push(source),
    own: (...args) => ownership.push(args),
    visible: () => !hidden,
    allowed: () => allowed,
    random: () => 0,
  });
  return {
    player,
    output,
    requests,
    revoked,
    ownership,
    opened: () => opened,
    hide: (value) => {
      hidden = value;
      player.visibility();
    },
    role: (value) => {
      allowed = value;
    },
    resolve: (index) => requests[index].resolve("blob:" + requests[index].id),
  };
}
test("late track loads, Stop and role changes never resurrect obsolete playback or retain object URLs", async () => {
  const f = playerFixture(),
    lib = starterAudioLibrary();
  f.player.configure(lib);
  assert.equal(f.opened(), 0);
  const old = f.player.play("exploration", "town"),
    next = f.player.play("exploration", "study");
  f.resolve(1);
  await next;
  f.resolve(0);
  await old;
  assert.equal(f.output.src, "blob:study");
  assert.equal(f.output.plays, 1);
  assert.ok(f.revoked.includes("blob:town"));
  f.player.stop();
  assert.equal(f.output.src, "");
  assert.ok(f.revoked.includes("blob:study"));
  const late = f.player.play("combat");
  f.player.stop();
  f.resolve(2);
  await late;
  assert.equal(f.output.plays, 1);
  assert.equal(f.player.getSnapshot().status, "stopped");
  const revokedRole = f.player.play("combat");
  f.role(false);
  f.player.configure(lib);
  f.resolve(3);
  await revokedRole;
  assert.equal(f.output.plays, 1);
  assert.equal(f.ownership.at(-1)[0], false);
});

test("pause, resume, backgrounding, end-of-playlist, shuffle and scene following retain one source", async () => {
  const f = playerFixture(),
    lib = starterAudioLibrary();
  lib.repeat = false;
  lib.followScenes = true;
  lib.assignments["dungeon-corridor"] = "combat";
  f.player.configure(lib, "tavern");
  const start = f.player.play("exploration");
  f.resolve(0);
  await start;
  f.output.currentTime = 12;
  f.player.pause();
  await f.player.play("exploration", "town");
  assert.equal(f.output.currentTime, 12);
  assert.equal(f.requests.length, 1);
  f.output.onended();
  f.resolve(1);
  await settle();
  assert.equal(f.player.getSnapshot().trackId, "study");
  f.output.onended();
  assert.equal(f.player.getSnapshot().status, "stopped");
  const again = f.player.play("exploration");
  f.resolve(2);
  await again;
  f.hide(true);
  assert.equal(f.player.getSnapshot().status, "paused");
  f.hide(false);
  assert.equal(f.player.getSnapshot().status, "paused");
  await f.player.play("exploration", "town");
  f.player.configure(lib, "dungeon-corridor");
  f.resolve(3);
  await settle();
  assert.equal(f.player.getSnapshot().playlistId, "combat");
  lib.volume = 0.22;
  f.player.configure(lib);
  assert.equal(f.output.volume, 0.22);
  assert.equal(f.requests.length, 4);
  lib.shuffle = true;
  const shuffled = f.player.play("exploration", "town");
  f.resolve(4);
  await shuffled;
  f.player.next();
  f.resolve(5);
  await settle();
  assert.equal(f.player.getSnapshot().trackId, "study");
  f.player.dispose();
  assert.equal(f.output.src, "");
  assert.equal(f.ownership.at(-1)[0], false);
});

test("rejected audio and backgrounded pending loads recover without taking over menu music", async () => {
  const f = playerFixture();
  f.player.configure(starterAudioLibrary());
  const start = f.player.play("exploration");
  f.requests[0].reject(Error("missing"));
  await start;
  assert.match(f.player.getSnapshot().error, /missing/);
  assert.equal(f.ownership.at(-1)[0], false);
  const pending = f.player.play("exploration");
  f.hide(true);
  f.resolve(1);
  await pending;
  assert.equal(f.output.plays, 0);
  assert.equal(f.ownership.at(-1)[0], false);
});
