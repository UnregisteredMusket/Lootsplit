import test from "node:test";
import assert from "node:assert/strict";
import { MenuAudioController, sceneAudio } from "../src/lib/quire/menu-audio.ts";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const options = {
  scene: "tavern",
  appearance: "dark",
  musicEnabled: true,
  musicVolume: 0.2,
  ambienceEnabled: true,
  ambienceVolume: 0.15,
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const requests = [],
    sources = [],
    downloads = new Map();
  let opened = 0,
    hidden = false;
  const context = {
    state: "running",
    currentTime: 0,
    destination: {},
    async decodeAudioData(bytes) {
      return { bytes };
    },
    async resume() {
      context.state = "running";
    },
    async close() {
      context.state = "closed";
    },
    createGain() {
      return {
        gain: {
          cancelScheduledValues() {},
          setTargetAtTime() {},
          setValueAtTime() {},
          linearRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
      };
    },
    createBufferSource() {
      const source = {
        started: 0,
        stopped: 0,
        loop: false,
        connect() {},
        disconnect() {},
        start() {
          this.started++;
        },
        stop() {
          this.stopped++;
        },
      };
      sources.push(source);
      return source;
    },
  };
  const controller = new MenuAudioController({
    open() {
      opened++;
      return context;
    },
    visible() {
      return !hidden;
    },
    load(file) {
      requests.push(file);
      return new Promise((resolve, reject) => downloads.set(file, { resolve, reject }));
    },
  });
  return {
    controller,
    context,
    requests,
    sources,
    downloads,
    opened: () => opened,
    hide: (value) => {
      hidden = value;
      controller.refresh();
    },
    resolve: () => {
      for (const download of downloads.values()) download.resolve(new ArrayBuffer(1));
    },
  };
}

test("silent configuration and unsupported/off/zero-volume gestures never download", async () => {
  const f = fixture();
  f.controller.configure(options);
  assert.equal(f.opened(), 0);
  assert.equal(f.requests.length, 0);
  f.controller.configure({ ...options, musicEnabled: false, ambienceEnabled: false });
  assert.equal(await f.controller.unlock(), false);
  assert.equal(f.opened(), 0);
  f.controller.configure({ ...options, musicVolume: 0, ambienceVolume: 0 });
  assert.equal(await f.controller.unlock(), false);
  assert.equal(f.requests.length, 0);
  f.controller.dispose();
});

test("scene and volume updates reuse loops; independent mute and hiding stop immediately", async () => {
  const f = fixture();
  f.controller.configure(options);
  await f.controller.unlock();
  f.resolve();
  await settle();
  assert.equal(f.sources.length, 2);
  assert.ok(f.sources.every((s) => s.loop && s.started === 1));
  f.controller.configure({ ...options, scene: "blacksmith", musicVolume: 0.1 });
  assert.equal(f.sources.length, 2);
  assert.equal(f.requests.length, 2);
  f.controller.configure({ ...options, musicEnabled: false });
  assert.equal(f.sources.filter((s) => s.stopped).length, 1);
  f.hide(true);
  assert.ok(f.sources.every((s) => s.stopped));
  f.hide(false);
  await settle();
  assert.equal(f.sources.length, 3);
  f.controller.configure({ ...options, scene: undefined });
  assert.ok(f.sources.every((s) => s.stopped));
  f.controller.dispose();
  assert.equal(f.context.state, "closed");
});

test("late downloads cannot play after a route change, mute, hidden tab or disposal", async () => {
  for (const cancel of [
    (f) => f.controller.configure({ ...options, scene: undefined }),
    (f) => f.controller.configure({ ...options, musicVolume: 0, ambienceVolume: 0 }),
    (f) => f.hide(true),
    (f) => f.controller.dispose(),
  ]) {
    const f = fixture();
    f.controller.configure(options);
    await f.controller.unlock();
    cancel(f);
    f.resolve();
    await settle();
    assert.equal(f.sources.length, 0);
    f.controller.dispose();
  }
});

test("blocked resume and missing assets fail safely; next interaction can retry", async () => {
  const f = fixture();
  f.controller.configure(options);
  f.context.state = "suspended";
  f.context.resume = async () => {
    throw Error("Blocked");
  };
  assert.equal(await f.controller.unlock(), false);
  assert.equal(f.requests.length, 0);
  f.context.resume = async () => {
    f.context.state = "running";
  };
  assert.equal(await f.controller.unlock(), true);
  for (const d of f.downloads.values()) d.reject(Error("Offline"));
  await settle();
  assert.equal(f.sources.length, 0);
  assert.equal(await f.controller.unlock(), true);
  assert.equal(f.requests.length, 4);
  f.resolve();
  await settle();
  assert.equal(f.sources.length, 2);
  f.controller.dispose();
});

test("day/night uses shared scene mapping and every bundled file matches credited provenance", () => {
  assert.notEqual(
    sceneAudio("market-street", "light").ambience,
    sceneAudio("market-street", "dark").ambience,
  );
  assert.deepEqual(sceneAudio("unknown", "dark"), {});
  const { tracks } = JSON.parse(readFileSync("public/audio/scenes/sources.json", "utf8"));
  for (const track of tracks) {
    const bytes = readFileSync(`public/audio/scenes/${track.file}`);
    assert.equal(bytes.length, track.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), track.sha256);
    assert.ok(["CC0-1.0", "CC-BY-4.0"].includes(track.license));
    assert.match(track.source, /^https:\/\/opengameart.org\/content\//);
  }
});
