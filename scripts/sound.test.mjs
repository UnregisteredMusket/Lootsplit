import test from "node:test";
import assert from "node:assert/strict";
import { configureSound, playSound, unlockSound } from "../src/lib/quire/sound.ts";

test("optional audio is silent by default and safe without browser APIs", async () => {
  configureSound(false, 0.35);
  assert.equal(await playSound("coins"), false);
  unlockSound();
});

test("audio preview, mute during download, caching and failure do not affect gameplay", async () => {
  let starts = 0,
    stops = 0,
    requests = 0,
    resolveDownload;
  globalThis.document = { hidden: false };
  globalThis.window = {
    AudioContext: class {
      state = "running";
      currentTime = 0;
      destination = {};
      createGain() {
        return { gain: { value: 0, setValueAtTime() {} }, connect() {} };
      }
      createBufferSource() {
        return {
          connect() {},
          disconnect() {},
          start() {
            starts++;
          },
          stop() {
            stops++;
          },
        };
      }
      async decodeAudioData() {
        return {};
      }
    },
  };
  globalThis.fetch = async () => {
    requests++;
    return new Promise((resolve) => {
      resolveDownload = () => resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
    });
  };
  configureSound(true, 0.3);
  unlockSound();
  const pending = playSound("coins");
  configureSound(false, 0.3);
  resolveDownload();
  assert.equal(await pending, false);
  assert.equal(starts, 0);
  await new Promise((r) => setTimeout(r, 110));
  assert.equal(await playSound("coins", true), true);
  assert.equal(requests, 1);
  assert.equal(starts, 1);
  configureSound(false, 0);
  assert.equal(stops, 1);
  assert.equal(await playSound("coins", true), false);
  configureSound(true, 0.3);
  document.hidden = true;
  assert.equal(await playSound("coins"), false);
  document.hidden = false;
  await new Promise((r) => setTimeout(r, 110));
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  assert.equal(await playSound("loot"), false);
  delete globalThis.window;
  delete globalThis.document;
});
