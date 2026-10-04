import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSound } from '../src/audio.js';

function audioBrowser(t, { rejectResume = false, rejectPlay = false, resumePending = false, muted = false } = {}) {
  const originals = new Map(['window', 'localStorage'].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)],
  ));
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const storage = new Map([['vantage-muted', muted ? '1' : '0']]);
  globalThis.localStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  const contexts = [];
  const players = [];
  class Audio {
    constructor(url) {
      this.src = url;
      this.paused = true;
      this.ended = false;
      this.readyState = 4;
      this.listeners = new Map();
      this.playCalls = 0;
      this.rejectPlay = rejectPlay;
      players.push(this);
    }
    addEventListener(event, callback) { this.listeners.set(event, callback); }
    async play() {
      this.playCalls++;
      if (this.rejectPlay) throw new Error('Gesture required');
      this.paused = false;
      this.listeners.get('playing')?.();
    }
    pause() {
      this.paused = true;
      this.listeners.get('pause')?.();
    }
  }
  const param = () => ({
    value: 0,
    setValueAtTime(value) { this.value = value; },
    linearRampToValueAtTime(value) { this.value = value; },
    exponentialRampToValueAtTime(value) { this.value = value; },
    setTargetAtTime(value) { this.value = value; },
  });
  class Context {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 0;
      this.nodes = [];
      this.destination = {};
      this.resumeCalls = 0;
      this.rejectResume = rejectResume;
      contexts.push(this);
    }
    node(kind) {
      const node = {
        kind, gain: param(), frequency: param(), detune: param(), delayTime: param(),
        connections: [],
        connect(target) { this.connections.push(target); return target; },
        disconnect() {}, start() { this.started = true; }, stop() {},
      };
      this.nodes.push(node);
      return node;
    }
    createGain() { return this.node('gain'); }
    createOscillator() { return this.node('oscillator'); }
    createDelay() { return this.node('delay'); }
    addEventListener(event, callback) { if (event === 'statechange') this.onStateChange = callback; }
    async resume() {
      this.resumeCalls++;
      if (resumePending) return new Promise(() => {});
      if (this.rejectResume) throw new Error('Gesture required');
      this.state = 'running';
      this.onStateChange?.();
    }
  }
  globalThis.window = { AudioContext: Context, Audio };
  return { contexts, players, storage, Audio };
}

test('the first gesture starts one local music player and resumes game cues', async (t) => {
  const { contexts, players } = audioBrowser(t);
  const sound = createSound();
  assert.equal(sound.playing, false);
  assert.equal(await sound.unlock(), true);
  const [ctx] = contexts;
  assert.equal(ctx.resumeCalls, 1);
  assert.equal(sound.playing, true);
  assert.equal(players[0].src, '/audio/calm-background.wav');
  assert.equal(players[0].loop, true);
  assert.equal(players[0].playCalls, 1);
  sound.place();
  assert.ok(ctx.nodes.some((node) => node.kind === 'oscillator' && node.started));
  const nodes = ctx.nodes.length;
  await sound.unlock();
  assert.equal(contexts.length, 1);
  assert.equal(ctx.nodes.length, nodes);
  assert.equal(players.length, 1);
  assert.equal(players[0].playCalls, 1);
});

test('music plays even when Web Audio resume fails, and game cues can retry', async (t) => {
  const { contexts } = audioBrowser(t, { rejectResume: true });
  const sound = createSound();
  assert.equal(await sound.unlock(), true);
  assert.equal(sound.playing, true);
  contexts[0].rejectResume = false;
  assert.equal(await sound.unlock(), true);
  assert.equal(contexts[0].resumeCalls, 2);
  assert.equal(sound.playing, true);
});

test('mute persists and pauses the music, while unmuting resumes both outputs', async (t) => {
  const { contexts, players, storage } = audioBrowser(t, { muted: true });
  let updates = 0;
  const sound = createSound({ onChange: () => updates++ });
  await sound.unlock();
  const [ctx] = contexts;
  const master = ctx.nodes.find((node) => node.connections.includes(ctx.destination));
  assert.equal(master.gain.value, 0);
  assert.equal(players[0].paused, true);
  sound.setMuted(false);
  assert.equal(master.gain.value, 0.6);
  await sound.unlock();
  assert.equal(players[0].paused, false);
  sound.toggleMute();
  assert.equal(master.gain.value, 0);
  assert.equal(storage.get('vantage-muted'), '1');
  assert.equal(players[0].muted, true);
  assert.equal(players[0].paused, true);
  sound.setMuted(false);
  ctx.state = 'interrupted';
  ctx.onStateChange();
  assert.equal(sound.playing, true); // music does not depend on the cue context
  await sound.unlock();
  assert.equal(sound.playing, true);
  assert.ok(updates > 4);
});

test('browsers without Web Audio can still play the standard media soundtrack', async (t) => {
  const { Audio } = audioBrowser(t);
  globalThis.window = { Audio };
  const sound = createSound();
  assert.equal(sound.available, true);
  assert.equal(await sound.unlock(), true);
  assert.equal(sound.playing, true);
});

test('browsers without either audio API report sound unavailable', async (t) => {
  audioBrowser(t);
  globalThis.window = {};
  const sound = createSound();
  assert.equal(sound.available, false);
  assert.equal(await sound.unlock(), false);
  assert.equal(sound.playing, false);
});

test('a blocked media player cannot report sound on just because Web Audio is running', async (t) => {
  const { contexts, players } = audioBrowser(t, { rejectPlay: true });
  const sound = createSound();
  assert.equal(await sound.unlock(), false);
  assert.equal(contexts[0].state, 'running');
  assert.equal(sound.playing, false);
  players[0].rejectPlay = false;
  assert.equal(await sound.unlock(), true);
  assert.equal(sound.playing, true);
});

test('background playback never waits for an indefinitely suspended Web Audio context', async (t) => {
  audioBrowser(t, { resumePending: true });
  const sound = createSound();
  assert.equal(await sound.unlock(), true);
  assert.equal(sound.playing, true);
});
